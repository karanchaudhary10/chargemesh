import { DEVICE_TYPE, SIGNATURE_ALGORITHM } from "./reading.js";

export const OUTPUT_SCHEMA = "chargemesh.simulated-device-readings.v1";
export const SIMULATION_NOTICE =
  "SIMULATED DATA ONLY: software-generated readings, not physical ESP32 or mains measurements.";

export const CANONICALIZATION_DESCRIPTION =
  "UTF-8 JSON with object keys sorted lexicographically at every level, no whitespace, arrays preserved in order, undefined properties omitted, and the top-level signature field excluded.";

export function readingsEnvelope(readings, { keyFingerprint } = {}) {
  return {
    schema: OUTPUT_SCHEMA,
    simulator: "chargemesh-software-esp32",
    simulated: true,
    notice: SIMULATION_NOTICE,
    deviceType: DEVICE_TYPE,
    meterId: readings[0]?.meterId ?? null,
    keyFingerprint: keyFingerprint ?? null,
    signature: {
      algorithm: SIGNATURE_ALGORITHM,
      encoding: "base64",
      signedPayload: "canonical JSON of each reading with the signature field omitted"
    },
    canonicalization: CANONICALIZATION_DESCRIPTION,
    generatedAt: new Date().toISOString(),
    readings
  };
}

export function extractReadings(document) {
  if (Array.isArray(document)) {
    return document;
  }
  if (!document || typeof document !== "object") {
    throw new Error("Input must be a reading, an array of readings, or a readings envelope");
  }
  if (Array.isArray(document.readings)) {
    return document.readings;
  }
  if (typeof document.signature === "string") {
    return [document];
  }
  throw new Error("Input does not contain any readings");
}
