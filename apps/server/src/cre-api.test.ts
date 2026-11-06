import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { CreReportInput } from "@chargemesh/shared";
import type { AppDependencies } from "./app.js";
import { createApp } from "./app.js";
import type { Config } from "./config.js";
import type { CreService } from "./cre.js";

const CRE_TOKEN = "test-cre-token-with-at-least-thirty-two-characters";
const config = {
  port: 0,
  staleAfterMs: 60_000,
  maxPowerW: 5_000,
  energyJumpTolerance: 10,
  creReportToken: CRE_TOKEN,
  hederaNetwork: "testnet",
  hederaMirrorNodeUrl: "https://testnet.mirrornode.hedera.com/api/v1",
  hederaEnabled: false
} as Config;

const evidence = {
  generatedAt: "2026-10-23T10:00:00.000Z",
  evidenceHash: "a".repeat(64),
  readingEvidenceHash: "b".repeat(64),
  audit: { eventCount: 1, headHash: "c".repeat(64), chainValid: true },
  sessions: []
};

const reading = {
  id: "reading_api_test",
  payloadHash: "d".repeat(64),
  meterId: "meter_api_test",
  roomId: "room_api_test",
  signedPayload: {
    meterId: "meter_api_test",
    roomId: "room_api_test",
    sequence: 1,
    timestamp: "2026-10-23T09:00:00.000Z",
    cumulativeEnergyKwh: 1.25,
    powerW: 500,
    voltage: 230,
    current: 2.17,
    nonce: "reading-api-test"
  },
  signature: "test-signature",
  publicKeyPem: "test-public-key",
  status: "accepted",
  flags: [],
  reasons: [],
  receivedAt: "2026-10-23T09:00:01.000Z",
  auditEvents: [
    {
      id: "event_api_test",
      hash: "e".repeat(64),
      prevHash: "0".repeat(64),
      payload: { readingId: "reading_api_test" }
    }
  ]
};

const readingBundle = {
  generatedAt: "2026-10-23T10:00:00.000Z",
  evidenceHash: evidence.readingEvidenceHash,
  readings: [reading]
};

describe("CRE API", () => {
  const servers: Array<ReturnType<ReturnType<typeof createApp>["listen"]>> = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          })
      )
    );
  });

  async function startServer(overrides: Partial<Config> = {}) {
    const apiConfig = { ...config, ...overrides };
    const reports = new Map<string, Record<string, unknown>>();
    const cre = {
      evidence: async () => evidence,
      pendingReadings: async () => readingBundle,
      readingEvidence: async () => readingBundle,
      submitReport: async (input: CreReportInput) => {
        const previous = reports.get(input.reportId);
        const report = {
          ...previous,
          ...input,
          receivedAt: previous?.receivedAt ?? new Date().toISOString()
        };
        reports.set(input.reportId, report);
        return report;
      }
    };
    const app = createApp({
      config: apiConfig,
      repositories: {},
      cre
    } as unknown as AppDependencies);
    const server = app.listen(0);
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }

  it("requires the configured CRE token for evidence APIs", async () => {
    const baseUrl = await startServer();

    const missing = await fetch(`${baseUrl}/api/cre/evidence`);
    const invalid = await fetch(`${baseUrl}/api/cre/pending-readings`, {
      headers: { "x-cre-token": "wrong-token" }
    });

    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
  });

  it("returns independently consumable evidence and signed reading responses", async () => {
    const baseUrl = await startServer();
    const headers = { "x-cre-token": CRE_TOKEN };

    const [evidenceResponse, pendingResponse, completeResponse] = await Promise.all([
      fetch(`${baseUrl}/api/cre/evidence`, { headers }),
      fetch(`${baseUrl}/api/cre/pending-readings`, { headers }),
      fetch(`${baseUrl}/api/cre/reading-evidence`, { headers })
    ]);

    expect(evidenceResponse.status).toBe(200);
    expect(pendingResponse.status).toBe(200);
    expect(completeResponse.status).toBe(200);

    const receivedEvidence = await evidenceResponse.json() as typeof evidence;
    const pending = await pendingResponse.json() as typeof readingBundle;
    const complete = await completeResponse.json() as typeof readingBundle;

    expect(receivedEvidence.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(receivedEvidence.readingEvidenceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(receivedEvidence.sessions).toEqual([]);
    expect(pending.evidenceHash).toBe(receivedEvidence.readingEvidenceHash);
    expect(complete.evidenceHash).toBe(pending.evidenceHash);
    expect(complete.readings).toHaveLength(1);
    expect(complete.readings[0]).toMatchObject({
      meterId: reading.meterId,
      roomId: reading.roomId,
      signature: reading.signature,
      publicKeyPem: reading.publicKeyPem,
      status: "accepted",
      flags: [],
      reasons: [],
      signedPayload: reading.signedPayload
    });
    expect(complete.readings[0]!.auditEvents).toHaveLength(1);
  });

  it("accepts EVM failure metadata and an idempotent retry receipt", async () => {
    const baseUrl = await startServer();
    const headers = { "x-cre-token": CRE_TOKEN, "content-type": "application/json" };
    const reportInput = {
      reportId: "cre_api_report",
      generatedAt: "2026-10-23T10:00:00.000Z",
      source: "cre-workflow",
      status: "flagged",
      findings: [{ code: "test_finding", severity: "error", message: "Test finding" }],
      sessionIds: [],
      evidenceHash: evidence.evidenceHash,
      evm: {
        status: "failed",
        chainSelectorName: "ethereum-sepolia",
        contractAddress: `0x${"1".repeat(40)}`,
        error: "Temporary RPC failure",
        updatedAt: "2026-10-23T10:00:00.000Z"
      }
    };
    const failed = await fetch(`${baseUrl}/api/cre/report`, {
      method: "POST",
      headers,
      body: JSON.stringify(reportInput)
    });
    expect(failed.status).toBe(201);
    await expect(failed.json()).resolves.toMatchObject({
      report: { status: "flagged", evm: { status: "failed" } }
    });

    const transactionHash = `0x${"2".repeat(64)}`;
    const retried = await fetch(`${baseUrl}/api/cre/report`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...reportInput,
        evm: {
          status: "submitted",
          chainSelectorName: "ethereum-sepolia",
          contractAddress: `0x${"1".repeat(40)}`,
          transactionHash,
          explorerUrl: `https://sepolia.etherscan.io/tx/${transactionHash}`,
          updatedAt: "2026-10-23T10:01:00.000Z"
        }
      })
    });
    expect(retried.status).toBe(201);
    await expect(retried.json()).resolves.toMatchObject({
      report: { evm: { status: "submitted", transactionHash } }
    });
  });

  it("returns 503 instead of exposing CRE evidence when no token is configured", async () => {
    const baseUrl = await startServer({ creReportToken: undefined });
    const response = await fetch(`${baseUrl}/api/cre/reading-evidence`);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "cre_token_not_configured" }
    });
  });
});
