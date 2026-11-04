import { randomUUID } from "node:crypto";
import {
  calculateBill,
  sessionEnergy,
  type Bill,
  type Dispute,
  type Session,
  type SessionDetail
} from "@chargemesh/shared";
import type { Repositories } from "./repositories.js";
import { latestTariff } from "./tariffs.js";
import { appendAuditEvent } from "./audit-core.js";
import type { AuditService } from "./audit.js";
import type { HederaService } from "./hedera.js";
import { AppError } from "./errors.js";

export class SessionService {
  private readonly pendingSettlements = new Set<string>();

  constructor(
    private readonly repositories: Repositories,
    private readonly audit: AuditService,
    private readonly hedera: HederaService
  ) {}

  async list(): Promise<Session[]> {
    const bills = await this.repositories.bills.list();
    return bills.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  async listDisputes(): Promise<Dispute[]> {
    const disputes = await this.repositories.disputes.list();
    return disputes.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  async start(roomId: string, actor: string): Promise<Session> {
    const result = await this.repositories.transaction(async (tx) => {
      const room = await tx.rooms.findById(roomId);
      if (!room) {
        throw new AppError(404, "room_not_found", "Room was not found");
      }
      const meter = await tx.meters.findActiveByRoom(roomId);
      if (!meter) {
        throw new AppError(409, "meter_not_registered", "Room has no active submeter");
      }
      if (await tx.bills.findActiveByRoom(roomId)) {
        throw new AppError(
          409,
          "session_already_active",
          "Room already has an active session"
        );
      }
      if (meter.lastAcceptedEnergyKwh === undefined) {
        throw new AppError(
          409,
          "no_verified_reading",
          "Start a session only after the meter has a verified reading"
        );
      }
      const tariff = latestTariff(await tx.tariffs.list());
      if (!tariff) {
        throw new AppError(409, "tariff_not_configured", "No tariff is configured");
      }

      const session: Session = {
        id: `sess_${randomUUID().slice(0, 12)}`,
        roomId,
        meterId: meter.id,
        tariffId: tariff.id,
        tariffNprPerKwh: tariff.nprPerKwh,
        startTime: new Date().toISOString(),
        startEnergyKwh: meter.lastAcceptedEnergyKwh,
        status: "active",
        createdAt: new Date().toISOString()
      };
      await tx.bills.save(session);
      const event = await appendAuditEvent(tx.auditEvents, {
        type: "session.started",
        actor,
        payload: {
          sessionId: session.id,
          roomId,
          meterId: meter.id,
          tariffId: tariff.id,
          tariffNprPerKwh: tariff.nprPerKwh,
          startEnergyKwh: session.startEnergyKwh
        }
      });
      return { session, event };
    });
    void this.audit.notarize(result.event);
    return result.session;
  }

  async close(sessionId: string, actor: string): Promise<Session> {
    const result = await this.repositories.transaction(async (tx) => {
      const session = await tx.bills.findById(sessionId);
      if (!session) {
        throw new AppError(404, "session_not_found", "Session was not found");
      }
      if (session.status !== "active") {
        throw new AppError(409, "session_not_active", "Only an active session can be closed");
      }
      const meter = await tx.meters.findById(session.meterId);
      if (!meter) {
        throw new AppError(409, "meter_not_registered", "Session meter is no longer registered");
      }
      const latest = (await tx.readings.list({ meterId: meter.id, status: "accepted" }))
        .sort(
          (a, b) =>
            Date.parse(b.payload.timestamp) - Date.parse(a.payload.timestamp)
        )[0];
      const endEnergyKwh = latest?.payload.cumulativeEnergyKwh ?? session.startEnergyKwh;
      if (endEnergyKwh < session.startEnergyKwh) {
        throw new AppError(
          409,
          "meter_reset_detected",
          "End energy is lower than the session start; resolve the meter reset before billing"
        );
      }

      let energyKwh: number;
      try {
        energyKwh = sessionEnergy(session.startEnergyKwh, endEnergyKwh);
      } catch {
        throw new AppError(409, "invalid_energy", "Session energy could not be calculated");
      }
      const amountNpr = calculateBill(energyKwh, session.tariffNprPerKwh);
      const closedAt = new Date().toISOString();
      session.endTime = latest?.payload.timestamp ?? closedAt;
      session.endEnergyKwh = endEnergyKwh;
      session.energyKwh = energyKwh;
      session.amountNpr = amountNpr;
      session.status = "closed";
      session.closedAt = closedAt;
      await tx.bills.save(session);

      const event = await appendAuditEvent(tx.auditEvents, {
        type: "session.closed",
        actor,
        at: closedAt,
        payload: {
          sessionId: session.id,
          roomId: session.roomId,
          meterId: session.meterId,
          startEnergyKwh: session.startEnergyKwh,
          endEnergyKwh,
          energyKwh,
          tariffNprPerKwh: session.tariffNprPerKwh,
          amountNpr,
          closingReadingId: latest?.id ?? null
        }
      });
      return { session, event };
    });
    void this.audit.notarize(result.event);
    return result.session;
  }

  async openDispute(sessionId: string, reason: string, openedBy: string): Promise<Dispute> {
    const result = await this.repositories.transaction(async (tx) => {
      const session = await tx.bills.findById(sessionId);
      if (!session) {
        throw new AppError(404, "session_not_found", "Session was not found");
      }
      if (session.status !== "closed") {
        throw new AppError(
          409,
          "session_not_disputable",
          "Only a closed session can be disputed"
        );
      }
      const dispute: Dispute = {
        id: `dsp_${randomUUID().slice(0, 12)}`,
        sessionId,
        reason: reason.trim(),
        openedBy,
        status: "open",
        createdAt: new Date().toISOString()
      };
      await tx.disputes.save(dispute);
      session.status = "disputed";
      await tx.bills.save(session);
      const event = await appendAuditEvent(tx.auditEvents, {
        type: "dispute.opened",
        actor: openedBy,
        payload: {
          disputeId: dispute.id,
          sessionId,
          reason: dispute.reason,
          amountNpr: session.amountNpr ?? null
        }
      });
      return { dispute, event };
    });
    void this.audit.notarize(result.event);
    return result.dispute;
  }

  async openBillDispute(billId: string, reason: string, openedBy: string): Promise<Dispute> {
    const result = await this.repositories.transaction(async (tx) => {
      const record: unknown = await tx.bills.findById(billId);
      if (!record || typeof record !== "object" || !("billId" in record)) {
        throw new AppError(404, "bill_not_found", "Bill was not found");
      }
      const bill = record as Bill;
      if (bill.status === "draft") {
        throw new AppError(
          409,
          "bill_not_disputable",
          "This bill has not been sent by your landlord yet"
        );
      }
      const existing = (await tx.disputes.list()).find(
        (dispute) => dispute.billId === billId && dispute.status === "open"
      );
      if (existing) {
        throw new AppError(409, "dispute_already_open", "This bill already has an open dispute");
      }
      const dispute: Dispute = {
        id: `dsp_${randomUUID().slice(0, 12)}`,
        sessionId: billId,
        billId,
        reason: reason.trim(),
        openedBy,
        status: "open",
        createdAt: new Date().toISOString()
      };
      await tx.disputes.save(dispute);
      const event = await appendAuditEvent(tx.auditEvents, {
        type: "dispute.opened",
        actor: openedBy,
        payload: {
          disputeId: dispute.id,
          billId,
          roomId: bill.roomId,
          reason: dispute.reason,
          amountNpr: bill.electricityChargeNpr
        }
      });
      return { dispute, event };
    });
    void this.audit.notarize(result.event);
    return result.dispute;
  }

  async resolveDispute(
    disputeId: string,
    status: "upheld" | "rejected",
    resolution: string,
    resolvedBy: string,
    creditNpr?: number
  ): Promise<Dispute> {
    if (creditNpr !== undefined && status !== "upheld") {
      throw new AppError(400, "validation_failed", "A courtesy credit can only be given when the dispute is upheld");
    }
    const result = await this.repositories.transaction(async (tx) => {
      const dispute = await tx.disputes.findById(disputeId);
      if (!dispute) {
        throw new AppError(404, "dispute_not_found", "Dispute was not found");
      }
      if (dispute.status !== "open") {
        throw new AppError(409, "dispute_not_open", "Dispute is already resolved");
      }
      if (creditNpr !== undefined) {
        const record: unknown = await tx.bills.findById(dispute.billId ?? dispute.sessionId);
        if (!record || typeof record !== "object" || !("billId" in record)) {
          throw new AppError(404, "bill_not_found", "Bill was not found");
        }
        const bill = record as Bill;
        const alreadyCredited = bill.creditNpr ?? 0;
        if (alreadyCredited + creditNpr > bill.electricityChargeNpr) {
          throw new AppError(
            422,
            "credit_exceeds_bill",
            `Credit cannot exceed the bill amount (NPR ${bill.electricityChargeNpr})`
          );
        }
        bill.creditNpr = Math.round((alreadyCredited + creditNpr) * 100) / 100;
        bill.amountDueNpr = Math.round((bill.electricityChargeNpr - bill.creditNpr) * 100) / 100;
        await tx.bills.save(bill as any);
        dispute.creditNpr = creditNpr;
      }
      dispute.status = status;
      dispute.resolution = resolution.trim();
      dispute.resolvedAt = new Date().toISOString();
      dispute.resolvedBy = resolvedBy;
      await tx.disputes.save(dispute);
      const session = await tx.bills.findById(dispute.sessionId);
      if (session && session.status === "disputed") {
        session.status = "closed";
        await tx.bills.save(session);
      }
      const event = await appendAuditEvent(tx.auditEvents, {
        type: "dispute.resolved",
        actor: resolvedBy,
        payload: {
          disputeId,
          sessionId: dispute.sessionId,
          status,
          resolution: dispute.resolution,
          creditNpr: dispute.creditNpr ?? null
        }
      });
      return { dispute, event };
    });
    void this.audit.notarize(result.event);
    return result.dispute;
  }

  async settleWithHts(
    sessionId: string,
    payerAccountId: string,
    actor: string
  ): Promise<Session> {
    if (this.pendingSettlements.has(sessionId)) {
      throw new AppError(409, "settlement_in_progress", "A settlement is already in progress");
    }
    const session = await this.repositories.bills.findById(sessionId);
    if (!session) {
      throw new AppError(404, "session_not_found", "Session was not found");
    }
    if (session.status !== "closed") {
      throw new AppError(409, "session_not_settleable", "Only a closed session can be settled");
    }
    if (session.settlement) {
      throw new AppError(409, "session_already_settled", "Session already has an HTS settlement");
    }
    if (!session.amountNpr || session.amountNpr <= 0) {
      throw new AppError(409, "zero_amount", "Session has no positive amount to settle");
    }

    this.pendingSettlements.add(sessionId);
    try {
      const transfer = await this.hedera.transferTestTokens(payerAccountId, session.amountNpr);
      const result = await this.repositories.transaction(async (tx) => {
        const stored = await tx.bills.findById(sessionId);
        if (!stored) {
          throw new AppError(404, "session_not_found", "Session was not found");
        }
        if (stored.settlement) {
          throw new AppError(
            409,
            "session_already_settled",
            "Session already has an HTS settlement"
          );
        }
        stored.settlement = {
          provider: "hts",
          tokenId: transfer.tokenId,
          payerAccountId: transfer.payerAccountId,
          treasuryAccountId: transfer.treasuryAccountId,
          amountTokenUnits: transfer.amountTokenUnits,
          transactionId: transfer.transactionId,
          settledAt: new Date().toISOString()
        };
        await tx.bills.save(stored);
        const event = await appendAuditEvent(tx.auditEvents, {
          type: "session.settled_hts",
          actor,
          payload: {
            sessionId,
            tokenId: transfer.tokenId,
            transactionId: transfer.transactionId,
            amountNpr: stored.amountNpr ?? null,
            amountTokenUnits: transfer.amountTokenUnits
          }
        });
        return { session: stored, event };
      });
      void this.audit.notarize(result.event);
      return result.session;
    } finally {
      this.pendingSettlements.delete(sessionId);
    }
  }

  async detail(sessionId: string): Promise<SessionDetail> {
    const session = await this.repositories.bills.findById(sessionId);
    if (!session) {
      throw new AppError(404, "session_not_found", "Session was not found");
    }
    const [room, meter, meterReadings, allAuditEvents, allDisputes] = await Promise.all([
      this.repositories.rooms.findById(session.roomId),
      this.repositories.meters.findById(session.meterId),
      this.repositories.readings.list({ meterId: session.meterId }),
      this.repositories.auditEvents.list(),
      this.repositories.disputes.list()
    ]);
    if (!room || !meter) {
      throw new AppError(
        409,
        "session_evidence_incomplete",
        "Session room or meter is missing"
      );
    }
    const endBoundary = Date.parse(session.endTime ?? new Date().toISOString());
    const readings = meterReadings
      .filter(
        (reading) =>
          reading.sessionId === session.id ||
          (reading.status === "accepted" &&
            Date.parse(reading.payload.timestamp) >= Date.parse(session.startTime) &&
            Date.parse(reading.payload.timestamp) <= endBoundary)
      )
      .sort((a, b) => Date.parse(a.payload.timestamp) - Date.parse(b.payload.timestamp));
    const readingIds = new Set(readings.map((reading) => reading.id));
    const auditEvents = allAuditEvents.filter(
      (event) =>
        event.payload.sessionId === session.id ||
        (typeof event.payload.readingId === "string" && readingIds.has(event.payload.readingId))
    );
    const disputes = allDisputes.filter((dispute) => dispute.sessionId === session.id);

    return { session, room, meter, readings, disputes, auditEvents };
  }
}
