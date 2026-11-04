import { createHash } from "node:crypto";

export const AUDIT_SCHEMA_VERSION = "1.0.0";

export type AuditEventType = "reading.accepted" | "bill.generated";

export interface AuditReadingAcceptedPayload {
  eventType: "reading.accepted";
  schemaVersion: string;
  meterId: string;
  roomId?: string;
  readingId: string;
  sequence: number;
  timestamp: string;
  cumulativeKwh?: number;
  payloadHash?: string;
}

export interface AuditBillGeneratedPayload {
  eventType: "bill.generated";
  schemaVersion: string;
  billId: string;
  roomId: string;
  startingReadingId: string;
  endingReadingId: string;
  tariffId: string;
  consumptionKwh: number;
  electricityChargeNpr: number;
  payloadHash?: string;
}

export type AuditPayload = AuditReadingAcceptedPayload | AuditBillGeneratedPayload;

const CANONICAL_KEYS_READING = [
  "eventType",
  "schemaVersion",
  "meterId",
  "roomId",
  "readingId",
  "sequence",
  "timestamp",
  "cumulativeKwh",
  "payloadHash"
] as const;

const CANONICAL_KEYS_BILL = [
  "eventType",
  "schemaVersion",
  "billId",
  "roomId",
  "startingReadingId",
  "endingReadingId",
  "tariffId",
  "consumptionKwh",
  "electricityChargeNpr",
  "payloadHash"
] as const;

function canonicalize(obj: Record<string, unknown>, keys: readonly string[]): string {
  const parts: string[] = [];
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) {
      const v = obj[k];
      if (v === undefined || v === null) {
        parts.push(`${k}:null`);
      } else if (typeof v === "number" || typeof v === "boolean") {
        parts.push(`${k}:${String(v)}`);
      } else if (typeof v === "string") {
        parts.push(`${k}:"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
      } else {
        parts.push(`${k}:${JSON.stringify(v)}`);
      }
    }
  }
  return `{${parts.join(",")}}`;
}

export function computeAuditHash(payload: AuditPayload): string {
  if (payload.eventType === "reading.accepted") {
    const base = {
      eventType: payload.eventType,
      schemaVersion: payload.schemaVersion,
      meterId: payload.meterId,
      roomId: payload.roomId,
      readingId: payload.readingId,
      sequence: payload.sequence,
      timestamp: payload.timestamp,
      cumulativeKwh: payload.cumulativeKwh
    };
    const canon = canonicalize(base as Record<string, unknown>, CANONICAL_KEYS_READING.filter((k) => k !== "payloadHash"));
    return createHash("sha256").update(canon).digest("hex");
  }
  const base = {
    eventType: payload.eventType,
    schemaVersion: payload.schemaVersion,
    billId: payload.billId,
    roomId: payload.roomId,
    startingReadingId: payload.startingReadingId,
    endingReadingId: payload.endingReadingId,
    tariffId: payload.tariffId,
    consumptionKwh: payload.consumptionKwh,
    electricityChargeNpr: payload.electricityChargeNpr
  };
  const canon = canonicalize(base as Record<string, unknown>, CANONICAL_KEYS_BILL.filter((k) => k !== "payloadHash"));
  return createHash("sha256").update(canon).digest("hex");
}

export function attachAuditHash<T extends AuditPayload>(payload: T): T & { payloadHash: string } {
  const hash = computeAuditHash(payload);
  return { ...payload, payloadHash: hash };
}
