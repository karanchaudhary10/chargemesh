# ChargeMesh CRE validation workflow

This workflow periodically fetches the current ChargeMesh evidence bundle, evaluates billing invariants, and posts a report back to the API.

It is a real CRE workflow source using `@chainlink/cre-sdk`, not part of the npm workspace. It has not been simulated or deployed in this environment because Bun and the CRE CLI are not installed.

## Flow

1. Cron trigger fires every 30 seconds in staging.
2. `GET /api/cre/evidence` returns closed/disputed sessions, accepted/rejected/quarantined readings, audit references, and an evidence hash.
3. Nodes reach consensus on the bundle with `consensusIdenticalAggregation`.
4. `policy.ts` checks audit-chain validity, rejected/quarantined readings, signature/sequence anomalies, energy and amount arithmetic, reading span, and audit evidence.
5. The deterministic report ID is derived from the evidence hash.
6. `POST /api/cre/report` validates that the evidence hash is still current and persists the report idempotently.

Reports posted by this workflow use `source: "cre-workflow"`. The server's `/api/cre/simulate` fallback uses `source: "local-fallback"`.

## Prerequisites

- Bun `>=1.2.21`
- Chainlink CRE CLI
- A running ChargeMesh API on `http://localhost:4000`
- CRE CLI login (`cre login`)

## Install and simulate

```bash
bun install
cre login
cre whoami
cre workflow simulate ./ --target staging-settings
```

The CLI may prompt for a cron trigger selection during simulation.

## Configuration

`config.staging.json`:

```json
{
  "schedule": "*/30 * * * * *",
  "apiBaseUrl": "http://localhost:4000",
  "reportToken": ""
}
```

`config.production.json` contains a placeholder API URL. Replace it before deployment. Set `reportToken` through the CRE secrets mechanism or an untracked deployment-specific config; do not commit a real token.

If `CRE_REPORT_TOKEN` is set on the API, both evidence fetch and report submission must send `x-cre-token`.

## Verification boundary

- The workflow verifies evidence integrity and billing arithmetic, but it does not independently re-verify every meter signature or query Hedera consensus directly.
- The report is authenticated by the shared CRE token. It is not submitted as an onchain signed report, and this project does not verify Chainlink report signatures.
- `audit.chainValid` reflects the local server hash chain. Optional HCS references are included for operator lookup, not as a trustless source.
