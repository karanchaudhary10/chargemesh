import {
  bytesToHex,
  CronCapability,
  EVMClient,
  encodeCallMsg,
  getNetwork,
  HTTPClient,
  handler,
  json,
  LATEST_BLOCK_NUMBER,
  ok,
  prepareReportRequest,
  Runner,
  type HTTPSendRequester,
  type Runtime,
  TxStatus,
  type CronPayload,
  consensusIdenticalAggregation
} from "@chainlink/cre-sdk";
import {
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  stringToHex,
  toHex,
  zeroAddress,
  type Address
} from "viem";
import {
  evaluateVerification,
  type EvidenceBundle,
  type PolicyFinding,
  type ReadingEvidence
} from "./policy.js";

interface Config {
  schedule: string;
  apiBaseUrl: string;
  reportToken?: string;
  evm: {
    chainSelectorName: string;
    contractAddress: string;
  };
}

interface WorkflowEvidence {
  bundle: EvidenceBundle;
  readings: ReadingEvidence[];
}

interface EvmResult {
  status: "pending" | "submitted" | "failed";
  chainSelectorName: string;
  contractAddress: string;
  transactionHash?: string;
  explorerUrl?: string;
  error?: string;
  updatedAt: string;
}

interface SubmittedReport {
  statusCode: number;
  reportId: string;
  outcome: string;
}

const READER_ABI = [
  {
    type: "function",
    name: "onReport",
    stateMutability: "nonpayable",
    inputs: [
      { name: "metadata", type: "bytes" },
      { name: "report", type: "bytes" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "getVerification",
    stateMutability: "view",
    inputs: [{ name: "reportId", type: "bytes32" }],
    outputs: [
      { name: "exists", type: "bool" },
      { name: "evidenceHash", type: "bytes32" },
      { name: "status", type: "uint8" },
      { name: "findingCount", type: "uint32" },
      { name: "recordedAt", type: "uint64" }
    ]
  }
] as const;

const authHeaders = (config: Config): Record<string, { values: string[] }> => {
  const headers: Record<string, { values: string[] }> = {
    Accept: { values: ["application/json"] }
  };
  if (!config.reportToken || config.reportToken.length < 32) {
    throw new Error("CRE secret CRE_REPORT_TOKEN must contain at least 32 characters");
  }
  headers["x-cre-token"] = { values: [config.reportToken] };
  return headers;
};

const fetchWorkflowEvidence = (
  sendRequester: HTTPSendRequester,
  config: Config
): WorkflowEvidence => {
  const baseUrl = config.apiBaseUrl.replace(/\/$/, "");
  const read = (path: string): unknown => {
    const response = sendRequester
      .sendRequest({
        url: `${baseUrl}${path}`,
        method: "GET",
        multiHeaders: authHeaders(config),
        timeout: "10s"
      })
      .result();
    if (!ok(response)) {
      throw new Error(`${path} request failed with HTTP ${response.statusCode}`);
    }
    return json(response);
  };

  const bundle = read("/api/cre/evidence") as EvidenceBundle;
  const pending = read("/api/cre/pending-readings") as {
    evidenceHash: string;
    readings: Array<ReadingEvidence & { payloadHash: string }>;
  };
  const complete = read("/api/cre/reading-evidence") as {
    evidenceHash: string;
    readings: Array<ReadingEvidence & { payloadHash: string }>;
  };
  if (
    !bundle ||
    typeof bundle.evidenceHash !== "string" ||
    typeof bundle.readingEvidenceHash !== "string" ||
    !bundle.audit ||
    !Array.isArray(bundle.sessions)
  ) {
    throw new Error("Evidence response is missing required fields");
  }
  if (!pending || typeof pending.evidenceHash !== "string" || !Array.isArray(pending.readings)) {
    throw new Error("Pending readings response is missing required fields");
  }
  if (
    !complete ||
    typeof complete.evidenceHash !== "string" ||
    !Array.isArray(complete.readings) ||
    complete.evidenceHash !== bundle.readingEvidenceHash
  ) {
    throw new Error("Complete reading evidence does not match the session evidence hash");
  }
  const completeById = new Map(complete.readings.map((reading) => [reading.id, reading.payloadHash]));
  if (
    pending.readings.some((reading) => completeById.get(reading.id) !== reading.payloadHash)
  ) {
    throw new Error("Pending readings changed while the workflow was fetching evidence");
  }

  return {
    bundle: { ...bundle, generatedAt: "1970-01-01T00:00:00.000Z" },
    readings: complete.readings.map((reading) => ({
      id: reading.id,
      meterId: reading.meterId,
      sessionId: reading.sessionId,
      signedPayload: reading.signedPayload,
      signature: reading.signature,
      publicKeyPem: reading.publicKeyPem,
      status: reading.status,
      flags: reading.flags,
      reasons: reading.reasons,
      maxPowerW: reading.maxPowerW,
      energyJumpTolerance: reading.energyJumpTolerance
    }))
  };
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
    evm: EvmResult;
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
      timeout: "10s"
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

const writeAndVerifyReport = (
  runtime: Runtime<Config>,
  reportId: string,
  evidenceHash: string,
  status: "verified" | "flagged" | "review",
  findingCount: number
): EvmResult => {
  const { chainSelectorName, contractAddress } = runtime.config.evm;
  const updatedAt = new Date().toISOString();
  try {
    if (!/^0x[a-fA-F0-9]{40}$/.test(contractAddress)) {
      throw new Error("CRE EVM contractAddress must be a deployed 20-byte address");
    }
    const network = getNetwork({
      chainFamily: "evm",
      chainSelectorName,
      isTestnet: true
    });
    if (!network) {
      throw new Error(`CRE network not found: ${chainSelectorName}`);
    }

    const evmClient = new EVMClient(network.chainSelector.selector);
    const reportIdHash = keccak256(stringToHex(reportId));
    const statusValue = status === "verified" ? 0 : status === "review" ? 1 : 2;
    const reportPayload = encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint8" },
        { type: "uint32" }
      ],
      [`0x${reportIdHash.slice(2)}`, `0x${evidenceHash}`, statusValue, findingCount]
    );
    const callData = encodeFunctionData({
      abi: READER_ABI,
      functionName: "onReport",
      args: [toHex("0x"), reportPayload]
    });
    const report = runtime.report(prepareReportRequest(callData)).result();
    const response = evmClient
      .writeReport(runtime, {
        receiver: contractAddress,
        report
      })
      .result();

    if (response.txStatus !== TxStatus.SUCCESS) {
      throw new Error(`CRE EVM write failed: ${response.errorMessage || response.txStatus}`);
    }
    if (!response.txHash || response.txHash.length !== 32) {
      throw new Error("CRE EVM write returned no transaction hash");
    }
    const transactionHash = bytesToHex(response.txHash);

    const readCall = encodeFunctionData({
      abi: READER_ABI,
      functionName: "getVerification",
      args: [reportIdHash]
    });
    const stored = evmClient
      .callContract(runtime, {
        call: encodeCallMsg({
          from: zeroAddress,
          to: contractAddress as Address,
          data: readCall
        }),
        blockNumber: LATEST_BLOCK_NUMBER
      })
      .result();
    const [exists, storedEvidenceHash, storedStatus, storedFindingCount] =
      decodeFunctionResult({
        abi: READER_ABI,
        functionName: "getVerification",
        data: bytesToHex(stored.data)
      });

    if (
      !exists ||
      storedEvidenceHash.toLowerCase() !== `0x${evidenceHash}`.toLowerCase() ||
      Number(storedStatus) !== statusValue ||
      Number(storedFindingCount) !== findingCount
    ) {
      throw new Error("On-chain verification read-back does not match the submitted report");
    }

    return {
      status: "submitted",
      chainSelectorName,
      contractAddress,
      transactionHash,
      explorerUrl: `https://sepolia.etherscan.io/tx/${transactionHash}`,
      updatedAt
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown CRE EVM write error";
    runtime.log(`ChargeMesh EVM verification failed: ${message}`);
    return {
      status: "failed",
      chainSelectorName,
      contractAddress,
      error: message.slice(0, 1000),
      updatedAt
    };
  }
};

const onCronTrigger = (
  runtime: Runtime<Config>,
  payload: CronPayload
): string => {
  const config = {
    ...runtime.config,
    reportToken: runtime.getSecret({ id: "CRE_REPORT_TOKEN" }).result().value
  };
  const executionTime = payload.scheduledExecutionTime;
  if (!executionTime) {
    throw new Error("Cron payload is missing scheduledExecutionTime");
  }
  const generatedAt = new Date(
    Number(executionTime.seconds) * 1000 + Number(executionTime.nanos) / 1_000_000
  ).toISOString();
  const httpClient = new HTTPClient();
  const evidence = httpClient
    .sendRequest(
      runtime,
      fetchWorkflowEvidence,
      consensusIdenticalAggregation<WorkflowEvidence>()
    )(config)
    .result();
  const result = evaluateVerification(evidence.bundle, evidence.readings);
  const reportId = `cre_${evidence.bundle.evidenceHash.slice(0, 32)}`;
  const report = {
    reportId,
    generatedAt,
    source: "cre-workflow" as const,
    status: result.status,
    findings: result.findings,
    sessionIds: evidence.bundle.sessions.map((session) => session.sessionId),
    evidenceHash: evidence.bundle.evidenceHash
  };
  const pendingEvm: EvmResult = {
    status: "pending",
    chainSelectorName: runtime.config.evm.chainSelectorName,
    contractAddress: runtime.config.evm.contractAddress,
    updatedAt: generatedAt
  };
  const initialSubmission = httpClient
    .sendRequest(
      runtime,
      submitReport,
      consensusIdenticalAggregation<SubmittedReport>()
    )({ ...report, evm: pendingEvm }, config)
    .result();
  runtime.log(
    `ChargeMesh report ${initialSubmission.reportId} registered with HTTP ${initialSubmission.statusCode}`
  );

  const evm = writeAndVerifyReport(
    runtime,
    reportId,
    evidence.bundle.evidenceHash,
    result.status,
    result.findings.length
  );

  runtime.log(
    `ChargeMesh evidence ${evidence.bundle.evidenceHash.slice(0, 12)} evaluated as ${result.status} with ${result.findings.length} finding(s)`
  );
  const submitted = httpClient
    .sendRequest(
      runtime,
      submitReport,
      consensusIdenticalAggregation<SubmittedReport>()
    )(
      {
        ...report,
        evm
      },
      config
    )
    .result();

  runtime.log(
    `ChargeMesh report ${submitted.reportId} accepted with HTTP ${submitted.statusCode}; EVM ${evm.status}`
  );
  return `${evm.status}:${submitted.outcome}:${submitted.reportId}`;
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
