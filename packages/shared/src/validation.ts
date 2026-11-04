import type { ReadingFlag, ReadingStatus, SignedReadingPayload } from "./types.js";

export interface ReadingValidationContext {
  now: number;
  signatureValid: boolean;
  meterRegistered: boolean;
  roomMatchesMeter: boolean;
  duplicateReading: boolean;
  sequenceAlreadySeen: boolean;
  maxPowerW: number;
  staleAfterMs: number;
  lastAcceptedSequence?: number;
  lastAcceptedTimestamp?: string;
  lastAcceptedEnergyKwh?: number;
  futureSkewMs?: number;
  energyJumpTolerance?: number;
}

export interface ReadingValidationResult {
  status: ReadingStatus;
  flags: ReadingFlag[];
  reasons: string[];
}

const REJECT_FLAGS: ReadonlySet<ReadingFlag> = new Set([
  "unregistered_meter",
  "room_mismatch",
  "signature_invalid",
  "future_timestamp",
  "stale_timestamp",
  "duplicate_reading",
  "replayed_sequence",
  "out_of_order_timestamp",
  "meter_reset"
]);

const QUARANTINE_FLAGS: ReadonlySet<ReadingFlag> = new Set([
  "suspicious_power",
  "suspicious_energy_jump"
]);

export function validateReading(
  reading: SignedReadingPayload,
  context: ReadingValidationContext
): ReadingValidationResult {
  const flags: ReadingFlag[] = [];
  const reasons: string[] = [];
  const timestamp = Date.parse(reading.timestamp);
  const futureSkewMs = context.futureSkewMs ?? 60_000;
  const jumpTolerance = context.energyJumpTolerance ?? 1.5;

  if (!context.meterRegistered) {
    flags.push("unregistered_meter");
    reasons.push("Meter is not registered");
  }

  if (context.meterRegistered && !context.roomMatchesMeter) {
    flags.push("room_mismatch");
    reasons.push("Signed room does not match the meter's registered room");
  }

  if (!context.signatureValid) {
    flags.push("signature_invalid");
    reasons.push("Ed25519 signature does not match the signed payload");
  }

  if (timestamp > context.now + futureSkewMs) {
    flags.push("future_timestamp");
    reasons.push("Reading timestamp is in the future");
  }

  if (context.now - timestamp > context.staleAfterMs) {
    flags.push("stale_timestamp");
    reasons.push("Reading is older than the allowed freshness window");
  }

  if (context.duplicateReading) {
    flags.push("duplicate_reading");
    reasons.push("This signed reading has already been submitted");
  }

  if (
    context.sequenceAlreadySeen ||
    (context.lastAcceptedSequence !== undefined &&
      reading.sequence <= context.lastAcceptedSequence)
  ) {
    flags.push("replayed_sequence");
    reasons.push(
      context.sequenceAlreadySeen
        ? `Sequence ${reading.sequence} has already been observed for this meter`
        : `Sequence ${reading.sequence} is not newer than accepted sequence ${context.lastAcceptedSequence}`
    );
  }

  if (context.lastAcceptedTimestamp !== undefined) {
    const lastTimestamp = Date.parse(context.lastAcceptedTimestamp);
    if (timestamp <= lastTimestamp) {
      flags.push("out_of_order_timestamp");
      reasons.push("Reading timestamp is not newer than the last accepted reading");
    }
  }

  const cumulativeEnergyKwh =
    (reading as any).cumulativeEnergyKwh ?? (reading as any).cumulativeKwh;
  if (
    context.lastAcceptedEnergyKwh !== undefined &&
    cumulativeEnergyKwh !== undefined &&
    cumulativeEnergyKwh + 1e-9 < context.lastAcceptedEnergyKwh
  ) {
    flags.push("meter_reset");
    reasons.push("Cumulative energy decreased; meter reset or rollover must be investigated");
  }

  if (reading.powerW !== undefined && reading.powerW > context.maxPowerW) {
    flags.push("suspicious_power");
    reasons.push(`Power ${reading.powerW} W exceeds the meter limit of ${context.maxPowerW} W`);
  }

  if (
    context.lastAcceptedEnergyKwh !== undefined &&
    context.lastAcceptedTimestamp !== undefined
  ) {
    const cumulativeEnergyKwh =
      (reading as any).cumulativeEnergyKwh ?? (reading as any).cumulativeKwh;
    const deltaEnergy = cumulativeEnergyKwh - context.lastAcceptedEnergyKwh;
    const deltaMs = timestamp - Date.parse(context.lastAcceptedTimestamp);
    if (deltaEnergy > 0 && deltaMs > 0) {
      const impliedPowerW = (deltaEnergy * 3_600_000_000) / deltaMs;
      if (impliedPowerW > context.maxPowerW * jumpTolerance) {
        flags.push("suspicious_energy_jump");
        reasons.push(
          `Energy increased as if drawing ${Math.round(impliedPowerW)} W, above the plausibility limit`
        );
      }
    }
  }

  if (flags.some((flag) => REJECT_FLAGS.has(flag))) {
    return { status: "rejected", flags, reasons };
  }

  if (flags.some((flag) => QUARANTINE_FLAGS.has(flag))) {
    return { status: "quarantined", flags, reasons };
  }

  return { status: "accepted", flags, reasons };
}

export function isBillable(status: ReadingStatus): boolean {
  return status === "accepted";
}

export function describeFlag(flag: ReadingFlag): string {
  const descriptions: Record<ReadingFlag, string> = {
    unregistered_meter: "Meter public key is not registered",
    room_mismatch: "Reading claims a different room than the registered meter",
    signature_invalid: "Digital signature verification failed",
    future_timestamp: "Timestamp is ahead of server time",
    stale_timestamp: "Timestamp is outside the freshness window",
    duplicate_reading: "Identical signed reading was already received",
    replayed_sequence: "Sequence number was already used",
    out_of_order_timestamp: "Timestamp is older than the last accepted reading",
    meter_reset: "Cumulative energy decreased",
    suspicious_power: "Instantaneous power is implausible for this meter",
    suspicious_energy_jump: "Energy jump implies implausible power"
  };
  return descriptions[flag];
}
