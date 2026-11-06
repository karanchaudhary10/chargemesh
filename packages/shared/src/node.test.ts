import { describe, expect, it } from "vitest";
import type { AuditEvent, EvidenceBundle, SignedReadingPayload } from "./types.js";
import { stableStringify } from "./canonical.js";
import {
  GENESIS_HASH,
  auditEventHash,
  computeEvidenceHash,
  generateMeterKeyPair,
  hashReadingPayload,
  readingIdFor,
  signReading,
  verifyAuditChain,
  verifyReadingSignature
} from "./node.js";

const payload: SignedReadingPayload = {
  meterId: "mtr_1",
  roomId: "room_1",
  sequence: 1,
  timestamp: "2026-10-23T10:00:00.000Z",
  cumulativeEnergyKwh: 1.25,
  powerW: 500,
  voltage: 230,
  current: 2.17,
  nonce: "abc"
};

function event(seq: number, prevHash: string, type = "reading.accepted"): AuditEvent {
  const base = {
    id: `evt_${seq}`,
    seq,
    type,
    at: `2026-10-23T10:00:0${seq}.000Z`,
    actor: "test",
    payload: { seq },
    prevHash
  };
  return { ...base, hash: auditEventHash(base) };
}

describe("canonical JSON", () => {
  it("sorts object keys and omits undefined values", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 }, skip: undefined })).toBe(
      '{"a":{"c":3,"d":2},"b":1}'
    );
  });

  it("rejects cycles and non-finite numbers", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => stableStringify(cyclic)).toThrow(/cyclic/);
    expect(() => stableStringify({ value: Number.NaN })).toThrow(/non-finite/);
  });
});

describe("meter signatures", () => {
  it("verifies a signature over the canonical payload", () => {
    const keys = generateMeterKeyPair();
    const signature = signReading(payload, keys.privateKeyPem);
    expect(verifyReadingSignature(payload, signature, keys.publicKeyPem)).toBe(true);
  });

  it("rejects a tampered payload or signature", () => {
    const keys = generateMeterKeyPair();
    const signature = signReading(payload, keys.privateKeyPem);
    expect(
      verifyReadingSignature(
        { ...payload, cumulativeEnergyKwh: 9.99 },
        signature,
        keys.publicKeyPem
      )
    ).toBe(false);
    expect(verifyReadingSignature(payload, "not-base64", keys.publicKeyPem)).toBe(false);
  });

  it("derives deterministic payload and reading hashes", () => {
    expect(hashReadingPayload(payload)).toMatch(/^[a-f0-9]{64}$/);
    expect(readingIdFor(payload)).toBe(`rdg_${hashReadingPayload(payload).slice(0, 24)}`);
  });
});

describe("audit hash chain", () => {
  it("validates a correctly linked chain", () => {
    const first = event(1, GENESIS_HASH);
    const second = event(2, first.hash, "session.closed");
    const result = verifyAuditChain([second, first]);
    expect(result.valid).toBe(true);
    expect(result.count).toBe(2);
    expect(result.headHash).toBe(second.hash);
  });

  it("detects payload tampering", () => {
    const first = event(1, GENESIS_HASH);
    const second = event(2, first.hash);
    const tampered = { ...second, payload: { seq: 999 } };
    const result = verifyAuditChain([first, tampered]);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(second.id);
  });

  it("detects missing events and broken previous links", () => {
    const first = event(1, GENESIS_HASH);
    const third = event(3, first.hash);
    expect(verifyAuditChain([first, third]).valid).toBe(false);
    expect(verifyAuditChain([first, event(2, "f".repeat(64))]).valid).toBe(false);
  });
});

describe("evidence hashes", () => {
  it("stays stable across object key order and changes with content", () => {
    const bundle: Pick<EvidenceBundle, "sessions" | "audit" | "readingEvidenceHash"> = {
      audit: { eventCount: 2, headHash: "a".repeat(64), chainValid: true },
      sessions: [],
      readingEvidenceHash: "b".repeat(64)
    };
    const reordered: Pick<EvidenceBundle, "sessions" | "audit" | "readingEvidenceHash"> = {
      sessions: [],
      audit: { chainValid: true, headHash: "a".repeat(64), eventCount: 2 },
      readingEvidenceHash: "b".repeat(64)
    };
    expect(computeEvidenceHash(bundle)).toBe(computeEvidenceHash(reordered));
    expect(
      computeEvidenceHash({
        ...bundle,
        audit: { ...bundle.audit, chainValid: false }
      })
    ).not.toBe(computeEvidenceHash(bundle));
    expect(
      computeEvidenceHash({ ...bundle, readingEvidenceHash: "c".repeat(64) })
    ).not.toBe(computeEvidenceHash(bundle));
  });
});
