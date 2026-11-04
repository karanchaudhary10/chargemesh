import {
  evaluateAttestation,
  type CreReport,
  type CreReportInput,
  type EvidenceBundle,
  type EvidenceReading,
  type ReadingFlag,
  type SessionEvidence
} from "@chargemesh/shared";
import { computeEvidenceHash, reportIdFor, verifyAuditChain } from "@chargemesh/shared/node";
import type { Repositories } from "./repositories.js";
import { appendAuditEvent } from "./audit-core.js";
import type { AuditService } from "./audit.js";
import { AppError } from "./errors.js";

export class CreService {
  constructor(
    private readonly repositories: Repositories,
    private readonly audit: AuditService
  ) {}

  async evidence(): Promise<EvidenceBundle> {
    const [allBills, allReadings, allAuditEvents] = await Promise.all([
      this.repositories.bills.list(),
      this.repositories.readings.list(),
      this.repositories.auditEvents.list()
    ]);
    const verification = verifyAuditChain(allAuditEvents);
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
        eventCount: verification.count,
        headHash: verification.headHash,
        chainValid: verification.valid
      },
      sessions: evidenceSessions
    };

    return {
      generatedAt: new Date().toISOString(),
      evidenceHash: computeEvidenceHash(core),
      ...core
    };
  }

  async list(): Promise<CreReport[]> {
    const reports = await this.repositories.creReports.list();
    return reports.sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
  }

  async submitReport(input: CreReportInput): Promise<CreReport> {
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
        return { report: existing, event: undefined };
      }
      await tx.creReports.save(report);
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
      return { report, event };
    });
    if (result.event) {
      void this.audit.notarize(result.event);
    }
    return result.report;
  }
}
