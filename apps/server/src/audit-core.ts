import { randomUUID } from "node:crypto";
import { GENESIS_HASH, auditEventHash } from "@chargemesh/shared/node";
import type { AuditEvent } from "@chargemesh/shared";
import type { AuditEventRepository } from "./repositories.js";

export interface AuditInput {
  type: string;
  actor: string;
  payload: Record<string, unknown>;
  at?: string;
}

export async function appendAuditEvent(
  auditEvents: AuditEventRepository,
  input: AuditInput
): Promise<AuditEvent> {
  const previous = await auditEvents.head();
  const seq = previous ? previous.seq + 1 : 1;
  const prevHash = previous?.hash ?? GENESIS_HASH;
  const at = input.at ?? new Date().toISOString();
  const base = {
    seq,
    type: input.type,
    at,
    actor: input.actor,
    payload: input.payload,
    prevHash
  };
  const event: AuditEvent = {
    id: `aud_${randomUUID()}`,
    ...base,
    hash: auditEventHash(base)
  };
  await auditEvents.save(event);
  return event;
}
