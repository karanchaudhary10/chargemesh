import type { CreReport } from "../api.js";

const statusClass: Record<CreReport["status"], string> = {
  verified: "bg-emerald-50 text-emerald-700 border-emerald-200",
  review: "bg-amber-50 text-amber-700 border-amber-200",
  flagged: "bg-rose-50 text-rose-700 border-rose-200"
};

function hcsUrl(report: CreReport): string | undefined {
  if (!report.hedera) return undefined;
  const base = report.hedera.mirrorNodeUrl.replace(/\/$/, "");
  return `${base}/topics/${encodeURIComponent(report.hedera.topicId)}/messages/${encodeURIComponent(report.hedera.sequenceNumber)}`;
}

export function CreVerificationPanel({ reports }: { reports: CreReport[] }) {
  const visible = reports.slice(0, 3);

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-5 space-y-4">
      <div>
        <h2 className="text-sm font-bold text-slate-900">CRE reading verification</h2>
        <p className="mt-1 text-xs text-slate-500">
          Chainlink CRE evaluates signed meter evidence and billing consistency.
        </p>
      </div>

      {visible.length === 0 ? (
        <p className="text-xs text-slate-500">No CRE verification reports are available yet.</p>
      ) : (
        <div className="space-y-4">
          {visible.map((report) => {
            const transactionUrl = report.evm?.explorerUrl;
            const auditUrl = hcsUrl(report);
            return (
              <article
                key={report.reportId}
                className="border-t border-slate-100 pt-4 first:border-0 first:pt-0"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase ${statusClass[report.status]}`}>
                    {report.status}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {new Date(report.generatedAt).toLocaleString()}
                  </span>
                </div>
                <p className="mt-2 break-all font-mono text-[11px] text-slate-500">
                  Evidence {report.evidenceHash}
                </p>
                {report.findings.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-xs text-slate-700">
                    {report.findings.slice(0, 4).map((finding, index) => (
                      <li key={`${finding.code}-${finding.sessionId ?? "global"}-${index}`}>
                        <span className="font-semibold">{finding.code}:</span> {finding.message}
                      </li>
                    ))}
                    {report.findings.length > 4 && (
                      <li className="text-slate-500">
                        And {report.findings.length - 4} more finding(s).
                      </li>
                    )}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">No verification findings.</p>
                )}
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {transactionUrl ? (
                    <a
                      className="font-semibold text-blue-700 hover:text-blue-900"
                      href={transactionUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View Sepolia transaction
                    </a>
                  ) : report.evm?.status === "failed" ? (
                    <span className="text-rose-700">
                      On-chain write failed: {report.evm.error ?? "Retry scheduled"}
                    </span>
                  ) : (
                    <span className="text-slate-500">On-chain write not confirmed</span>
                  )}
                  {auditUrl && (
                    <a
                      className="font-semibold text-blue-700 hover:text-blue-900"
                      href={auditUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View HCS audit message
                    </a>
                  )}
                  {report.auditEventId && (
                    <span className="font-mono text-slate-500">Audit {report.auditEventId}</span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
