#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  DEFAULT_KEY_DIR,
  DEFAULT_PRIVATE_KEY_PATH,
  DEFAULT_PUBLIC_KEY_PATH,
  DEFAULT_STATE_PATH
} from "./paths.js";
import {
  fingerprintPublicKey,
  initializeDevKeyPair,
  loadPrivateKey,
  loadPublicKey
} from "./keys.js";
import {
  DEFAULT_METER_ID,
  generateReadings,
  roundKwh,
  tamperCumulativeKwh,
  verifyReading
} from "./reading.js";
import {
  createMeterState,
  readState,
  writeState
} from "./state.js";
import {
  SIMULATION_NOTICE,
  extractReadings,
  readingsEnvelope
} from "./output.js";

const HELP = `ChargeMesh simulated ESP32 meter

Usage:
  node src/cli.js key:init [--keys-dir <dir>] [--force]
  node src/cli.js key:show [--keys-dir <dir>] [--pem]
  node src/cli.js reading [--meter-id <id>] [--state <file>]
                          [--initial-kwh <kwh>] [--increment-kwh <kwh>]
                          [--reset] [--keys-dir <dir>]
  node src/cli.js readings [--count <n>] [--meter-id <id>] [--state <file>]
                           [--initial-kwh <kwh>] [--increment-kwh <kwh>]
                           [--reset] [--keys-dir <dir>]
  node src/cli.js verify --input <file|-> [--public-key <pem>]
                         [--keys-dir <dir>]
  node src/cli.js tamper [--meter-id <id>] [--state <file>]
                         [--initial-kwh <kwh>] [--increment-kwh <kwh>]
                         [--delta-kwh <kwh>] [--keys-dir <dir>]

All commands print JSON to stdout. Errors print JSON to stderr.
Run "npm run key:init" once before generating readings.`;

function parseOptions(tokens) {
  const options = {};

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const equals = token.indexOf("=");
    if (equals !== -1) {
      const name = token.slice(2, equals);
      options[name] = token.slice(equals + 1);
      continue;
    }

    const name = token.slice(2);
    const next = tokens[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      options[name] = next;
      index += 1;
    } else {
      options[name] = true;
    }
  }

  return options;
}

function assertKnownOptions(options, allowed) {
  for (const name of Object.keys(options)) {
    if (!allowed.includes(name)) {
      throw new Error(`Unknown option --${name}`);
    }
  }
}

function stringOption(options, name, fallback) {
  const value = options[name];
  if (value === undefined) {
    return fallback;
  }
  if (value === true) {
    throw new Error(`--${name} requires a value`);
  }
  return String(value);
}

function numberOption(options, name, fallback) {
  const value = options[name];
  if (value === undefined) {
    return fallback;
  }
  if (value === true) {
    throw new Error(`--${name} requires a value`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`--${name} must be a finite number`);
  }
  return parsed;
}

function booleanOption(options, name) {
  const value = options[name];
  if (value === undefined) {
    return false;
  }
  if (value === true || value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`--${name} does not take a value`);
}

function resolvePath(value) {
  return path.resolve(process.cwd(), value);
}

function resolveKeyPaths(options) {
  const keysDir = options["keys-dir"]
    ? resolvePath(stringOption(options, "keys-dir"))
    : DEFAULT_KEY_DIR;
  if (keysDir === DEFAULT_KEY_DIR) {
    return {
      privateKeyPath: DEFAULT_PRIVATE_KEY_PATH,
      publicKeyPath: DEFAULT_PUBLIC_KEY_PATH
    };
  }
  return {
    privateKeyPath: path.join(keysDir, "meter-private.pem"),
    publicKeyPath: path.join(keysDir, "meter-public.pem")
  };
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function readStdinText() {
  return new Promise((resolve, reject) => {
    let text = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      text += chunk;
    });
    process.stdin.on("end", () => resolve(text));
    process.stdin.on("error", reject);
  });
}

async function loadSimulatorKeys(options) {
  const { privateKeyPath, publicKeyPath } = resolveKeyPaths(options);
  const [privateKeyPem, publicKeyPem] = await Promise.all([
    loadPrivateKey(privateKeyPath),
    loadPublicKey(publicKeyPath)
  ]);
  return {
    privateKeyPem,
    publicKeyPem,
    keyFingerprint: fingerprintPublicKey(publicKeyPem)
  };
}

async function loadStateForCommand({
  statePath,
  meterId,
  initialCumulativeKwh,
  reset,
  options
}) {
  let state = reset ? null : await readState(statePath);

  if (state && state.meterId !== meterId) {
    throw new Error(
      `State belongs to ${state.meterId}, not ${meterId}. Use --reset to start a new state for this meter.`
    );
  }
  if (
    state &&
    state.sequence > 0 &&
    options["initial-kwh"] !== undefined
  ) {
    throw new Error("--initial-kwh only applies to a new or reset meter state");
  }

  if (!state) {
    state = createMeterState({ meterId, initialCumulativeKwh });
  }
  return state;
}

function nextReadingPosition(state, incrementKwh) {
  return {
    startingSequence: state.sequence + 1,
    startingCumulativeKwh:
      state.sequence === 0
        ? state.cumulativeKwh
        : roundKwh(state.cumulativeKwh + incrementKwh)
  };
}

async function commandKeyInit(options) {
  assertKnownOptions(options, ["keys-dir", "force"]);
  const { privateKeyPath, publicKeyPath } = resolveKeyPaths(options);
  const result = await initializeDevKeyPair({
    privateKeyPath,
    publicKeyPath,
    force: booleanOption(options, "force")
  });

  printJson({
    created: result.created,
    privateKeyPath: result.privateKeyPath,
    publicKeyPath: result.publicKeyPath,
    keyFingerprint: result.keyFingerprint,
    publicKeyPem: result.publicKeyPem,
    privateKeyPrinted: false,
    notice: SIMULATION_NOTICE
  });
}

async function commandKeyShow(options) {
  assertKnownOptions(options, ["keys-dir", "pem"]);
  const { publicKeyPath } = resolveKeyPaths(options);
  const publicKeyPem = await loadPublicKey(publicKeyPath);

  if (booleanOption(options, "pem")) {
    process.stdout.write(publicKeyPem);
    return;
  }

  printJson({
    publicKeyPath,
    keyFingerprint: fingerprintPublicKey(publicKeyPem),
    publicKeyPem
  });
}

async function commandReadings(options, { count, commandName }) {
  const allowed = [
    "keys-dir",
    "state",
    "meter-id",
    "initial-kwh",
    "increment-kwh",
    "reset"
  ];
  if (count !== 1) {
    allowed.push("count");
  }
  assertKnownOptions(options, allowed);

  const keys = await loadSimulatorKeys(options);
  const statePath = options.state
    ? resolvePath(stringOption(options, "state"))
    : DEFAULT_STATE_PATH;
  const meterId = stringOption(options, "meter-id", DEFAULT_METER_ID);
  const initialCumulativeKwh = numberOption(options, "initial-kwh", 0);
  const incrementKwh = numberOption(options, "increment-kwh", 0.25);
  const readingCount =
    commandName === "readings" ? numberOption(options, "count", 5) : 1;
  const reset = booleanOption(options, "reset");

  const state = await loadStateForCommand({
    statePath,
    meterId,
    initialCumulativeKwh,
    reset,
    options
  });
  const { startingSequence, startingCumulativeKwh } = nextReadingPosition(
    state,
    incrementKwh
  );

  const readings = generateReadings({
    count: readingCount,
    startingCumulativeKwh,
    incrementKwh,
    startingSequence,
    meterId,
    privateKeyPem: keys.privateKeyPem
  });
  const last = readings[readings.length - 1];

  await writeState(statePath, {
    ...state,
    sequence: last.sequence,
    cumulativeKwh: last.cumulativeKwh,
    updatedAt: last.timestamp
  });

  printJson(
    readingsEnvelope(readings, { keyFingerprint: keys.keyFingerprint })
  );
}

async function commandTamper(options) {
  assertKnownOptions(options, [
    "keys-dir",
    "state",
    "meter-id",
    "initial-kwh",
    "increment-kwh",
    "delta-kwh"
  ]);

  const keys = await loadSimulatorKeys(options);
  const statePath = options.state
    ? resolvePath(stringOption(options, "state"))
    : DEFAULT_STATE_PATH;
  const meterId = stringOption(options, "meter-id", DEFAULT_METER_ID);
  const initialCumulativeKwh = numberOption(options, "initial-kwh", 0);
  const incrementKwh = numberOption(options, "increment-kwh", 0.25);
  const deltaKwh = numberOption(options, "delta-kwh", 1);
  if (deltaKwh === 0) {
    throw new Error("--delta-kwh must be non-zero");
  }

  const state = await loadStateForCommand({
    statePath,
    meterId,
    initialCumulativeKwh,
    reset: false,
    options
  });
  const { startingSequence, startingCumulativeKwh } = nextReadingPosition(
    state,
    incrementKwh
  );
  const [original] = generateReadings({
    count: 1,
    startingCumulativeKwh,
    incrementKwh,
    startingSequence,
    meterId,
    privateKeyPem: keys.privateKeyPem
  });
  const tampered = tamperCumulativeKwh(original, deltaKwh);

  const originalVerification = verifyReading(original, keys.publicKeyPem);
  const tamperedVerification = verifyReading(tampered, keys.publicKeyPem);
  const tamperDetected =
    originalVerification.valid && !tamperedVerification.valid;

  printJson({
    demonstration: "tamper-detection",
    notice: SIMULATION_NOTICE,
    keyFingerprint: keys.keyFingerprint,
    stateUpdated: false,
    deltaKwh,
    original,
    tampered,
    originalVerification,
    tamperedVerification,
    tamperDetected
  });

  if (!tamperDetected) {
    process.exitCode = 1;
  }
}

async function commandVerify(options) {
  assertKnownOptions(options, ["input", "public-key", "keys-dir"]);

  let publicKeyPem;
  if (options["public-key"]) {
    publicKeyPem = await fs.readFile(
      resolvePath(stringOption(options, "public-key")),
      "utf8"
    );
  } else {
    const { publicKeyPath } = resolveKeyPaths(options);
    publicKeyPem = await loadPublicKey(publicKeyPath);
  }

  let inputText;
  const input = stringOption(options, "input", undefined);
  if (!input || input === "-") {
    if (process.stdin.isTTY) {
      throw new Error("Provide --input <file> or pipe a JSON reading to stdin");
    }
    inputText = await readStdinText();
  } else {
    inputText = await fs.readFile(resolvePath(input), "utf8");
  }

  let document;
  try {
    document = JSON.parse(inputText);
  } catch {
    throw new Error("Input is not valid JSON");
  }

  const readings = extractReadings(document);
  if (readings.length === 0) {
    throw new Error("Input does not contain any readings");
  }

  const results = readings.map((reading) => {
    const verification = verifyReading(reading, publicKeyPem);
    return {
      sequence: Number.isInteger(reading?.sequence) ? reading.sequence : null,
      meterId: typeof reading?.meterId === "string" ? reading.meterId : null,
      simulated: reading?.simulated === true,
      valid: verification.valid,
      reason: verification.reason
    };
  });
  const valid = results.every((result) => result.valid);

  printJson({
    valid,
    checked: results.length,
    keyFingerprint: fingerprintPublicKey(publicKeyPem),
    readings: results
  });

  if (!valid) {
    process.exitCode = 1;
  }
}

async function main() {
  const [command, ...tokens] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help") {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  const options = parseOptions(tokens);
  if (booleanOption(options, "help")) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  switch (command) {
    case "key:init":
      await commandKeyInit(options);
      break;
    case "key:show":
      await commandKeyShow(options);
      break;
    case "reading":
      await commandReadings(options, { count: 1, commandName: "reading" });
      break;
    case "readings":
      await commandReadings(options, { count: 5, commandName: "readings" });
      break;
    case "verify":
      await commandVerify(options);
      break;
    case "tamper":
      await commandTamper(options);
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({
      error: {
        message: error instanceof Error ? error.message : "Unknown simulator error"
      }
    })}\n`
  );
  process.exitCode = 1;
});
