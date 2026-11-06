import type { EvidenceBundle, RawSignedReadingPayload } from "./types.js";

function normalize(value: unknown, seen: Set<unknown>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Canonical JSON cannot encode non-finite numbers");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "bigint") {
    throw new Error("Canonical JSON cannot encode bigint");
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new Error("Canonical JSON cannot encode cyclic arrays");
    }
    seen.add(value);
    const result = value.map((item) => normalize(item, seen));
    seen.delete(value);
    return result;
  }
  if (typeof value === "object") {
    if (seen.has(value)) {
      throw new Error("Canonical JSON cannot encode cyclic objects");
    }
    seen.add(value);
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const item = record[key];
      if (item !== undefined) {
        result[key] = normalize(item, seen);
      }
    }
    seen.delete(value);
    return result;
  }
  throw new Error(`Canonical JSON cannot encode ${typeof value}`);
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value, new Set()));
}

export function canonicalReadingJson(payload: RawSignedReadingPayload): string {
  return stableStringify(payload);
}

export function evidenceHashInput(
  bundle: Pick<EvidenceBundle, "sessions" | "audit" | "readingEvidenceHash">
): string {
  return stableStringify({
    sessions: bundle.sessions,
    audit: bundle.audit,
    readingEvidenceHash: bundle.readingEvidenceHash
  });
}
