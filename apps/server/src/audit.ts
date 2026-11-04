import type { AuditEvent } from "@chargemesh/shared";
import { verifyAuditChain } from "@chargemesh/shared/node";
import type { Repositories } from "./repositories.js";
import type { HederaService } from "./hedera.js";
import { appendAuditEvent, type AuditInput } from "./audit-core.js";
import { AppError } from "./errors.js";

export class AuditService {
  private readonly submissions = new Map<string, Promise<AuditEvent>>();

  constructor(
    private readonly repositories: Repositories,
    private readonly hedera: HederaService
  ) {}

  async record(input: AuditInput): Promise<AuditEvent> {
    const event = await this.repositories.transaction((tx) =>
      appendAuditEvent(tx.auditEvents, input)
    );
    void this.notarize(event);
    return event;
  }

  async list(limit = 100): Promise<AuditEvent[]> {
    const events = await this.repositories.auditEvents.list();
    return events
      .sort((a, b) => b.seq - a.seq)
      .slice(0, Math.max(1, Math.min(limit, 1000)));
  }

  async verify() {
    return verifyAuditChain(await this.repositories.auditEvents.list());
  }

  // In-flight submissions are tracked in memory only, so a restart can leave events
  // "pending" (or never attempted) in the database. Resubmit them in chain order.
  async resumePendingSubmissions(): Promise<number> {
    if (!this.hedera.hcsConfigured) {
      return 0;
    }
    const stuck = (await this.repositories.auditEvents.list())
      .filter((event) => !event.hedera && (event.hederaStatus === "pending" || !event.hederaStatus))
      .sort((a, b) => a.seq - b.seq);
    for (const event of stuck) {
      await this.notarize(event);
    }
    return stuck.length;
  }

  async notarize(event: AuditEvent): Promise<AuditEvent> {
    if (event.hedera) {
      return event;
    }
    const inFlight = this.submissions.get(event.id);
    if (inFlight) return inFlight;
    const submission = this.submit(event).finally(() => {
      this.submissions.delete(event.id);
    });
    this.submissions.set(event.id, submission);
    return submission;
  }

  private async submit(event: AuditEvent): Promise<AuditEvent> {
    if (!this.hedera.hcsConfigured) {
      return this.updateEvent(event.id, (stored) => {
        stored.hederaStatus = "disabled";
        delete stored.hederaError;
      });
    }
    await this.updateEvent(event.id, (stored) => {
      stored.hederaStatus = "pending";
      delete stored.hederaError;
    });
    try {
      const reference = await this.hedera.submitAuditEvent(event);
      const submitted = await this.updateEvent(event.id, (stored) => {
        stored.hedera = reference;
        stored.hederaStatus = "submitted";
        delete stored.hederaError;
      });
      await this.repositories.transaction(async (tx) => {
        const integrations = await tx.integrations.get();
        integrations.hedera.topicId = reference.topicId;
        integrations.hedera.lastMessageSequence = reference.sequenceNumber;
        await tx.integrations.save(integrations);
      });
      return submitted;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown HCS error";
      console.warn(`[audit] HCS submission failed for ${event.id}: ${message}`);
      return this.updateEvent(event.id, (stored) => {
        stored.hederaStatus = "failed";
        stored.hederaError = "Hedera submission failed. Check server configuration and logs.";
      });
    }
  }

  private async updateEvent(
    eventId: string,
    update: (event: AuditEvent) => void
  ): Promise<AuditEvent> {
    return this.repositories.transaction(async (tx) => {
      const stored = await tx.auditEvents.findById(eventId);
      if (!stored) {
        throw new AppError(404, "audit_event_not_found", "Audit event no longer exists");
      }
      update(stored);
      await tx.auditEvents.save(stored);
      return stored;
    });
  }

  async notarizeById(eventId: string): Promise<AuditEvent> {
    if (!this.hedera.hcsConfigured) {
      throw new AppError(503, "hedera_not_configured", "Hedera HCS is not configured");
    }
    const event = await this.repositories.auditEvents.findById(eventId);
    if (!event) {
      throw new AppError(404, "audit_event_not_found", "Audit event was not found");
    }
    if (event.hedera) {
      return event;
    }
    return this.notarize(event);
  }

  async verifyHedera(eventId: string) {
    const event = await this.repositories.auditEvents.findById(eventId);
    if (!event) {
      throw new AppError(404, "audit_event_not_found", "Audit event was not found");
    }
    const localChain = await this.verify();
    if (!event.hedera) {
      return {
        status: event.hederaStatus ?? "pending",
        anchored: false,
        verified: false,
        localChainValid: localChain.valid,
        error: event.hederaError
      };
    }

    let mirror: {
      topic_id?: string;
      sequence_number?: number | string;
      consensus_timestamp?: string;
      message?: string;
    };
    try {
      mirror = await this.hedera.fetchMirrorMessage(event.hedera.sequenceNumber) as typeof mirror;
    } catch (error) {
      if (error instanceof AppError && error.status === 404) {
        return {
          status: "pending",
          anchored: true,
          verified: false,
          localChainValid: localChain.valid,
          topicId: event.hedera.topicId,
          sequenceNumber: event.hedera.sequenceNumber
        };
      }
      throw error;
    }
    let decoded: Record<string, unknown> | null = null;
    if (mirror.message) {
      try {
        decoded = JSON.parse(Buffer.from(mirror.message, "base64").toString("utf8")) as Record<string, unknown>;
      } catch {
        decoded = null;
      }
    }
    const anchorMatches = Boolean(
      decoded &&
      mirror.topic_id === event.hedera.topicId &&
      String(mirror.sequence_number) === event.hedera.sequenceNumber &&
      decoded.app === "chargemesh" &&
      decoded.id === event.id &&
      decoded.seq === event.seq &&
      decoded.type === event.type &&
      decoded.at === event.at &&
      decoded.hash === event.hash &&
      decoded.prevHash === event.prevHash
    );
    const verified = anchorMatches && localChain.valid;
    return {
      status: verified ? "verified" : "mismatch",
      anchored: true,
      verified,
      anchorMatches,
      localChainValid: localChain.valid,
      network: event.hedera.network,
      topicId: event.hedera.topicId,
      sequenceNumber: event.hedera.sequenceNumber,
      transactionId: event.hedera.transactionId,
      consensusTimestamp: mirror.consensus_timestamp
    };
  }

  async mirrorMessage(sequence: string): Promise<unknown> {
    return this.hedera.fetchMirrorMessage(sequence);
  }

  async status() {
    const verification = await this.verify();
    const integrations = await this.repositories.integrations.get();
    return {
      mode: this.hedera.hcsConfigured ? "hedera-hcs" : "local-hash-chain",
      configured: this.hedera.hcsConfigured,
      network: this.hedera.status().hedera.network,
      enabled: this.hedera.status().hedera.mode === "configured",
      chain: verification,
      topicId: integrations.hedera.topicId ?? null,
      lastMessageSequence: integrations.hedera.lastMessageSequence ?? null,
      mirrorNode:
        this.hedera.hcsConfigured && integrations.hedera.topicId
          ? `${this.hedera.status().hedera.mirrorNodeUrl}/topics/${integrations.hedera.topicId}/messages`
          : null
    };
  }
}
