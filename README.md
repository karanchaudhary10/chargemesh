# ChargeMesh

ChargeMesh is a rental-room electricity metering and fair-billing prototype. It verifies Ed25519-signed submeter readings, quarantines implausible data, bills only accepted energy in NPR, keeps an append-only audit hash chain, and produces evidence for Chainlink CRE attestation.

This is a prototype that ingests signed readings from physical ESP32 + PZEM-004T submeters. It does not claim production-grade key custody or active blockchain integrations unless those integrations are explicitly configured and verified.

## What is implemented

- Starts with no demo accounts or sample property data. Landlords and renters register their own accounts.
- Landlord and renter sessions, role checks, property ownership checks, and active-room tenancy access are enforced by the API.
- Landlords can create properties and rooms, assign registered renter accounts by email, and end tenancies.
- A renter sees only assigned rooms, their readings, issued bills, and related disputes/evidence.
- Room-specific tariffs support effective dates. A later tariff closes the previous open-ended tariff; billing across rate changes is rejected.
- Bills are created as drafts for landlord review and become visible to the assigned renter only after the landlord issues them.
- Clear repository interfaces for properties, tenancies, rooms, meters, readings, tariffs, bills (sessions), disputes, audit events, CRE reports, and runtime state.
- PostgreSQL repository implementation with one database split into `identity`, `property`, `metering`, `billing`, `audit`, and `system` schemas.
- Signed reading ingestion with canonical JSON and Ed25519 verification.
- Rejection/quarantine rules for invalid signatures, replays, duplicates, stale/future data, meter resets, room mismatches, implausible power, and implausible energy jumps.
- Billing in Nepali rupees from accepted cumulative energy only, with boundary reading references, tariff snapshot, and defined rounding.
- Bill disputes, landlord responses/outcomes, plus legacy session start/close and optional HTS test-token settlement.
- A physical-meter registration path for Ed25519-signed reading submissions from ESP32 + PZEM-004T hardware.
- Local append-only audit chain with integrity verification.
- Optional Hedera HCS notarization and Mirror Node lookup.
- Optional ENS name resolution with an explicit RPC URL.
- CRE evidence bundles, report verification, and a clearly labeled local policy fallback.
- Isolated Chainlink CRE workflow source under `cre/chargemesh-validation`.
- React landlord and renter workspaces for rooms and renters, meter readings, bills, disputes, tariffs, and property settings.

## Storage and scope

All application data is stored in PostgreSQL. The server connects with `DATABASE_URL` and
creates its tables on startup. Data survives API restarts; deleting rows or dropping the
database is then an explicit operation rather than a side effect of restarting the process.

One database holds six schemas, split by concern:

| Schema | Tables |
| --- | --- |
| `identity` | `users`, `sessions` |
| `property` | `properties`, `rooms`, `tenancies` |
| `metering` | `meters`, `meter_keys`, `readings` |
| `billing` | `tariffs`, `bills`, `disputes` |
| `audit` | `events`, `cre_reports` |
| `system` | `integration_state` |

The server defines entity repositories in `apps/server/src/repositories.ts` and implements
them with `PostgresRepositories` in `apps/server/src/postgres-repositories.ts`. Business
services use those interfaces rather than reading or writing tables directly. Every entity
keeps its full object in a `data jsonb` column, with indexed columns for the fields used in
lookups. Multi-step writes run in a serialized PostgreSQL transaction so audit-chain
sequencing and read-then-write checks cannot interleave.

Meter key material generated through the API is persisted in `metering.meter_keys` and loaded
into the signing key cache at startup. Meter readings themselves are signed on the ESP32 with
its Ed25519 private key; this server-side store is still a prototype key store, not production
key custody.

Tests use a separate `TEST_DATABASE_URL` whose database name must end in `_test`; each test
truncates that database before running.

## Quick start

Requirements: Node.js 22+ and PostgreSQL 14+. Bun is only needed for the CRE workflow.

Create the database and role once (adjust the credentials to match your `DATABASE_URL`):

```bash
sudo -u postgres psql \
  -c "CREATE USER chargemesh WITH PASSWORD 'chargemesh';" \
  -c "CREATE DATABASE chargemesh OWNER chargemesh;" \
  -c "CREATE DATABASE chargemesh_test OWNER chargemesh;"
```

Then install and start:

```bash
npm install
cp .env.example .env
npm run dev
```

- Web UI: http://localhost:5173
- API: http://localhost:4000
- Health: http://localhost:4000/api/health

`npm run dev` starts the API and Vite together. Vite proxies `/api` to port 4000.

To receive live readings, flash the ESP32 firmware in `esp32-pzem004t-chargemesh/` with the
meter's room ID and Wi-Fi credentials, then register its public key for the room. The firmware
posts a signed reading every 10 seconds.

## Useful commands

```bash
npm run dev
npm run typecheck
npm test
npm run build
npm start
```

The production server serves only the API. Serve `apps/web/dist` with a static host or put a reverse proxy in front of the API.

## First-run flow

Nothing is preloaded. Use two browser accounts (or separate browser profiles) for a renter/landlord demo.

1. Register a landlord account and sign in.
2. Create a property, then add one or more rooms under it.
3. Register a physical meter's Ed25519 public key for a room from **Meters**.
4. Create a room tariff with its agreed NPR/kWh rate and effective time.
5. Register a renter account, then assign that renter to the room using the account email on **Properties & rooms**.
6. Power the ESP32 + PZEM-004T meter so it submits signed readings. Billing requires accepted readings at or before both selected period boundaries; create an initial baseline before the bill period.
7. Generate a draft bill, review its reading references, usage, tariff, and amount, then issue it. Only issued bills appear in the renter account.
8. Sign in as the renter to inspect readings and the bill evidence. The renter can submit a dispute; the landlord can record a written response and outcome on **Disputes**.
9. HCS evidence is available only when configured. A local signature verification and audit hash support integrity checks but do not prove physical meter accuracy.

The tariff, rooms, meters, readings, bills, disputes, and audit events persist in PostgreSQL
across API restarts.

## Optional integrations

Copy `.env.example` to `.env` and fill only the integrations you want. Never commit real keys.

### Hedera HCS audit

Set:

```dotenv
HEDERA_ENABLED=true
HEDERA_NETWORK=testnet
HEDERA_OPERATOR_ID=0.0.x
HEDERA_OPERATOR_KEY=...
HEDERA_TOPIC_ID=0.0.x
```

When enabled and configured, ChargeMesh submits a compact reference containing the application event ID, sequence, type, timestamp, and hash-chain hashes for accepted readings, generated bills, and other audit events. Personal and bill details are not written to HCS. Each local audit event records whether anchoring is pending, submitted, disabled, or failed. A submitted event stores its topic, sequence, transaction, and Mirror Node link; verification compares the referenced Mirror Node message with the local event hash. Mirror Node verification may briefly remain pending while a new message becomes available.

The API process needs network access to Hedera and a funded operator account authorized for the configured topic. Use testnet first. HCS uses an existing topic ID; `scripts/create-hcs-topic.ts` can create one when run with enabled Hedera credentials. Without HCS configuration, billing and the local hash chain continue to work, and the audit status is shown as disabled.

To create a testnet topic, set `HEDERA_ENABLED=true`, `HEDERA_OPERATOR_ID`, and `HEDERA_OPERATOR_KEY` in the root `.env`, then run `npm run hedera:create-topic` and copy the printed topic ID into `HEDERA_TOPIC_ID`. Restart `npm run dev` after changing the HCS environment settings.

### HTS test-token settlement

Set `HTS_TOKEN_ID`, `HTS_TOKEN_DECIMALS`, and optionally `HTS_TREASURY_ACCOUNT_ID`. The payer must be associated with the token and hold enough units. Token units are calculated as `amountNpr * 10^decimals`, so the configured test token is treated as a 1:1 NPR test unit. This is testnet settlement only, not a fiat payment system.

### ENS identity

Set `ENS_RPC_URL` to an Ethereum RPC endpoint. Without it, ENS resolution reports `configured: false`; there is no silent public-RPC fallback.

### CRE report authentication

Set `CRE_REPORT_TOKEN` to enable `/api/cre/evidence` and `/api/cre/report` with `x-cre-token`. Without it those CRE endpoints return an explicit unavailable response. The workflow reads the token from its config; keep the deployed value in a secret manager, not in committed JSON. The local fallback endpoint requires an authenticated landlord/admin session.

## Chainlink CRE workflow

The workflow lives outside the npm workspaces because CRE has its own Bun-based toolchain:

```bash
cd cre/chargemesh-validation
bun install
cre login
cre workflow simulate ./ --target staging-settings
```

Prerequisites are Bun `>=1.2.21` and the Chainlink CRE CLI. This repository does not include either binary, and the workflow has not been executed in this environment.

The staging config points at `http://localhost:4000`. The cron trigger fetches `/api/cre/evidence` every 30 seconds, applies the same evidence policy, and posts a report to `/api/cre/report`. Reports are idempotent by deterministic report ID. The UI label `local-fallback` means the server's own policy evaluator ran; it is not a DON execution.

See `cre/chargemesh-validation/README.md` for details.

## API overview

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Liveness |
| GET | `/api/status` | Storage, integrations, policy config |
| GET | `/api/dashboard` | Dashboard aggregate |
| POST | `/api/auth/register` | Create landlord or renter account |
| POST | `/api/auth/login` | Start secure HTTP-only session |
| POST | `/api/auth/logout` | End session |
| GET | `/api/auth/me` | Current account |
| PATCH | `/api/auth/me` | Update the signed-in account name |
| GET/POST | `/api/properties` | List owned properties/create property |
| PATCH | `/api/properties/:propertyId` | Update property settings, billing cycle, and default rate |
| GET/POST | `/api/rooms` | List accessible rooms/create a room under an owned property |
| GET/POST | `/api/rooms/:roomId/tenancies` | List/assign renters by email |
| POST | `/api/tenancies/:tenancyId/end` | End a renter assignment |
| POST | `/api/rooms/:roomId/meters` | Register a meter |
| GET | `/api/meters` | List accessible meters and source type |
| GET | `/api/readings` | List/filter readings |
| POST | `/api/readings` | Submit a signed reading |
| GET/POST | `/api/tariffs` | List/create room tariffs with effective dates |
| POST | `/api/bills/preview` | Calculate a draft bill without saving it |
| GET | `/api/rooms/:roomId/bill-suggestion` | Suggest the next billing period for a room |
| POST | `/api/bills` | Generate a reviewable draft bill |
| POST | `/api/bills/:billId/issue` | Issue a reviewed bill to its renter |
| POST | `/api/bills/:billId/mark-paid` | Mark an issued bill as paid |
| DELETE | `/api/bills/:billId` | Delete a draft bill |
| GET | `/api/bills` | List only accessible bills (renters see non-draft bills) |
| POST | `/api/disputes` | Submit a dispute for an issued bill |
| GET | `/api/sessions` | List sessions |
| GET | `/api/sessions/:sessionId` | Session detail and evidence links |
| POST | `/api/sessions/:sessionId/close` | Close and bill a session |
| POST | `/api/sessions/:sessionId/dispute` | Open a dispute |
| POST | `/api/sessions/:sessionId/settle` | Settle with HTS |
| GET | `/api/disputes` | List disputes |
| POST | `/api/disputes/:disputeId/resolve` | Resolve a dispute |
| GET | `/api/audit` | Audit events |
| GET | `/api/audit/verify` | Verify local hash chain |
| GET | `/api/audit/status` | HCS/Mirror status |
| GET | `/api/audit/hedera/:sequence` | Mirror Node message lookup |
| POST | `/api/audit/:eventId/notarize` | Submit an event to HCS |
| GET | `/api/cre/evidence` | Evidence bundle |
| POST | `/api/cre/report` | Submit a verified CRE report |
| POST | `/api/cre/simulate` | Run local policy fallback |
| GET | `/api/cre/reports` | List reports |
| GET | `/api/identity/resolve` | ENS forward resolution |
| GET | `/api/identity/reverse` | ENS reverse resolution |

## Implementation roadmap

### Implemented core workflows

Session-based landlord/renter authentication, API-side role and room scoping, property/room
management, renter assignment, physical meter registration, effective-dated tariffs, draft/review/issue
billing, bill disputes, signed readings, and local audit evidence.

### Still deferred or incomplete

- Production schema migrations, backups, and deployment operations.
- Production session-store and password-reset/invitation lifecycle; renters must register before assignment.
- Physical ESP32/energy-meter firmware is provided in `esp32-pzem004t-chargemesh/`; installation and electrical safety review remain the operator's responsibility.
- Payment collection. HTS settlement is an optional test-token integration, not NPR fiat payment.
- Live Hedera/CRE integration verification, durable HCS submission reconciliation, and deployment operations.
- Bill correction/reissue mechanics after a dispute is upheld; current disputes preserve the outcome/response but do not automatically alter an issued bill.

## Security and production gaps

- PostgreSQL is the source of truth, but the server still assumes a single API process for the in-process transaction queue. The advisory lock keeps transactions serialized across processes.
- The current signup flow lets anyone create a landlord account. Property ownership checks prevent access to other landlords' data, but production onboarding/invitation controls are still required.
- Meter private keys generated through the API are stored in plaintext in `metering.meter_keys` and cached in memory. This is a development convenience, not production key management.
- CORS is open by default.
- HCS/HTS/ENS behavior is implemented against current SDKs but has not been verified with live credentials in this environment.
- The CRE workflow is source-complete but unexecuted without Bun and the CRE CLI.
- `npm audit` reports transitive `ws` advisories through `@hiero-ledger/sdk` → `ethers` → `ws@8.17.1`. npm's suggested fix downgrades the Hedera SDK; that was not applied. The affected WebSocket path is not used by this API, but the dependency should be reviewed before production.
