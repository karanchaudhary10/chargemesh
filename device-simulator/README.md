# ChargeMesh simulated ESP32 meter

**SIMULATED DATA ONLY.** This package does not connect to a physical ESP32, mains
power, the ChargeMesh API, a database, or any blockchain. It generates and signs
fake meter readings so other software can be developed and tested.

This is an isolated development tool. Do not use its key handling as a model for
production device security.

## Requirements

- Node.js 20 or newer
- No third-party dependencies and no install step

## Quick start

Run from `device-simulator/`:

```bash
node src/cli.js key:init
node src/cli.js readings --reset --initial-kwh 1250 --increment-kwh 0.25 --count 3
```

The first reading starts at `--initial-kwh` (`0` by default). Each later reading
adds `--increment-kwh` (`0.25` by default). The meter state is persisted so the
next command continues the sequence.

Example output (the signature is shortened here; real signatures are 64-byte
Ed25519 values encoded as base64):

```json
{
  "schema": "chargemesh.simulated-device-readings.v1",
  "simulator": "chargemesh-software-esp32",
  "simulated": true,
  "notice": "SIMULATED DATA ONLY: software-generated readings, not physical ESP32 or mains measurements.",
  "deviceType": "simulated-esp32",
  "meterId": "METER-001",
  "keyFingerprint": "ea2f94d9f35b2cbbffaaa971d79340782a6398ab09c27d96d1c765902f2d377e",
  "signature": {
    "algorithm": "Ed25519",
    "encoding": "base64",
    "signedPayload": "canonical JSON of each reading with the signature field omitted"
  },
  "canonicalization": "UTF-8 JSON with object keys sorted lexicographically at every level, no whitespace, arrays preserved in order, undefined properties omitted, and the top-level signature field excluded.",
  "generatedAt": "2026-10-23T16:46:17.113Z",
  "readings": [
    {
      "meterId": "METER-001",
      "cumulativeKwh": 1250,
      "timestamp": "2026-10-23T16:46:17.098Z",
      "sequence": 1,
      "deviceType": "simulated-esp32",
      "simulated": true,
      "signature": "<base64 Ed25519 signature>"
    },
    {
      "meterId": "METER-001",
      "cumulativeKwh": 1250.25,
      "timestamp": "2026-10-23T16:46:17.105Z",
      "sequence": 2,
      "deviceType": "simulated-esp32",
      "simulated": true,
      "signature": "<base64 Ed25519 signature>"
    }
  ]
}
```

Use `node src/cli.js` directly, not `npm run`, when redirecting or piping JSON.
npm can print its own script banner to stdout. The npm scripts are provided for
convenient interactive use.

## Commands

```bash
# Generate a new local Ed25519 key pair. Refuses to overwrite existing keys.
node src/cli.js key:init
node src/cli.js key:init --force

# Export the public key as JSON or raw PEM.
node src/cli.js key:show
node src/cli.js key:show --pem

# Generate one reading.
node src/cli.js reading

# Generate several readings.
node src/cli.js readings --count 5

# Continue a sequence with configured consumption.
node src/cli.js readings --increment-kwh 0.1 --count 10

# Start a new sequence and a new cumulative total for this meter.
node src/cli.js readings --reset --initial-kwh 5000 --increment-kwh 0.2

# Use a different meter ID or isolated state file.
node src/cli.js readings --meter-id METER-002 --state /tmp/meter-002.json

# Verify a file, or JSON piped through stdin.
node src/cli.js verify --input readings.json
node src/cli.js reading | node src/cli.js verify --input -

# Verify with an explicitly supplied public key.
node src/cli.js verify --input readings.json --public-key keys/meter-public.pem

# Demonstrate that changing a signed reading is detected.
node src/cli.js tamper
```

The `verify` command accepts any of these input shapes:

- one reading object
- an array of readings
- the full readings envelope printed by `reading` or `readings`

It exits with code `1` if any reading is invalid. Each reading is checked with
the local public key by default, or with `--public-key <pem-file>`.

`tamper` generates a valid reading, changes `cumulativeKwh` without re-signing
it, verifies both versions, and prints the result. It does not update the meter
state file. It exits with code `0` when tampering is detected and `1` otherwise.

Example tamper result:

```json
{
  "demonstration": "tamper-detection",
  "stateUpdated": false,
  "original": { "cumulativeKwh": 1250.75, "signature": "<valid signature>" },
  "tampered": { "cumulativeKwh": 1251.75, "signature": "<same signature>" },
  "originalVerification": { "valid": true, "reason": null },
  "tamperedVerification": {
    "valid": false,
    "reason": "signature does not match the canonical reading payload"
  },
  "tamperDetected": true
}
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `--meter-id` | `METER-001` | Meter identifier embedded in every reading |
| `--state` | `state/meter-state.json` | Persisted sequence and cumulative kWh |
| `--initial-kwh` | `0` | Cumulative kWh of the first reading in a new or reset state |
| `--increment-kwh` | `0.25` | kWh added for each reading after the first |
| `--count` | `5` for `readings` | Number of readings to generate |
| `--reset` | off | Start a new sequence at `--initial-kwh` |
| `--delta-kwh` | `1` | Amount added by `tamper` without re-signing |
| `--keys-dir` | `keys/` | Directory containing the public and private PEM files |
| `--force` | off | Replace existing keys during `key:init` |
| `--public-key` | `keys/meter-public.pem` | Public key used by `verify` |
| `--input` | stdin | Reading file used by `verify`; `-` means stdin |

The default meter state path is `state/meter-state.json` relative to this package.
A relative `--state`, `--keys-dir`, `--public-key`, or `--input` path is resolved
from the current working directory.

`--initial-kwh` applies only to a new or reset state. If a state already contains
readings, the command rejects that option rather than silently ignoring it.

## Signed reading format

A reading contains these fields:

| Field | Meaning |
| --- | --- |
| `meterId` | Meter identifier |
| `cumulativeKwh` | Rounded to six decimal places |
| `timestamp` | Canonical UTC ISO 8601 string, for example `2026-10-23T12:00:00.000Z` |
| `sequence` | Positive integer that increases with every reading |
| `deviceType` | Always `simulated-esp32` |
| `simulated` | Always `true` |
| `signature` | Base64-encoded Ed25519 signature |

Signing procedure:

1. Copy the reading and remove the top-level `signature` field.
2. Canonicalize it as compact UTF-8 JSON with object keys sorted lexicographically
   at every level. Arrays keep their order. Undefined object properties are
   omitted and non-finite numbers are rejected.
3. Sign the exact UTF-8 bytes with the Ed25519 private key.
4. Encode the 64-byte signature as base64 and add it as `signature`.

Example canonical payload before signing:

```json
{"cumulativeKwh":1250.25,"deviceType":"simulated-esp32","meterId":"METER-001","sequence":2,"simulated":true,"timestamp":"2026-10-23T16:46:17.105Z"}
```

The public key is exported in SPKI PEM format. The envelope's `keyFingerprint` is
the SHA-256 hex digest of the DER-encoded SPKI public key, which makes key
selection and rotation easier for consumers.

Verification is strict about the canonical timestamp format and requires
`deviceType` to be `simulated-esp32` and `simulated` to be `true`.

## Keys and state

Default generated files:

```text
keys/meter-private.pem    PKCS#8 private key, mode 0600, never printed
keys/meter-public.pem     SPKI public key, mode 0644
state/meter-state.json    sequence and cumulative kWh, mode 0600
```

Both default directories are ignored by the repository:

```text
device-simulator/keys/
device-simulator/state/
```

`key:init` refuses to replace existing files unless `--force` is supplied.
`--force` rotates the key pair but leaves the meter state in place, so a later
sequence continues under the new key. To start a completely new identity, remove
the `keys/` and `state/` directories; readings signed by the old key will no
longer verify with the new public key.

The private key is never printed by any command or test. Treat generated keys as
local development material and do not commit them.

## Tests

```bash
npm test
```

The suite uses the built-in Node test runner and covers:

- deterministic canonical payloads and signature exclusion
- valid Ed25519 signature verification
- rejection of modified cumulative kWh
- rejection of a forged signature
- the tamper demonstration
- increasing sequences and cumulative readings
- private key file permissions and non-disclosure
- state persistence
- an end-to-end CLI flow including verification failure after tampering

## Scope and limitations

- Software simulation only; no ESP32 firmware or physical hardware interface.
- No backend, API, database, dashboard, CRE, Hedera, ENS, or HTS integration.
- No trusted clock, hardware key storage, secure element, or anti-replay service.
  Timestamps and local state are development fixtures, not production security.
- The output envelope is specific to this standalone tool. Wiring it into the
  existing ChargeMesh server would require an explicit adapter and integration
  tests, which are outside this task.
