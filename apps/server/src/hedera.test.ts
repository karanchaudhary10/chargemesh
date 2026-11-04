import { describe, expect, it } from "vitest";
import { attachAuditHash, computeAuditHash } from "@chargemesh/shared";

describe("HCS audit hashing", () => {
  it("is deterministic", () => {
    const payload = attachAuditHash({
      eventType: "reading.accepted",
      schemaVersion: "1.0.0",
      meterId: "mtr_1",
      roomId: "room_1",
      readingId: "r1",
      sequence: 1,
      timestamp: "2026-01-01T00:00:00.000Z",
      cumulativeKwh: 10
    } as any);
    const h1 = computeAuditHash(payload);
    const h2 = computeAuditHash(payload);
    expect(h1).toBe(h2);
  });

  it("changes when protected field changes", () => {
    const p1 = attachAuditHash({
      eventType: "reading.accepted",
      schemaVersion: "1.0.0",
      meterId: "mtr_1",
      roomId: "room_1",
      readingId: "r1",
      sequence: 1,
      timestamp: "2026-01-01T00:00:00.000Z",
      cumulativeKwh: 10
    } as any);
    const p2 = attachAuditHash({
      eventType: "reading.accepted",
      schemaVersion: "1.0.0",
      meterId: "mtr_1",
      roomId: "room_1",
      readingId: "r1",
      sequence: 1,
      timestamp: "2026-01-01T00:00:00.000Z",
      cumulativeKwh: 11
    } as any);
    expect(computeAuditHash(p1)).not.toBe(computeAuditHash(p2));
  });

  it("bill hash deterministic", () => {
    const p = attachAuditHash({
      eventType: "bill.generated",
      schemaVersion: "1.0.0",
      billId: "b1",
      roomId: "room_1",
      startingReadingId: "r1",
      endingReadingId: "r2",
      tariffId: "t1",
      consumptionKwh: 5,
      electricityChargeNpr: 50
    } as any);
    expect(computeAuditHash(p)).toBe(computeAuditHash(p));
  });
});
