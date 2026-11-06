import { describe, expect, it } from "vitest";
import type { AuditEvent, CreReportInput } from "@chargemesh/shared";
import type { AuditService } from "./audit.js";
import { CreService } from "./cre.js";
import type { Config } from "./config.js";
import type { Repositories } from "./repositories.js";

function serviceWithMemoryRepositories() {
  const auditEvents = new Map<string, AuditEvent>();
  const reports = new Map<string, Awaited<ReturnType<Repositories["creReports"]["findById"]>>>();
  const auditRepository = {
    list: async () => [...auditEvents.values()],
    findById: async (id: string) => auditEvents.get(id) ?? null,
    head: async () =>
      [...auditEvents.values()].sort((a, b) => b.seq - a.seq)[0] ?? null,
    save: async (event: AuditEvent) => void auditEvents.set(event.id, event)
  };
  const reportRepository = {
    list: async () => [...reports.values()].filter((report) => report !== null),
    findById: async (reportId: string) => reports.get(reportId) ?? null,
    save: async (report: NonNullable<Awaited<ReturnType<Repositories["creReports"]["findById"]>>>) =>
      void reports.set(report.reportId, report)
  };
  const repositories = {
    bills: { list: async () => [] },
    readings: { list: async () => [] },
    meters: { findById: async () => null },
    auditEvents: auditRepository,
    creReports: reportRepository,
    transaction: async <T>(run: (tx: Repositories) => Promise<T> | T) => run(repositories)
  } as unknown as Repositories;
  const audit = { notarize: async () => undefined } as unknown as AuditService;
  return new CreService(
    repositories,
    audit,
    { maxPowerW: 5_000, energyJumpTolerance: 10 } as Config
  );
}

describe("CRE report persistence", () => {
  it("keeps report evidence stable across its own audit entry and updates retry receipts", async () => {
    const cre = serviceWithMemoryRepositories();
    const initialEvidence = await cre.evidence();
    const input: CreReportInput = {
      reportId: "cre_stable_evidence",
      generatedAt: "2026-10-23T10:00:00.000Z",
      source: "cre-workflow",
      status: "verified",
      findings: [],
      sessionIds: [],
      evidenceHash: initialEvidence.evidenceHash
    };

    await cre.submitReport(input);
    expect((await cre.evidence()).evidenceHash).toBe(initialEvidence.evidenceHash);

    const transactionHash = `0x${"a".repeat(64)}`;
    const retried = await cre.submitReport({
      ...input,
      evm: {
        status: "submitted",
        chainSelectorName: "ethereum-sepolia",
        contractAddress: `0x${"b".repeat(40)}`,
        transactionHash,
        explorerUrl: `https://sepolia.etherscan.io/tx/${transactionHash}`,
        updatedAt: "2026-10-23T10:01:00.000Z"
      }
    });

    expect(retried.evm?.transactionHash).toBe(transactionHash);
    expect(retried.auditEventId).toBeTruthy();
  });
});
