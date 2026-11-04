import {
  CronCapability,
  HTTPClient,
  Runner,
  consensusIdenticalAggregation,
  handler,
  json,
  ok,
  type CronPayload,
  type HTTPSendRequester,
  type Runtime
} from "@chainlink/cre-sdk";
import {
  evaluateEvidence,
  type EvidenceBundle,
  type PolicyFinding
} from "./policy.js";

interface Config {
  schedule: string;
  apiBaseUrl: string;
  reportToken: string;
}

interface SubmittedReport {
  statusCode: number;
  reportId: string;
  outcome: string;
}

const authHeaders = (config: Config): Record<string, { values: string[] }> => {
  const headers: Record<string, { values: string[] }> = {
    Accept: { values: ["application/json"] }
  };
  if (config.reportToken) {
    headers["x-cre-token"] = { values: [config.reportToken] };
  }
  return headers;
};

const fetchEvidence = (
  sendRequester: HTTPSendRequester,
  config: Config
): EvidenceBundle => {
  const response = sendRequester
    .sendRequest({
      url: `${config.apiBaseUrl.replace(/\/$/, "")}/api/cre/evidence`,
      method: "GET",
      multiHeaders: authHeaders(config),
      timeout: "10s"
    })
    .result();

  if (!ok(response)) {
    throw new Error(`Evidence request failed with HTTP ${response.statusCode}`);
  }

  const bundle = json(response) as EvidenceBundle;
  if (
    !bundle ||
    typeof bundle.evidenceHash !== "string" ||
    !bundle.audit ||
    !Array.isArray(bundle.sessions)
  ) {
    throw new Error("Evidence response is missing required fields");
  }

  return bundle;
};

const submitReport = (
  sendRequester: HTTPSendRequester,
  report: {
    reportId: string;
    generatedAt: string;
    source: "cre-workflow";
    status: "verified" | "flagged" | "review";
    findings: PolicyFinding[];
    sessionIds: string[];
    evidenceHash: string;
  },
  config: Config
): SubmittedReport => {
  const body = Buffer.from(JSON.stringify(report)).toString("base64");
  const headers = authHeaders(config);
  headers["Content-Type"] = { values: ["application/json"] };

  const response = sendRequester
    .sendRequest({
      url: `${config.apiBaseUrl.replace(/\/$/, "")}/api/cre/report`,
      method: "POST",
      multiHeaders: headers,
      body,
      timeout: "10s",
      cacheSettings: {
        store: true,
        maxAge: "60s"
      }
    })
    .result();

  if (!ok(response)) {
    throw new Error(`Report submission failed with HTTP ${response.statusCode}`);
  }

  return {
    statusCode: response.statusCode,
    reportId: report.reportId,
    outcome: report.status
  };
};

const onCronTrigger = (
  runtime: Runtime<Config>,
  payload: CronPayload
): string => {
  const executionTime = payload.scheduledExecutionTime;
  if (!executionTime) {
    throw new Error("Cron payload is missing scheduledExecutionTime");
  }

  const generatedAt = new Date(
    Number(executionTime.seconds) * 1000 + Number(executionTime.nanos) / 1_000_000
  ).toISOString();

  const httpClient = new HTTPClient();
  const bundle = httpClient
    .sendRequest(
      runtime,
      fetchEvidence,
      consensusIdenticalAggregation<EvidenceBundle>()
    )(runtime.config)
    .result();

  const result = evaluateEvidence(bundle);
  const reportId = `cre_${bundle.evidenceHash.slice(0, 32)}`;

  runtime.log(
    `ChargeMesh evidence ${bundle.evidenceHash.slice(0, 12)} evaluated as ${result.status} with ${result.findings.length} finding(s)`
  );

  const submitted = httpClient
    .sendRequest(
      runtime,
      submitReport,
      consensusIdenticalAggregation<SubmittedReport>()
    )(
      {
        reportId,
        generatedAt,
        source: "cre-workflow",
        status: result.status,
        findings: result.findings,
        sessionIds: bundle.sessions.map((session) => session.sessionId),
        evidenceHash: bundle.evidenceHash
      },
      runtime.config
    )
    .result();

  runtime.log(
    `ChargeMesh report ${submitted.reportId} accepted with HTTP ${submitted.statusCode}`
  );

  return `${submitted.outcome}:${submitted.reportId}`;
};

const initWorkflow = (config: Config) => {
  const cronTrigger = new CronCapability().trigger({
    schedule: config.schedule
  });

  return [handler(cronTrigger, onCronTrigger)];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
