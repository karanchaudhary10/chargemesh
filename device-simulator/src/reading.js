import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { canonicalPayload } from "./canonical.js";

export const DEFAULT_METER_ID = "METER-001";
export const DEVICE_TYPE = "simulated-esp32";
export const SIGNATURE_ALGORITHM = "Ed25519";

const KWH_PRECISION = 1_000_000;

export function roundKwh(value) {
  return Math.round(value * KWH_PRECISION) / KWH_PRECISION;
}

function toUtcIso(timestamp) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    throw new Error("timestamp must be a valid UTC date");
  }
  return date.toISOString();
}

function isCanonicalUtcTimestamp(value) {
  if (typeof value !== "string") {
    return false;
  }
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function validateReadingShape(reading, { requireSignature = false } = {}) {
  const errors = [];

  if (!reading || typeof reading !== "object" || Array.isArray(reading)) {
    return ["reading must be an object"];
  }
  if (typeof reading.meterId !== "string" || reading.meterId.trim() === "") {
    errors.push("meterId must be a non-empty string");
  }
  if (!Number.isFinite(reading.cumulativeKwh) || reading.cumulativeKwh < 0) {
    errors.push("cumulativeKwh must be a finite non-negative number");
  }
  if (!isCanonicalUtcTimestamp(reading.timestamp)) {
    errors.push("timestamp must be a canonical UTC ISO 8601 string");
  }
  if (!Number.isInteger(reading.sequence) || reading.sequence < 1) {
    errors.push("sequence must be a positive integer");
  }
  if (reading.deviceType !== DEVICE_TYPE) {
    errors.push(`deviceType must be "${DEVICE_TYPE}"`);
  }
  if (reading.simulated !== true) {
    errors.push("simulated must be true");
  }
  if (requireSignature && (typeof reading.signature !== "string" || reading.signature === "")) {
    errors.push("signature must be a non-empty base64 string");
  }

  return errors;
}

function assertValidReading(reading, options) {
  const errors = validateReadingShape(reading, options);
  if (errors.length > 0) {
    throw new Error(`Invalid reading: ${errors.join("; ")}`);
  }
}

export function createReading({
  meterId = DEFAULT_METER_ID,
  cumulativeKwh,
  timestamp = new Date(),
  sequence,
  privateKeyPem
}) {
  if (typeof privateKeyPem !== "string" || privateKeyPem.trim() === "") {
    throw new Error("privateKeyPem is required to sign a reading");
  }

  const reading = {
    meterId: meterId.trim(),
    cumulativeKwh: roundKwh(cumulativeKwh),
    timestamp: toUtcIso(timestamp),
    sequence,
    deviceType: DEVICE_TYPE,
    simulated: true
  };
  assertValidReading(reading);

  const privateKey = createPrivateKey(privateKeyPem);
  const signature = sign(
    null,
    Buffer.from(canonicalPayload(reading), "utf8"),
    privateKey
  ).toString("base64");

  return { ...reading, signature };
}

export function verifyReading(reading, publicKeyPem) {
  try {
    assertValidReading(reading, { requireSignature: true });
    const publicKey = createPublicKey(publicKeyPem);
    const valid = verify(
      null,
      Buffer.from(canonicalPayload(reading), "utf8"),
      publicKey,
      Buffer.from(reading.signature, "base64")
    );
    return valid
      ? { valid: true, reason: null }
      : { valid: false, reason: "signature does not match the canonical reading payload" };
  } catch (error) {
    return {
      valid: false,
      reason: error instanceof Error ? error.message : "reading verification failed"
    };
  }
}

export function generateReadings({
  count = 1,
  startingCumulativeKwh = 0,
  incrementKwh = 0.25,
  startingSequence = 1,
  meterId = DEFAULT_METER_ID,
  timestampFactory = () => new Date(),
  privateKeyPem
}) {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("count must be a positive integer");
  }
  if (!Number.isFinite(startingCumulativeKwh) || startingCumulativeKwh < 0) {
    throw new Error("startingCumulativeKwh must be a finite non-negative number");
  }
  if (!Number.isFinite(incrementKwh) || incrementKwh <= 0) {
    throw new Error("incrementKwh must be a finite positive number");
  }
  if (!Number.isInteger(startingSequence) || startingSequence < 1) {
    throw new Error("startingSequence must be a positive integer");
  }
  if (typeof timestampFactory !== "function") {
    throw new Error("timestampFactory must be a function");
  }

  const readings = [];
  for (let index = 0; index < count; index += 1) {
    readings.push(
      createReading({
        meterId,
        cumulativeKwh: roundKwh(startingCumulativeKwh + incrementKwh * index),
        timestamp: timestampFactory(index),
        sequence: startingSequence + index,
        privateKeyPem
      })
    );
  }
  return readings;
}

export function tamperCumulativeKwh(reading, deltaKwh = 1) {
  assertValidReading(reading, { requireSignature: true });
  if (!Number.isFinite(deltaKwh)) {
    throw new Error("deltaKwh must be a finite number");
  }
  const tamperedKwh = roundKwh(reading.cumulativeKwh + deltaKwh);
  if (tamperedKwh < 0) {
    throw new Error("tampered cumulativeKwh cannot be negative");
  }
  return { ...reading, cumulativeKwh: tamperedKwh };
}
