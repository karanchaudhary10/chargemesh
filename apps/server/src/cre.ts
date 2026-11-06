import {
  evaluateAttestation,
  stableStringify,
  type CreReport,
  type CreReportInput,
  type CreReadingEvidence,
  type CreReadingEvidenceBundle,
  type EvidenceBundle,
  type EvidenceReading,
  type Reading,
  type ReadingFlag,
  type SessionEvidence
} from "@chargemesh/shared";
import {
  computeEvidenceHash,
  reportIdFor,
  sha256Hex,
  verifyAuditChain
} from "@chargemesh/shared/node";
import type { Repositories } from "./repositories.js";
import { appendAuditEvent } from "./audit-core.js";
import type { AuditService } from "./audit.js";
import { AppError } from "./errors.js";
import type { Config } from "./config.js";

export class CreService {
  constructor(
    private readonly repositories: Repositories,
    private readonly audit: AuditService,
    private readonly config: Config
  ) {}

  async evidence(): Promise<EvidenceBundle> {
    const [allBills, allReadings, allAuditEvents] = await Promise.all([
      this.repositories.bills.list(),
      this.repositories.readings.list(),
      this.repositories.auditEvents.list()
    ]);
    const readingEvidence = await this.buildReadingEvidence(allReadings, allAuditEvents);
    const verification = verifyAuditChain(allAuditEvents);
    const evidenceAuditEvents = allAuditEvents.filter(
      (event) => event.type !== "cre.report.verified" && event.type !== "cre.report.flagged"
    );
    const sessions = allBills
      .filter((session) => session.status === "closed" || session.status === "disputed")
      .sort((a, b) => {
        const byTime = Date.parse(b.createdAt) - Date.parse(a.createdAt);
        return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
      })
      .slice(0, 100);

    const evidenceSessions: SessionEvidence[] = sessions.map((session) => {
      const endBoundary = session.endTime ?? new Date().toISOString();
      const readings = allReadings
        .filter(
          (reading) =>
            reading.meterId === session.meterId &&
            Date.parse(reading.payload.timestamp) >= Date.parse(session.startTime) &&
            Date.parse(reading.payload.timestamp) <= Date.parse(endBoundary)
        )
        .sort((a, b) => Date.parse(a.payload.timestamp) - Date.parse(b.payload.timestamp));
      const evidenceReadings: EvidenceReading[] = readings.map((reading) => {
        const p = reading.payload as any;
        const cumulativeEnergyKwh = p.cumulativeEnergyKwh ?? p.cumulativeKwh ?? 0;
        return {
          id: reading.id,
          sequence: reading.payload.sequence,
          timestamp: reading.payload.timestamp,
          cumulativeEnergyKwh,
          powerW: reading.payload.powerW,
          status: reading.status,
          flags: reading.flags
        };
      });
      const flags = [...new Set(readings.flatMap((reading) => reading.flags))] as ReadingFlag[];
      const readingIds = new Set(readings.map((reading) => reading.id));
      const auditEventIds = allAuditEvents
        .filter(
          (event) =>
            event.payload.sessionId === session.id ||
            (typeof event.payload.readingId === "string" &&
              readingIds.has(event.payload.readingId))
        )
        .map((event) => event.id);
      const endEnergyKwh = session.endEnergyKwh ?? session.startEnergyKwh;

      return {
        sessionId: session.id,
        roomId: session.roomId,
        meterId: session.meterId,
        status: session.status,
        tariffNprPerKwh: session.tariffNprPerKwh,
        startEnergyKwh: session.startEnergyKwh,
        endEnergyKwh,
        energyKwh: session.energyKwh ?? Math.max(0, endEnergyKwh - session.startEnergyKwh),
        amountNpr: session.amountNpr ?? 0,
        readingCount: readings.length,
        acceptedCount: readings.filter((reading) => reading.status === "accepted").length,
        rejectedCount: readings.filter((reading) => reading.status === "rejected").length,
        quarantinedCount: readings.filter((reading) => reading.status === "quarantined").length,
        flags,
        readings: evidenceReadings,
        auditEventIds,
        auditChainValid: verification.valid
      };
    });

    const core = {
      audit: {
        eventCount: evidenceAuditEvents.length,
        headHash: evidenceAuditEvents.at(-1)?.hash ?? "0".repeat(64),
        chainValid: verification.valid
      },
      readingEvidenceHash: readingEvidence.evidenceHash,
      sessions: evidenceSessions
    };

    return {
      generatedAt: new Date().toISOString(),
      evidenceHash: computeEvidenceHash(core),
      ...core
    };
  }

  async readingEvidence(): Promise<CreReadingEvidenceBundle> {
    const [readings, auditEvents] = await Promise.all([
      this.repositories.readings.list(),
      this.repositories.auditEvents.list()
    ]);
    return this.buildReadingEvidence(readings, auditEvents);
  }

  async pendingReadings(): Promise<CreReadingEvidenceBundle> {
    const [readings, auditEvents, reports] = await Promise.all([
      this.repositories.readings.list(),
      this.repositories.auditEvents.list(),
      this.repositories.creReports.list()
    ]);
    const mostRecentReportBySession = new Map<string, number>();
    for (const report of reports) {
      for (const sessionId of report.sessionIds) {
        const receivedAt = Date.parse(report.receivedAt);
        const previous = mostRecentReportBySession.get(sessionId) ?? Number.NEGATIVE_INFINITY;
        if (receivedAt > previous) {
          mostRecentReportBySession.set(sessionId, receivedAt);
        }
      }
    }

    const pending = readings.filter((reading) => {
      if (!reading.sessionId) return true;
      const lastReportAt = mostRecentReportBySession.get(reading.sessionId);
      return lastReportAt === undefined || Date.parse(reading.receivedAt) > lastReportAt;
    });
    return this.buildReadingEvidence(pending, auditEvents);
  }

  private async buildReadingEvidence(
    readings: Reading[],
    auditEvents: Awaited<ReturnType<Repositories["auditEvents"]["list"]>>
  ): Promise<CreReadingEvidenceBundle> {
    const evidenceReadings = await Promise.all(
      readings.map(async (reading): Promise<CreReadingEvidence> => {
        const meter = await this.repositories.meters.findById(reading.meterId);
        if (!meter?.publicKeyPem) {
          throw new AppError(
            500,
            "reading_meter_key_missing",
            `Cannot create complete CRE evidence for meter ${reading.meterId}`
          );
        }
        return {
          id: reading.id,
          payloadHash: reading.payloadHash,
          meterId: reading.meterId,
          roomId: reading.roomId,
          sessionId: reading.sessionId,
          signedPayload: reading.signedPayload,
          signature: reading.signature,
          publicKeyPem: meter.publicKeyPem,
          status: reading.status,
          flags: reading.flags,
          reasons: reading.reasons,
          maxPowerW: meter.maxPowerW ?? this.config.maxPowerW,
          energyJumpTolerance: this.config.energyJumpTolerance,
          receivedAt: reading.receivedAt,
          auditEvents: auditEvents.filter(
            (event) => event.payload.readingId === reading.id
          )
        };
      })
    );
    evidenceReadings.sort((a, b) => {
      const byTime = Date.parse(a.signedPayload.timestamp) - Date.parse(b.signedPayload.timestamp);
      return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
    });
    const hashInput = evidenceReadings.map(({ auditEvents: events, ...reading }) => ({
      ...reading,
      auditEvents: events.map(({ id, hash, prevHash }) => ({ id, hash, prevHash }))
    }));
    return {
      generatedAt: new Date().toISOString(),
      evidenceHash: sha256Hex(stableStringify({ readings: hashInput })),
      readings: evidenceReadings
    };
  }

  async list(): Promise<CreReport[]> {
    const [reports, events] = await Promise.all([
      this.repositories.creReports.list(),
      this.repositories.auditEvents.list()
    ]);
    const eventByReportId = new Map(
      events
        .filter((event) => typeof event.payload.reportId === "string")
        .map((event) => [event.payload.reportId as string, event])
    );
    return reports
      .map((report) => {
        const event = eventByReportId.get(report.reportId);
        return {
          ...report,
          auditEventId: event?.id ?? report.auditEventId,
          hedera: event?.hedera
        };
      })
      .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
  }

  async submitReport(input: CreReportInput): Promise<CreReport> {
    const existing = await this.repositories.creReports.findById(input.reportId);
    if (existing && existing.evidenceHash === input.evidenceHash && input.evm) {
      return this.persist({ ...existing, evm: input.evm });
    }

    const current = await this.evidence();
    if (input.evidenceHash !== current.evidenceHash) {
      throw new AppError(
        409,
        "evidence_hash_mismatch",
        "The evidence changed after the workflow fetched it; fetch evidence again"
      );
    }
    const currentIds = new Set(current.sessions.map((session) => session.sessionId));
    if (input.sessionIds.some((sessionId) => !currentIds.has(sessionId))) {
      throw new AppError(
        400,
        "unknown_session_in_report",
        "Report references a session that is not present in the current evidence bundle"
      );
    }
    return this.persist({ ...input, receivedAt: new Date().toISOString() });
  }

  async runLocalFallback(actor: string): Promise<CreReport> {
    const bundle = await this.evidence();
    const result = evaluateAttestation(bundle);
    const report: CreReportInput = {
      reportId: reportIdFor(bundle.evidenceHash),
      generatedAt: new Date().toISOString(),
      source: "local-fallback",
      status: result.status,
      findings: result.findings,
      sessionIds: bundle.sessions.map((session) => session.sessionId),
      evidenceHash: bundle.evidenceHash
    };
    return this.persist({ ...report, receivedAt: new Date().toISOString() }, actor);
  }

  private async persist(report: CreReport, actor = "cre-workflow"): Promise<CreReport> {
    const result = await this.repositories.transaction(async (tx) => {
      const existing = await tx.creReports.findById(report.reportId);
      if (existing) {
        if (existing.evidenceHash !== report.evidenceHash) {
          throw new AppError(
            409,
            "report_id_conflict",
            "Report ID is already used for different evidence"
          );
        }
        const updated = {
          ...existing,
          ...report,
          receivedAt: existing.receivedAt,
          auditEventId: existing.auditEventId,
          evm:
            report.evm?.status === "pending" && existing.evm
              ? existing.evm
              : report.evm ?? existing.evm
        };
        await tx.creReports.save(updated);
        return { report: updated, event: undefined };
      }
      const event = await appendAuditEvent(tx.auditEvents, {
        type: report.status === "verified" ? "cre.report.verified" : "cre.report.flagged",
        actor,
        payload: {
          reportId: report.reportId,
          source: report.source,
          status: report.status,
          evidenceHash: report.evidenceHash,
          sessionIds: report.sessionIds,
          findingCount: report.findings.length
        }
      });
      const persisted = { ...report, auditEventId: event.id };
      await tx.creReports.save(persisted);
      return { report: persisted, event };
    });
    if (result.event) {
      void this.audit.notarize(result.event);
    }
    return result.report;
  }
}
