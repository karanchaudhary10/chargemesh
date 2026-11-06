import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify
} from "node:crypto";
import { canonicalReadingJson, evidenceHashInput, stableStringify } from "./canonical.js";
import type { AuditEvent, EvidenceBundle, RawSignedReadingPayload, SignedReadingPayload } from "./types.js";

export const GENESIS_HASH = "0".repeat(64);

export interface MeterKeyPair {
  publicKeyPem: string;
  privateKeyPem: string;
}

export function generateMeterKeyPair(): MeterKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString()
  };
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hashReadingPayload(payload: RawSignedReadingPayload): string {
  return sha256Hex(canonicalReadingJson(payload));
}

export function readingIdFor(payload: RawSignedReadingPayload): string {
  return `rdg_${hashReadingPayload(payload).slice(0, 24)}`;
}

export function uniqueReadingIdFor(payload: RawSignedReadingPayload, suffix: string): string {
  return `${readingIdFor(payload)}_${suffix}`;
}

export function signReading(payload: SignedReadingPayload, privateKeyPem: string): string {
  const key = createPrivateKey(privateKeyPem);
  const signature = sign(null, Buffer.from(canonicalReadingJson(payload), "utf8"), key);
  return signature.toString("base64");
}

export function verifyReadingSignature(
  payload: RawSignedReadingPayload,
  signatureBase64: string,
  publicKeyPem: string
): boolean {
  try {
    const key = createPublicKey(publicKeyPem);
    return verify(
      null,
      Buffer.from(canonicalReadingJson(payload), "utf8"),
      key,
      Buffer.from(signatureBase64, "base64")
    );
  } catch {
    return false;
  }
}

export function verifyReadingWithKey(
  payload: RawSignedReadingPayload,
  signatureBase64: string,
  publicKeyPem: string
): { valid: boolean } {
  return { valid: verifyReadingSignature(payload, signatureBase64, publicKeyPem) };
}

export function auditEventHash(
  event: Pick<AuditEvent, "seq" | "type" | "at" | "actor" | "payload" | "prevHash">
): string {
  return sha256Hex(
    stableStringify({
      seq: event.seq,
      type: event.type,
      at: event.at,
      actor: event.actor,
      payload: event.payload,
      prevHash: event.prevHash
    })
  );
}

export interface AuditVerification {
  valid: boolean;
  count: number;
  headHash: string;
  brokenAt?: string;
  reason?: string;
}

export function verifyAuditChain(events: AuditEvent[]): AuditVerification {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  let previousHash = GENESIS_HASH;

  for (let index = 0; index < ordered.length; index += 1) {
    const event = ordered[index];
    if (!event) {
      continue;
    }
    if (event.seq !== index + 1) {
      return {
        valid: false,
        count: ordered.length,
        headHash: previousHash,
        brokenAt: event.id,
        reason: `Expected sequence ${index + 1}, found ${event.seq}`
      };
    }
    if (event.prevHash !== previousHash) {
      return {
        valid: false,
        count: ordered.length,
        headHash: previousHash,
        brokenAt: event.id,
        reason: "Previous hash does not match the prior audit event"
      };
    }
    const expected = auditEventHash(event);
    if (event.hash !== expected) {
      return {
        valid: false,
        count: ordered.length,
        headHash: previousHash,
        brokenAt: event.id,
        reason: "Audit event hash does not match its content"
      };
    }
    previousHash = event.hash;
  }

  return {
    valid: true,
    count: ordered.length,
    headHash: previousHash
  };
}

export function computeEvidenceHash(
  bundle: Pick<EvidenceBundle, "sessions" | "audit" | "readingEvidenceHash">
): string {
  return sha256Hex(evidenceHashInput(bundle));
}

export function reportIdFor(evidenceHash: string): string {
  return `cre_${evidenceHash.slice(0, 24)}`;
}
