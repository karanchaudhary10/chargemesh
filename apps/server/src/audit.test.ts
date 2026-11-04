import { describe, expect, it, vi } from "vitest";
import { appendAuditEvent } from "./audit-core.js";
import { AuditService } from "./audit.js";
import type { HederaService } from "./hedera.js";
import { createTestRepositories } from "./test-db.js";

function createEvent() {
  return {
    type: "bill.generated",
    actor: "landlord_1",
    at: "2026-10-25T12:00:00.000Z",
    payload: { billId: "bill_1", roomId: "room_1", electricityChargeNpr: 150 }
  };
}

describe("Hedera audit anchoring", () => {
  it("stores a transaction reference and verifies its Mirror Node message", async () => {
    const repositories = await createTestRepositories();
    const reference = {
      network: "testnet",
      topicId: "0.0.123",
      sequenceNumber: "7",
      transactionId: "0.0.1@123.000",
      mirrorNodeUrl: "https://mirror.example/topics/0.0.123/messages/7"
    };
    const hedera = {
      hcsConfigured: true,
      submitAuditEvent: vi.fn(async () => reference),
      fetchMirrorMessage: vi.fn(async () => {
        const event = (await repositories.auditEvents.list())[0]!;
        return {
          topic_id: reference.topicId,
          sequence_number: Number(reference.sequenceNumber),
          consensus_timestamp: "2026-10-25T12:00:01.000Z",
          message: Buffer.from(JSON.stringify({
            v: 1,
            app: "chargemesh",
            id: event.id,
            seq: event.seq,
            type: event.type,
            at: event.at,
            hash: event.hash,
            prevHash: event.prevHash
          })).toString("base64")
        };
      }),
      status: () => ({
        hedera: {
          mode: "configured",
          network: "testnet",
          topicId: reference.topicId,
          mirrorNodeUrl: "https://mirror.example"
        }
      })
    } as unknown as HederaService;
    const audit = new AuditService(repositories, hedera);
    const event = await repositories.transaction((tx) =>
      appendAuditEvent(tx.auditEvents, createEvent())
    );

    const submitted = await audit.notarize(event);

    expect(submitted.hederaStatus).toBe("submitted");
    expect(submitted.hedera).toEqual(reference);
    expect(await audit.verifyHedera(event.id)).toMatchObject({
      status: "verified",
      anchored: true,
      verified: true,
      topicId: reference.topicId,
      sequenceNumber: reference.sequenceNumber
    });
  });

  it("resubmits events left pending or unattempted by a restart, in chain order", async () => {
    const repositories = await createTestRepositories();
    const append = (type: string) =>
      repositories.transaction((tx) => appendAuditEvent(tx.auditEvents, { ...createEvent(), type }));
    const pending = await append("bill.generated");
    await repositories.auditEvents.save({ ...pending, hederaStatus: "pending" });
    const unattempted = await append("bill.issued");
    const failed = await append("dispute.opened");
    await repositories.auditEvents.save({ ...failed, hederaStatus: "failed" });

    const submittedIds: string[] = [];
    const hedera = {
      hcsConfigured: true,
      submitAuditEvent: vi.fn(async (event: { id: string; seq: number }) => {
        submittedIds.push(event.id);
        return {
          network: "testnet",
          topicId: "0.0.123",
          sequenceNumber: String(event.seq),
          transactionId: `0.0.1@${event.seq}.000`,
          mirrorNodeUrl: `https://mirror.example/topics/0.0.123/messages/${event.seq}`
        };
      })
    } as unknown as HederaService;
    const audit = new AuditService(repositories, hedera);

    await expect(audit.resumePendingSubmissions()).resolves.toBe(2);
    expect(submittedIds).toEqual([pending.id, unattempted.id]);
    expect((await repositories.auditEvents.findById(pending.id))?.hederaStatus).toBe("submitted");
    expect((await repositories.auditEvents.findById(unattempted.id))?.hederaStatus).toBe("submitted");
    expect((await repositories.auditEvents.findById(failed.id))?.hederaStatus).toBe("failed");

    await expect(audit.resumePendingSubmissions()).resolves.toBe(0);
  });

  it("records disabled and failed states without blocking local audit events", async () => {
    const repositories = await createTestRepositories();
    const disabledAudit = new AuditService(repositories, {
      hcsConfigured: false
    } as HederaService);
    const disabledEvent = await repositories.transaction((tx) =>
      appendAuditEvent(tx.auditEvents, createEvent())
    );
    await expect(disabledAudit.notarize(disabledEvent)).resolves.toMatchObject({
      hederaStatus: "disabled"
    });

    const failedAudit = new AuditService(repositories, {
      hcsConfigured: true,
      submitAuditEvent: async () => {
        throw new Error("provider unavailable");
      }
    } as unknown as HederaService);
    const anotherEvent = await repositories.transaction((tx) =>
      appendAuditEvent(tx.auditEvents, { ...createEvent(), type: "reading.accepted" })
    );
    await expect(failedAudit.notarize(anotherEvent)).resolves.toMatchObject({
      hederaStatus: "failed",
      hederaError: "Hedera submission failed. Check server configuration and logs."
    });
  });
});
