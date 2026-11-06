import { describe, expect, it } from "vitest";
import type { EvidenceBundle, ReadingFlag, SessionEvidence } from "./types.js";
import { evaluateAttestation } from "./attestation.js";

function session(overrides: Partial<SessionEvidence> = {}): SessionEvidence {
  return {
    sessionId: "ses_1",
    roomId: "room_1",
    meterId: "mtr_1",
    status: "closed",
    tariffNprPerKwh: 13.5,
    startEnergyKwh: 10,
    endEnergyKwh: 12,
    energyKwh: 2,
    amountNpr: 27,
    readingCount: 2,
    acceptedCount: 2,
    rejectedCount: 0,
    quarantinedCount: 0,
    flags: [],
    readings: [
      {
        id: "rdg_1",
        sequence: 1,
        timestamp: "2026-10-23T09:00:00.000Z",
        cumulativeEnergyKwh: 10,
        powerW: 500,
        status: "accepted",
        flags: []
      },
      {
        id: "rdg_2",
        sequence: 2,
        timestamp: "2026-10-23T10:00:00.000Z",
        cumulativeEnergyKwh: 12,
        powerW: 500,
        status: "accepted",
        flags: []
      }
    ],
    auditEventIds: ["evt_1", "evt_2"],
    auditChainValid: true,
    ...overrides
  };
}

function bundle(sessions: SessionEvidence[], chainValid = true): EvidenceBundle {
  return {
    generatedAt: "2026-10-23T10:00:00.000Z",
    evidenceHash: "a".repeat(64),
    readingEvidenceHash: "c".repeat(64),
    audit: { eventCount: 2, headHash: "b".repeat(64), chainValid },
    sessions
  };
}

describe("CRE attestation policy", () => {
  it("verifies balanced, signed evidence", () => {
    expect(evaluateAttestation(bundle([session()]))).toEqual({
      status: "verified",
      findings: []
    });
  });

  it("flags billing arithmetic mismatches", () => {
    const result = evaluateAttestation(bundle([session({ amountNpr: 30 })]));
    expect(result.status).toBe("flagged");
    expect(result.findings.map((finding) => finding.code)).toContain("amount_mismatch");
  });

  it("flags rejected readings and broken audit chains", () => {
    const result = evaluateAttestation(
      bundle(
        [
          session({
            acceptedCount: 1,
            rejectedCount: 1,
            flags: ["signature_invalid"] as ReadingFlag[]
          })
        ],
        false
      )
    );
    expect(result.status).toBe("flagged");
    expect(result.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "audit_chain_broken",
        "rejected_readings_present",
        "signature_or_sequence_anomaly"
      ])
    );
  });

  it("returns review for active sessions without hard errors", () => {
    const result = evaluateAttestation(bundle([session({ status: "active" })]));
    expect(result.status).toBe("review");
    expect(result.findings.map((finding) => finding.code)).toContain("session_not_closed");
  });
});
