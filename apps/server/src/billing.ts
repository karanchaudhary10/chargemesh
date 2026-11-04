import { createHash, randomUUID } from "node:crypto";
import {
  BILLING_ROUNDING_RULE,
  computeConsumption,
  computeElectricityCharge,
  type Bill,
  type BillPaymentDetails,
  type Reading,
  type Tariff,
  type WalletPayment,
  type WalletPaymentInput
} from "@chargemesh/shared";
import { hashReadingPayload } from "@chargemesh/shared/node";
import type { Repositories, RepositoryTransaction } from "./repositories.js";
import type { AuditService } from "./audit.js";
import { appendAuditEvent } from "./audit-core.js";
import { AppError } from "./errors.js";
import { TariffService, tariffIdOf, tariffRateOf } from "./tariffs.js";

function readingKey(reading: Reading): string {
  return reading.readingId ?? reading.id;
}

function readingCumulativeKwh(reading: Reading): number {
  const p = reading.payload as any;
  return p.cumulativeEnergyKwh ?? p.cumulativeKwh;
}

function periodOf(bill: any): { start: number; end: number } {
  return {
    start: Date.parse(bill.periodStart ?? bill.startTime ?? ""),
    end: Date.parse(bill.periodEnd ?? bill.endTime ?? "")
  };
}

function findOverlappingBill(bills: any[], roomId: string, periodStart: string, periodEnd: string): any | null {
  const ps = Date.parse(periodStart);
  const pe = Date.parse(periodEnd);
  for (const bill of bills) {
    if (bill.roomId !== roomId) continue;
    const { start, end } = periodOf(bill);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    if (start < pe && ps < end) {
      return bill;
    }
  }
  return null;
}

export interface BillInput {
  roomId: string;
  periodStart: string;
  periodEnd: string;
  tariffId?: string;
  meterId?: string;
  landlordPaymentQr?: any;
}

/**
 * Keep the decoded wallet QR with the bill, plus a stable fingerprint for
 * lists, audit events and receipts. The raw payload stays in the DB so a
 * dispute can be traced back to exactly what the renter scanned.
 */
function walletPaymentFrom(input: WalletPaymentInput | undefined): WalletPayment | undefined {
  const payload = input?.payload.trim();
  if (!payload) return undefined;
  const scheme = /^([a-z][a-z0-9+.-]{0,30}):/i.exec(payload)?.[1];
  return {
    method: "wallet_qr",
    payload,
    reference: createHash("sha256").update(payload).digest("hex"),
    scheme: scheme?.toLowerCase(),
    capturedAt: new Date().toISOString()
  };
}

export class BillingService {
  constructor(
    private readonly repositories: Repositories,
    private readonly audit: AuditService,
    private readonly tariffs: TariffService
  ) {}

  async list(filters: { roomId?: string; status?: string } = {}): Promise<any[]> {
    const bills = await this.repositories.bills.list();
    let result = bills as any[];
    if (filters.roomId) {
      result = result.filter((b) => b.roomId === filters.roomId);
    }
    if (filters.status) {
      result = result.filter((b) => b.status === filters.status);
    }
    return result.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  async get(billId: string): Promise<any> {
    const bill = await this.repositories.bills.findById(billId);
    if (!bill) {
      throw new AppError(404, "bill_not_found", "Bill not found");
    }
    return bill;
  }

  async listForRoom(roomId: string): Promise<any[]> {
    return this.list({ roomId });
  }

  /** Calculates a draft bill exactly as create() would, without saving anything. */
  async preview(input: BillInput): Promise<Bill> {
    return this.compute(this.repositories, input);
  }

  async create(input: BillInput, actor: string): Promise<Bill> {
    const result = await this.repositories.transaction(async (tx) => {
      const bill = await this.compute(tx, input);
      if ((input as any).landlordPaymentQr) {
        (bill as any).landlordPaymentQr = (input as any).landlordPaymentQr;
      }
      await tx.bills.save(bill as any);

      const event = await appendAuditEvent(tx.auditEvents, {
        type: "bill.generated",
        actor,
        at: bill.createdAt,
        payload: {
          billId: bill.billId,
          roomId: bill.roomId,
          meterId: bill.meterId,
          periodStart: bill.periodStart,
          periodEnd: bill.periodEnd,
          startingReadingId: bill.startingReadingId,
          endingReadingId: bill.endingReadingId,
          consumptionKwh: bill.consumptionKwh,
          tariffId: bill.tariffId,
          rateNprPerKwh: bill.rateNprPerKwh,
          electricityChargeNpr: bill.electricityChargeNpr,
          hasLandlordPaymentQr: Boolean((bill as any).landlordPaymentQr)
        }
      });
      return { bill, event };
    });

    void this.audit.notarize(result.event);
    return result.bill;
  }

  private async compute(tx: RepositoryTransaction, input: BillInput): Promise<Bill> {
    const roomId = input.roomId;
    if (!roomId || typeof roomId !== "string") {
      throw new AppError(400, "validation_failed", "roomId is required");
    }
    if (typeof input.periodStart !== "string" || Number.isNaN(Date.parse(input.periodStart))) {
      throw new AppError(400, "validation_failed", "Invalid periodStart");
    }
    if (typeof input.periodEnd !== "string" || Number.isNaN(Date.parse(input.periodEnd))) {
      throw new AppError(400, "validation_failed", "Invalid periodEnd");
    }
    if (Date.parse(input.periodEnd) <= Date.parse(input.periodStart)) {
      throw new AppError(400, "validation_failed", "periodEnd must be after periodStart");
    }

    {
      const room = await tx.rooms.findById(roomId);
      if (!room) {
        throw new AppError(404, "room_not_found", "Room not found");
      }
      let meter = await tx.meters.findActiveByRoom(roomId) ?? null;
      if (!meter) {
        const allMeters = await tx.meters.list();
        if (input.meterId) {
          meter = allMeters.find((m: any) => (m.meterId === input.meterId || m.id === input.meterId || (m as any).serial === input.meterId)) ?? null;
        }
        if (!meter) {
          meter = allMeters.find((m: any) => m.roomId === roomId) ?? null;
        }
      }
      if (!meter) {
        throw new AppError(404, "meter_not_found", "Meter not found for room");
      }
      const existingBills = await tx.bills.list();
      const overlapping = findOverlappingBill(existingBills as any, roomId, input.periodStart, input.periodEnd);
      if (overlapping) {
        const existing = periodOf(overlapping);
        if (
          Math.abs(existing.start - Date.parse(input.periodStart)) < 1000 &&
          Math.abs(existing.end - Date.parse(input.periodEnd)) < 1000
        ) {
          throw new AppError(409, "bill_exists", "Bill already exists for this room and billing period");
        }
        throw new AppError(
          409,
          "bill_period_overlap",
          `This period overlaps an existing bill for this room (${overlapping.periodStart} to ${overlapping.periodEnd})`
        );
      }

      const meterKey = (meter as any).meterId ?? meter.id;
      let readings = (await tx.readings.list({ meterId: meter.id }))
        .concat(await tx.readings.list({ meterId: meterKey }))
        .filter((r) => r.status === "accepted");
      if (readings.length === 0) {
        readings = (await tx.readings.list({ roomId })).filter((r) => r.status === "accepted");
      }
      const startMs = Date.parse(input.periodStart);
      const endMs = Date.parse(input.periodEnd);
      const candidates = readings.filter((r) => {
        const t = Date.parse(r.payload.timestamp);
        return !Number.isNaN(t);
      });
      const startCandidates = candidates
        .filter((r) => Date.parse(r.payload.timestamp) <= startMs)
        .sort((a, b) => Date.parse(b.payload.timestamp) - Date.parse(a.payload.timestamp));
      const endCandidates = candidates
        .filter((r) => Date.parse(r.payload.timestamp) <= endMs)
        .sort((a, b) => Date.parse(b.payload.timestamp) - Date.parse(a.payload.timestamp));
      const startR: any = startCandidates[0] ?? null;
      const endR: any = endCandidates[0] ?? null;
      if (!startR || !endR) {
        throw new AppError(
          422,
          "insufficient_readings",
          "Accepted readings at or before both billing period boundaries are required"
        );
      }
      if (startR.id === endR.id || readingKey(startR) === readingKey(endR) || Date.parse(startR.payload.timestamp) === Date.parse(endR.payload.timestamp)) {
        throw new AppError(422, "insufficient_readings", "Starting and ending readings must be distinct");
      }
      if (readingCumulativeKwh(startR) < 0 || readingCumulativeKwh(endR) < 0) {
        throw new AppError(422, "invalid_reading", "Cumulative readings are invalid");
      }
      if (readingCumulativeKwh(endR) < readingCumulativeKwh(startR)) {
        throw new AppError(422, "meter_reset", "Cumulative readings decreased");
      }
      const startMeterId2 = startR.meterId;
      const endMeterId2 = endR.meterId;
      if (startMeterId2 !== endMeterId2 && startMeterId2 !== meter.id && startMeterId2 !== meterKey && endMeterId2 !== meter.id && endMeterId2 !== meterKey) {
        throw new AppError(422, "insufficient_readings", "Starting and ending readings must belong to the same meter");
      }

      let tariff: Tariff;
      const applicableAtStart = await this.tariffs.findApplicable(roomId, input.periodStart);
      const applicableAtEnd = await this.tariffs.findApplicable(roomId, input.periodEnd);
      if (
        tariffIdOf(applicableAtStart) !== tariffIdOf(applicableAtEnd) ||
        (applicableAtStart.effectiveTo &&
          Date.parse(applicableAtStart.effectiveTo) < Date.parse(input.periodEnd))
      ) {
        throw new AppError(
          422,
          "tariff_period_conflict",
          "Billing period crosses a tariff change; split it into separate bills"
        );
      }
      if (input.tariffId) {
        const found = await tx.tariffs.findById(input.tariffId);
        if (!found) {
          throw new AppError(404, "tariff_not_found", "Tariff not found");
        }
        if (tariffIdOf(found) !== tariffIdOf(applicableAtStart)) {
          throw new AppError(
            422,
            "tariff_not_applicable",
            "Selected tariff is not the applicable rate for this room and billing period"
          );
        }
        tariff = found;
      } else {
        tariff = applicableAtStart;
      }

      const rate = tariffRateOf(tariff);
      if (!Number.isFinite(rate) || rate <= 0) {
        throw new AppError(422, "invalid_tariff", "Tariff rate is invalid");
      }
      const consumptionKwh = computeConsumption(readingCumulativeKwh(startR), readingCumulativeKwh(endR));
      if (!Number.isFinite(consumptionKwh) || consumptionKwh < 0) {
        throw new AppError(422, "invalid_calculation", "Consumption is invalid");
      }
      const electricityChargeNpr = computeElectricityCharge(consumptionKwh, rate);

      const createdAt = new Date().toISOString();
      const billId = `bill_${randomUUID().slice(0, 16)}`;
      const bill: Bill = {
        billId,
        id: billId,
        roomId,
        meterId: meter.id,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        startingReadingId: readingKey(startR),
        endingReadingId: readingKey(endR),
        startingCumulativeKwh: readingCumulativeKwh(startR),
        endingCumulativeKwh: readingCumulativeKwh(endR),
        consumptionKwh,
        tariffId: tariffIdOf(tariff),
        rateNprPerKwh: rate,
        electricityChargeNpr,
        status: "draft",
        createdAt,
        currency: "USD",
        roundingRule: BILLING_ROUNDING_RULE,
        precision: { kwh: 1_000_000, npr: 100 }
      };
      return bill;
    }
  }

  /**
   * Proposes the next billing period for a room: from the end of its last bill (or its first
   * accepted reading, or the start of the current tariff, whichever is latest) to its newest
   * accepted reading.
   */
  async suggestPeriod(roomId: string): Promise<{ periodStart: string; periodEnd: string }> {
    const readings = (await this.repositories.readings.list({ roomId }))
      .filter((reading) => reading.status === "accepted")
      .map((reading) => Date.parse(reading.payload.timestamp))
      .filter((time) => !Number.isNaN(time))
      .sort((a, b) => a - b);
    const first = readings[0];
    const latest = readings[readings.length - 1];
    if (first === undefined || latest === undefined || first === latest) {
      throw new AppError(422, "insufficient_readings", "At least two accepted meter readings are needed to bill this room");
    }
    let start = first;
    for (const bill of await this.repositories.bills.list()) {
      if (bill.roomId !== roomId) continue;
      const { end } = periodOf(bill);
      if (!Number.isNaN(end)) start = Math.max(start, end);
    }
    const tariff = await this.tariffs.findApplicable(roomId, new Date(latest).toISOString());
    start = Math.max(start, Date.parse(tariff.effectiveFrom));
    if (start >= latest) {
      throw new AppError(422, "no_new_readings", "There are no new meter readings to bill since the last bill");
    }
    return { periodStart: new Date(start).toISOString(), periodEnd: new Date(latest).toISOString() };
  }

  async issue(billId: string, actor: string): Promise<Bill> {
    const result = await this.repositories.transaction(async (tx) => {
      const record: unknown = await tx.bills.findById(billId);
      if (!record || typeof record !== "object" || !("billId" in record)) {
        throw new AppError(404, "bill_not_found", "Bill not found");
      }
      const bill = record as Bill;
      if (bill.status !== "draft") {
        throw new AppError(409, "bill_not_draft", "Only draft bills can be issued");
      }

      // Attach the landlord's receive wallets once, so every issued bill shows
      // the same payment details without re-uploading a QR each time.
      if (!(bill as any).receiveWallets || (bill as any).receiveWallets.length === 0) {
        try {
          const room: any = await (tx.rooms as any).findById?.(bill.roomId);
          const property: any = room?.propertyId
            ? await (tx.properties as any)?.findById?.(room.propertyId)
            : null;
          const landlordId: string | undefined = property?.ownerId ?? room?.ownerId;
          if (landlordId && tx.userWallets) {
            const wallets = await tx.userWallets.listByUserId(landlordId);
            const active = (wallets || []).filter((wallet: any) => wallet.isActive !== false);
            if (active.length > 0) {
              (bill as any).receiveWallets = active;
            }
          }
        } catch {
          // Wallet attachment is best-effort; issuing must still succeed.
        }
      }

      bill.status = "issued";
      bill.issuedAt = new Date().toISOString();
      await tx.bills.save(bill as any);
      const event = await appendAuditEvent(tx.auditEvents, {
        type: "bill.issued",
        actor,
        at: new Date().toISOString(),
        payload: {
          billId: bill.billId,
          roomId: bill.roomId,
          consumptionKwh: bill.consumptionKwh,
          tariffId: bill.tariffId,
          rateNprPerKwh: bill.rateNprPerKwh,
          electricityChargeNpr: bill.electricityChargeNpr,
          hasReceiveWallets: Boolean((bill as any).receiveWallets?.length)
        }
      });
      return { bill, event };
    });
    void this.audit.notarize(result.event);
    return result.bill;
  }

  async deleteDraft(billId: string, actor: string): Promise<void> {
    const event = await this.repositories.transaction(async (tx) => {
      const record: unknown = await tx.bills.findById(billId);
      if (!record || typeof record !== "object" || !("billId" in record)) {
        throw new AppError(404, "bill_not_found", "Bill not found");
      }
      const bill = record as Bill;
      if (bill.status !== "draft") {
        throw new AppError(409, "bill_not_draft", "Only draft bills can be deleted");
      }
      await tx.bills.delete(bill.billId);
      return appendAuditEvent(tx.auditEvents, {
        type: "bill.deleted",
        actor,
        payload: {
          billId: bill.billId,
          roomId: bill.roomId,
          periodStart: bill.periodStart,
          periodEnd: bill.periodEnd,
          electricityChargeNpr: bill.electricityChargeNpr
        }
      });
    });
    void this.audit.notarize(event);
  }

  async markPaid(
    billId: string,
    actor: string,
    payment?: WalletPaymentInput
  ): Promise<Bill> {
    const walletPayment = walletPaymentFrom(payment);
    const result = await this.repositories.transaction(async (tx) => {
      const record: unknown = await tx.bills.findById(billId);
      if (!record || typeof record !== "object" || !("billId" in record)) {
        throw new AppError(404, "bill_not_found", "Bill not found");
      }
      const bill = record as Bill;
      if (bill.status !== "issued" && bill.status !== "payment_pending_verification") {
        throw new AppError(409, "bill_not_issued", "Only issued bills can be marked as paid");
      }
      bill.status = "paid";
      bill.paidAt = new Date().toISOString();
      if (walletPayment) bill.payment = walletPayment;
      await tx.bills.save(bill as any);
      const event = await appendAuditEvent(tx.auditEvents, {
        type: "bill.paid",
        actor,
        payload: {
          billId: bill.billId,
          roomId: bill.roomId,
          amountNpr: bill.amountDueNpr ?? bill.electricityChargeNpr,
          ...(walletPayment
            ? {
                paymentMethod: walletPayment.method,
                paymentReference: walletPayment.reference,
                paymentScheme: walletPayment.scheme,
                paymentCapturedAt: walletPayment.capturedAt
              }
            : {})
        }
      });
      return { bill, event };
    });
    void this.audit.notarize(result.event);
    return result.bill;
  }

  /**
   * Renter says "I've paid": record the transaction reference the landlord can
   * check, and park the bill in `payment_pending_verification` until it is
   * confirmed.
   */
  async submitPayment(
    billId: string,
    actor: string,
    input: {
      method?: string;
      transactionId: string;
      reference?: string;
      paidFromWalletId?: string;
      note?: string;
      slipDataUrl?: string;
    }
  ): Promise<Bill> {
    const result = await this.repositories.transaction(async (tx) => {
      const record: unknown = await tx.bills.findById(billId);
      if (!record || typeof record !== "object" || !("billId" in record)) {
        throw new AppError(404, "bill_not_found", "Bill not found");
      }
      const bill = record as Bill & { receiveWallets?: any[] | null };
      if (bill.status !== "issued" && bill.status !== "payment_pending_verification") {
        throw new AppError(409, "bill_not_payable", "This bill is not awaiting payment");
      }

      const wallet = input.paidFromWalletId
        ? (bill.receiveWallets ?? []).find((item) => item.id === input.paidFromWalletId)
        : undefined;

      const details: BillPaymentDetails = {
        method: input.method ?? wallet?.type ?? "other",
        transactionId: input.transactionId,
        reference: input.reference,
        paidFromWalletId: input.paidFromWalletId,
        paidFromLabel: wallet?.label,
        paidFromAccountId: wallet?.accountId,
        note: input.note,
        slipDataUrl: input.slipDataUrl,
        submittedAt: new Date().toISOString()
      };
      (bill as any).paymentDetails = details;
      bill.status = "payment_pending_verification";
      await tx.bills.save(bill as any);

      const event = await appendAuditEvent(tx.auditEvents, {
        type: "bill.payment_submitted",
        actor,
        payload: {
          billId: bill.billId,
          roomId: bill.roomId,
          amountNpr: bill.amountDueNpr ?? bill.electricityChargeNpr,
          method: details.method,
          transactionId: details.transactionId,
          paidFromWalletId: details.paidFromWalletId
        }
      });
      return { bill, event };
    });
    void this.audit.notarize(result.event);
    return result.bill;
  }

  /** Landlord confirms the submitted transaction and closes the bill as paid. */
  async verifyPayment(
    billId: string,
    actor: string,
    input: { transactionId?: string; note?: string } = {}
  ): Promise<Bill> {
    const result = await this.repositories.transaction(async (tx) => {
      const record: unknown = await tx.bills.findById(billId);
      if (!record || typeof record !== "object" || !("billId" in record)) {
        throw new AppError(404, "bill_not_found", "Bill not found");
      }
      const bill = record as Bill;
      if (bill.status !== "payment_pending_verification") {
        throw new AppError(409, "bill_not_pending_verification", "This bill has no payment awaiting verification");
      }
      const details: BillPaymentDetails = {
        ...((bill as any).paymentDetails ?? {}),
        ...(input.transactionId ? { transactionId: input.transactionId } : {}),
        ...(input.note ? { note: input.note } : {}),
        verifiedAt: new Date().toISOString(),
        verifiedBy: actor
      };
      (bill as any).paymentDetails = details;
      bill.status = "paid";
      bill.paidAt = details.verifiedAt;
      await tx.bills.save(bill as any);

      const event = await appendAuditEvent(tx.auditEvents, {
        type: "bill.payment_verified",
        actor,
        at: details.verifiedAt,
        payload: {
          billId: bill.billId,
          roomId: bill.roomId,
          amountNpr: bill.amountDueNpr ?? bill.electricityChargeNpr,
          method: details.method,
          transactionId: details.transactionId
        }
      });
      return { bill, event };
    });
    void this.audit.notarize(result.event);
    return result.bill;
  }
}
