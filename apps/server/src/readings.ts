import { randomUUID } from "node:crypto";
import {
  validateReading,
  type Reading,
  type ReadingSubmission,
  type RawSignedReadingPayload,
  type SignedReadingPayload
} from "@chargemesh/shared";
import {
  hashReadingPayload,
  readingIdFor,
  verifyReadingSignature
} from "@chargemesh/shared/node";
import type { Config } from "./config.js";
import type { Repositories } from "./repositories.js";
import { appendAuditEvent } from "./audit-core.js";
import type { AuditService } from "./audit.js";
import { AppError } from "./errors.js";

export class ReadingService {
  constructor(
    private readonly repositories: Repositories,
    private readonly audit: AuditService,
    private readonly config: Config
  ) {}

  async submit(
    submission: ReadingSubmission,
    source: "meter",
    now = Date.now()
  ): Promise<Reading> {
    if (!submission || typeof submission !== "object") {
      throw new AppError(400, "validation_failed", "Invalid reading payload");
    }
    if (typeof (submission as any).signature !== "string" || (submission as any).signature.trim() === "") {
      throw new AppError(400, "validation_failed", "Missing signature");
    }
    const { signature, ...raw } = submission as any;
    const rawPayload = raw as RawSignedReadingPayload;
    const energyKwh =
      (rawPayload as any).cumulativeEnergyKwh ?? (rawPayload as any).cumulativeKwh;
    if (!rawPayload.meterId || typeof rawPayload.meterId !== "string") {
      throw new AppError(400, "validation_failed", "meterId is required");
    }
    if (
      typeof rawPayload.sequence !== "number" ||
      !Number.isInteger(rawPayload.sequence) ||
      rawPayload.sequence < 1
    ) {
      throw new AppError(400, "validation_failed", "sequence must be a positive integer");
    }
    if (
      typeof energyKwh !== "number" ||
      !Number.isFinite(energyKwh) ||
      energyKwh < 0
    ) {
      throw new AppError(400, "validation_failed", "cumulativeEnergyKwh must be a finite non-negative number");
    }
    if (typeof rawPayload.timestamp !== "string" || Number.isNaN(Date.parse(rawPayload.timestamp))) {
      throw new AppError(400, "validation_failed", "timestamp is invalid");
    }
    const payloadHash = hashReadingPayload(rawPayload);
    const result = await this.repositories.transaction(async (tx) => {
      const meter = await tx.meters.findById(rawPayload.meterId);
      if (!meter) {
        throw new AppError(404, "meter_not_found", "Meter not found");
      }
      if (meter.status !== "active") {
        throw new AppError(422, "meter_not_active", "Meter is not active");
      }
      if (rawPayload.roomId && meter.roomId && rawPayload.roomId !== meter.roomId) {
        throw new AppError(422, "room_mismatch", "Reading roomId does not match registered meter room");
      }

      const duplicate = await tx.readings.findByPayloadHash(payloadHash);
      if (duplicate) {
        throw new AppError(409, "duplicate_reading", "Duplicate reading");
      }
      const existingSequence = await tx.readings.findByMeterAndSequence(
        rawPayload.meterId,
        rawPayload.sequence
      );
      if (existingSequence) {
        throw new AppError(409, "replayed_sequence", "Sequence already used");
      }
      if (
        meter.lastAcceptedSequence !== undefined &&
        rawPayload.sequence <= meter.lastAcceptedSequence
      ) {
        throw new AppError(409, "sequence_conflict", "Sequence must be greater than last accepted sequence");
      }
      if (
        meter.lastAcceptedEnergyKwh !== undefined &&
        energyKwh + 1e-9 < meter.lastAcceptedEnergyKwh
      ) {
        throw new AppError(422, "meter_reset", "Cumulative energy decreased");
      }

      const signatureValid = verifyReadingSignature(rawPayload, signature, meter.publicKeyPem);
      if (!signatureValid) {
        throw new AppError(401, "invalid_signature", "Invalid signature");
      }

      const internalPayload: SignedReadingPayload = {
        ...(rawPayload as any),
        cumulativeEnergyKwh: energyKwh
      };
      if (internalPayload.roomId === undefined && meter.roomId) {
        internalPayload.roomId = meter.roomId;
      }

      const validation = validateReading(internalPayload, {
        now,
        signatureValid: true,
        meterRegistered: true,
        roomMatchesMeter: meter.roomId === (internalPayload.roomId ?? meter.roomId),
        duplicateReading: false,
        sequenceAlreadySeen: false,
        maxPowerW: meter.maxPowerW ?? this.config.maxPowerW,
        staleAfterMs: meter.staleAfterMs ?? this.config.staleAfterMs,
        lastAcceptedSequence: meter.lastAcceptedSequence,
        lastAcceptedTimestamp: meter.lastAcceptedAt,
        lastAcceptedEnergyKwh: meter.lastAcceptedEnergyKwh,
        futureSkewMs: 60_000,
        energyJumpTolerance: this.config.energyJumpTolerance
      });
      if (validation.status === "rejected") {
        throw new AppError(400, validation.flags[0] ?? "invalid_reading", validation.reasons[0] ?? "Invalid reading");
      }

      const activeSession = internalPayload.roomId
        ? await tx.bills.findActiveByRoom(internalPayload.roomId)
        : meter.roomId
          ? await tx.bills.findActiveByRoom(meter.roomId)
          : null;
      const receivedAt = new Date(now).toISOString();
      const readingId = readingIdFor(rawPayload);
      const reading: Reading = {
        id: readingId,
        readingId,
        payloadHash,
        meterId: rawPayload.meterId,
        roomId: internalPayload.roomId,
        payload: internalPayload,
        signedPayload: rawPayload,
        signature,
        status: validation.status,
        flags: validation.flags,
        reasons: validation.reasons,
        receivedAt,
        source,
        sessionId: activeSession?.id
      };
      await tx.readings.save(reading);

      meter.lastSeenAt = receivedAt;
      meter.lastSequenceSeen = Math.max(meter.lastSequenceSeen ?? 0, rawPayload.sequence);
      if (validation.status === "accepted") {
        meter.lastAcceptedSequence = rawPayload.sequence;
        meter.lastAcceptedAt = rawPayload.timestamp;
        meter.lastAcceptedEnergyKwh = energyKwh;
      }
      await tx.meters.save(meter);

      const event = await appendAuditEvent(tx.auditEvents, {
        type: `reading.${validation.status}`,
        actor: `meter:${rawPayload.meterId}`,
        at: receivedAt,
        payload: {
          readingId: reading.id,
          payloadHash,
          meterId: rawPayload.meterId,
          roomId: reading.roomId ?? null,
          sessionId: reading.sessionId ?? null,
          sequence: rawPayload.sequence,
          status: validation.status,
          flags: validation.flags,
          reasons: validation.reasons
        }
      });

      return { reading, event };
    });

    void this.audit.notarize(result.event);
    return result.reading;
  }
}
