# ChargeMesh CRE verification workflow

The workflow fetches session billing evidence and pending signed readings,
evaluates verification policy, writes a deterministic report through the CRE
Forwarder to `ReadingVerifier`, verifies the stored result, and posts the
structured report to the ChargeMesh API.

## API contract

- `GET /api/cre/evidence` returns closed/disputed sessions, billing arithmetic,
  audit-chain validity, and a hash that also commits to complete reading evidence.
- `GET /api/cre/pending-readings` returns signed readings received after the
  latest CRE report for their session, including the meter public key, payload,
  signature, validation flags/reasons, and audit events. Unassigned readings
  remain pending until associated with a report.
- `GET /api/cre/reading-evidence` returns the complete signed-reading evidence
  set for audit/debug use.
- `POST /api/cre/report` accepts a structured result and its on-chain status.
  Reposting the same report ID and evidence hash updates the EVM receipt
  idempotently; audit entries created for reports do not change the evidence
  hash.

All four routes require `x-cre-token`. Configure the server's
`CRE_REPORT_TOKEN` with at least 32 characters and register the same value as
the CRE secret ID `CRE_REPORT_TOKEN` referenced by `workflow.yaml`. Generate a
value locally, for example with `openssl rand -hex 32`. The workflow reads this
secret with CRE's runtime secret API; the value is not stored in tracked config.
The local secrets file at `cre/secrets.yaml` is git-ignored.

## Local setup and simulation

Prerequisites:

- Bun `>=1.2.21`
- Chainlink CRE CLI
- A running ChargeMesh API
- CRE CLI login (`cre login`, then `cre whoami`)
- A deployed `ReadingVerifier` and the official Ethereum Sepolia Forwarder

Install and simulate:

```bash
bun install
cre workflow simulate ./ --target staging-settings
```

Set `evm.contractAddress` in `config.staging.json` to the deployed receiver.
The testnet selector is `ethereum-sepolia`. Keep tokens and deployment
credentials out of tracked JSON files.

## Policy and retry behavior

The workflow checks evidence hashes, audit-chain validity, billing totals,
reading status, signature-evidence presence, known validation flags, duplicate sequences,
timestamp ordering, power limits, and implied-power jumps. The API verifies Ed25519 signatures before
persisting readings; CRE evaluates the server-provided signed evidence and does
not independently implement Ed25519 cryptography.

Each cron execution retries reports whose previous EVM write failed. The
receiver treats an identical report as a successful no-op and rejects report
ID reuse with different contents. After a successful write, the workflow
reads the stored verification back before it marks the EVM result as submitted.
The API report exposes its transaction and HCS audit references to landlord and
renter views.

The CRE workflow cannot be deployed from this checkout until a deployed
Sepolia receiver address and CRE secrets are configured. See
[`contracts/README.md`](../../contracts/README.md) for deployment preparation.
