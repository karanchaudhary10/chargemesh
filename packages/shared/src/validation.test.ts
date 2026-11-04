import { describe, expect, it } from "vitest";
import type { SignedReadingPayload } from "./types.js";
import {
  validateReading,
  type ReadingValidationContext
} from "./validation.js";

const NOW = Date.parse("2026-10-23T10:00:00.000Z");

const reading: SignedReadingPayload = {
  meterId: "mtr_room_101",
  roomId: "room_101",
  sequence: 12,
  timestamp: "2026-10-23T09:59:30.000Z",
  cumulativeEnergyKwh: 12.405,
  powerW: 800,
  voltage: 230,
  current: 3.48,
  nonce: "nonce-12"
};

const context = (overrides: Partial<ReadingValidationContext> = {}): ReadingValidationContext => ({
  now: NOW,
  signatureValid: true,
  meterRegistered: true,
  roomMatchesMeter: true,
  duplicateReading: false,
  sequenceAlreadySeen: false,
  maxPowerW: 5_000,
  staleAfterMs: 120_000,
  lastAcceptedSequence: 11,
  lastAcceptedTimestamp: "2026-10-23T09:59:00.000Z",
  lastAcceptedEnergyKwh: 12.4,
  ...overrides
});

describe("validateReading", () => {
  it("accepts a valid signed reading", () => {
    const result = validateReading(reading, context());
    expect(result).toEqual({ status: "accepted", flags: [], reasons: [] });
  });

  it.each([
    ["unregistered meter", { meterRegistered: false }, "unregistered_meter"],
    ["room mismatch", { roomMatchesMeter: false }, "room_mismatch"],
    ["invalid signature", { signatureValid: false }, "signature_invalid"],
    ["duplicate reading", { duplicateReading: true }, "duplicate_reading"],
    ["replayed observed sequence", { sequenceAlreadySeen: true }, "replayed_sequence"],
    ["replayed accepted sequence", { lastAcceptedSequence: 12 }, "replayed_sequence"],
    ["out of order timestamp", { lastAcceptedTimestamp: "2026-10-23T09:59:45.000Z" }, "out_of_order_timestamp"],
    ["meter reset", { lastAcceptedEnergyKwh: 13 }, "meter_reset"]
  ])("rejects %s", (_label, override, flag) => {
    const result = validateReading(reading, context(override));
    expect(result.status).toBe("rejected");
    expect(result.flags).toContain(flag);
  });

  it("rejects a reading too far in the future", () => {
    const result = validateReading(
      { ...reading, timestamp: "2026-10-23T10:05:00.000Z" },
      context()
    );
    expect(result.status).toBe("rejected");
    expect(result.flags).toContain("future_timestamp");
  });

  it("rejects a stale reading", () => {
    const result = validateReading(
      { ...reading, timestamp: "2026-10-23T09:55:00.000Z" },
      context()
    );
    expect(result.status).toBe("rejected");
    expect(result.flags).toContain("stale_timestamp");
  });

  it("quarantines implausible power", () => {
    const result = validateReading({ ...reading, powerW: 6_000 }, context());
    expect(result.status).toBe("quarantined");
    expect(result.flags).toContain("suspicious_power");
  });

  it("quarantines an implausible energy jump", () => {
    const result = validateReading(
      { ...reading, cumulativeEnergyKwh: 13 },
      context({
        lastAcceptedTimestamp: "2026-10-23T09:58:30.000Z",
        lastAcceptedEnergyKwh: 12.4
      })
    );
    expect(result.status).toBe("quarantined");
    expect(result.flags).toContain("suspicious_energy_jump");
  });

  it("prefers rejection when both rejecting and quarantine flags exist", () => {
    const result = validateReading(
      { ...reading, powerW: 9_000 },
      context({ signatureValid: false })
    );
    expect(result.status).toBe("rejected");
    expect(result.flags).toEqual(expect.arrayContaining(["signature_invalid", "suspicious_power"]));
  });
});
