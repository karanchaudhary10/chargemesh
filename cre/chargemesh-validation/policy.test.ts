import { describe, expect, it } from "vitest";
import type { EvidenceBundle, ReadingEvidence } from "./policy.js";
import { evaluateVerification } from "./policy.js";

const bundle: EvidenceBundle = {
  generatedAt: "2026-10-23T10:00:00.000Z",
  evidenceHash: "a".repeat(64),
  readingEvidenceHash: "b".repeat(64),
  audit: { eventCount: 0, headHash: "0".repeat(64), chainValid: true },
  sessions: []
};

const reading = (overrides: Partial<ReadingEvidence> = {}): ReadingEvidence => ({
  id: "reading-1",
  meterId: "meter-1",
  signedPayload: {
    sequence: 1,
    timestamp: "2026-10-23T09:00:00.000Z",
    cumulativeEnergyKwh: 2
  },
  signature: "valid-signature",
  publicKeyPem: "meter-public-key",
  status: "accepted",
  flags: [],
  reasons: [],
  maxPowerW: 5_000,
  energyJumpTolerance: 1.5,
  ...overrides
});

describe("CRE reading verification", () => {
  it("verifies accepted readings with complete signature evidence", () => {
    expect(evaluateVerification(bundle, [reading()])).toMatchObject({
      status: "verified",
      findings: []
    });
  });

  it("flags tampered signatures and duplicate meter sequences", () => {
    const result = evaluateVerification(bundle, [
      reading({ flags: ["signature_invalid"], reasons: ["Signature does not match"] }),
      reading({
        id: "reading-2",
        flags: ["replayed_sequence"],
        reasons: ["Sequence was already used"]
      })
    ]);

    expect(result.status).toBe("flagged");
    expect(result.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(["reading_signature_invalid", "reading_replayed_sequence", "duplicate_sequence"])
    );
  });

  it("flags suspicious energy jumps and quarantined readings", () => {
    const result = evaluateVerification(bundle, [
      reading({
        status: "quarantined",
        flags: ["suspicious_energy_jump"],
        reasons: ["Implausible implied power"]
      }),
      reading({
        id: "reading-2",
        signedPayload: {
          sequence: 2,
          timestamp: "2026-10-23T09:01:00.000Z",
          cumulativeEnergyKwh: 10
        }
      })
    ]);

    expect(result.status).toBe("flagged");
    expect(result.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "quarantined_reading",
        "reading_suspicious_energy_jump",
        "energy_jump_exceeds_meter_limit"
      ])
    );
  });
});
