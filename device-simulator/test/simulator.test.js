import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalPayload } from "../src/canonical.js";
import {
  createReading,
  generateReadings,
  tamperCumulativeKwh,
  verifyReading
} from "../src/reading.js";
import {
  fingerprintPublicKey,
  generateKeyPair,
  initializeDevKeyPair,
  loadPrivateKey
} from "../src/keys.js";
import { createMeterState, readState, writeState } from "../src/state.js";

const execFileAsync = promisify(execFile);
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(testDirectory, "../src/cli.js");
const keys = generateKeyPair();
const timestamp = "2026-10-23T12:00:00.000Z";

function runCliWithInput(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("CLI timed out while reading stdin"));
    }, 10_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

function createSignedReading(overrides = {}) {
  return createReading({
    meterId: "METER-001",
    cumulativeKwh: 120.25,
    timestamp,
    sequence: 1,
    privateKeyPem: keys.privateKeyPem,
    ...overrides
  });
}

test("canonical payload is deterministic, sorted, compact, and excludes the signature", () => {
  const reading = {
    timestamp,
    simulated: true,
    sequence: 3,
    signature: "ignored",
    meterId: "METER-001",
    deviceType: "simulated-esp32",
    cumulativeKwh: 12.5
  };

  const canonical = canonicalPayload(reading);
  assert.equal(
    canonical,
    '{"cumulativeKwh":12.5,"deviceType":"simulated-esp32","meterId":"METER-001","sequence":3,"simulated":true,"timestamp":"2026-10-23T12:00:00.000Z"}'
  );
  assert.equal(canonicalPayload(reading), canonical);
  assert.equal(
    canonicalPayload({ ...reading, signature: "different-signature" }),
    canonical
  );
  assert.equal(canonical.includes(" "), false);
});

test("a newly signed reading verifies with the matching public key", () => {
  const reading = createSignedReading();

  assert.equal(reading.deviceType, "simulated-esp32");
  assert.equal(reading.simulated, true);
  assert.equal(reading.signature.length > 0, true);
  assert.deepEqual(verifyReading(reading, keys.publicKeyPem), {
    valid: true,
    reason: null
  });
});

test("changing cumulative kWh without re-signing invalidates the reading", () => {
  const reading = createSignedReading();
  const altered = { ...reading, cumulativeKwh: reading.cumulativeKwh + 50 };
  const result = verifyReading(altered, keys.publicKeyPem);

  assert.equal(result.valid, false);
  assert.match(result.reason, /signature does not match/);
});

test("an invalid signature is rejected", () => {
  const reading = createSignedReading();
  const invalid = {
    ...reading,
    signature: Buffer.alloc(64).toString("base64")
  };

  assert.equal(verifyReading(invalid, keys.publicKeyPem).valid, false);
});

test("tamper helper preserves the original signature and is detected", () => {
  const reading = createSignedReading();
  const tampered = tamperCumulativeKwh(reading, 2.5);

  assert.equal(tampered.signature, reading.signature);
  assert.equal(tampered.cumulativeKwh, reading.cumulativeKwh + 2.5);
  assert.equal(verifyReading(reading, keys.publicKeyPem).valid, true);
  assert.equal(verifyReading(tampered, keys.publicKeyPem).valid, false);
});

test("multiple readings have increasing sequence numbers and cumulative kWh", () => {
  const readings = generateReadings({
    count: 4,
    startingCumulativeKwh: 100,
    incrementKwh: 0.5,
    startingSequence: 7,
    timestampFactory: (index) =>
      new Date(Date.parse(timestamp) + index * 1_000),
    privateKeyPem: keys.privateKeyPem
  });

  assert.deepEqual(
    readings.map((reading) => reading.sequence),
    [7, 8, 9, 10]
  );
  assert.deepEqual(
    readings.map((reading) => reading.cumulativeKwh),
    [100, 100.5, 101, 101.5]
  );
  assert.equal(readings.every((reading) => verifyReading(reading, keys.publicKeyPem).valid), true);
});

test("key files are created with safe permissions and never expose private key material", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chargemesh-keys-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const privateKeyPath = path.join(directory, "keys", "meter-private.pem");
  const publicKeyPath = path.join(directory, "keys", "meter-public.pem");
  const result = await initializeDevKeyPair({ privateKeyPath, publicKeyPath });

  const privateStat = await fs.stat(privateKeyPath);
  const publicStat = await fs.stat(publicKeyPath);
  assert.equal(privateStat.mode & 0o777, 0o600);
  assert.equal(publicStat.mode & 0o777, 0o644);
  assert.match(await loadPrivateKey(privateKeyPath), /BEGIN PRIVATE KEY/);
  assert.match(result.publicKeyPem, /BEGIN PUBLIC KEY/);
  assert.equal(JSON.stringify(result).includes("PRIVATE KEY"), false);
  assert.equal(result.keyFingerprint, fingerprintPublicKey(result.publicKeyPem));

  await assert.rejects(
    initializeDevKeyPair({ privateKeyPath, publicKeyPath }),
    /Refusing to overwrite/
  );
});

test("meter state persists and reloads", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chargemesh-state-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const statePath = path.join(directory, "state", "meter.json");
  const state = {
    ...createMeterState({ meterId: "METER-001", initialCumulativeKwh: 42 }),
    sequence: 9,
    cumulativeKwh: 43.25,
    updatedAt: timestamp
  };

  await writeState(statePath, state);
  assert.deepEqual(await readState(statePath), state);
});

test("CLI generates, verifies, persists, and detects tampering end to end", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chargemesh-cli-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const keysDirectory = path.join(directory, "keys");
  const statePath = path.join(directory, "state", "meter.json");
  const readingPath = path.join(directory, "reading.json");
  const tamperedPath = path.join(directory, "tampered.json");
  const common = [
    "--keys-dir",
    keysDirectory,
    "--state",
    statePath
  ];

  const init = await execFileAsync(process.execPath, [
    cliPath,
    "key:init",
    "--keys-dir",
    keysDirectory
  ]);
  const initOutput = JSON.parse(init.stdout);
  assert.match(initOutput.publicKeyPem, /BEGIN PUBLIC KEY/);
  assert.equal(initOutput.privateKeyPrinted, false);

  const first = await execFileAsync(process.execPath, [
    cliPath,
    "reading",
    ...common,
    "--initial-kwh",
    "50",
    "--increment-kwh",
    "0.5"
  ]);
  const firstOutput = JSON.parse(first.stdout);
  assert.equal(firstOutput.readings.length, 1);
  assert.equal(firstOutput.readings[0].sequence, 1);
  assert.equal(firstOutput.readings[0].cumulativeKwh, 50);

  const batch = await execFileAsync(process.execPath, [
    cliPath,
    "readings",
    ...common,
    "--count",
    "3",
    "--increment-kwh",
    "0.5"
  ]);
  const batchOutput = JSON.parse(batch.stdout);
  assert.deepEqual(
    batchOutput.readings.map((reading) => reading.sequence),
    [2, 3, 4]
  );
  assert.deepEqual(
    batchOutput.readings.map((reading) => reading.cumulativeKwh),
    [50.5, 51, 51.5]
  );

  const persistedState = JSON.parse(await fs.readFile(statePath, "utf8"));
  assert.equal(persistedState.sequence, 4);
  assert.equal(persistedState.cumulativeKwh, 51.5);

  await fs.writeFile(readingPath, batch.stdout);
  const verification = await execFileAsync(process.execPath, [
    cliPath,
    "verify",
    "--input",
    readingPath,
    "--public-key",
    path.join(keysDirectory, "meter-public.pem")
  ]);
  const verificationOutput = JSON.parse(verification.stdout);
  assert.equal(verificationOutput.valid, true);
  assert.equal(verificationOutput.checked, 3);

  const pipedVerification = await runCliWithInput(
    [
      "verify",
      "--input",
      "-",
      "--public-key",
      path.join(keysDirectory, "meter-public.pem")
    ],
    batch.stdout
  );
  assert.equal(pipedVerification.code, 0);
  assert.equal(JSON.parse(pipedVerification.stdout).valid, true);

  const beforeTamper = await fs.readFile(statePath, "utf8");
  const tamper = await execFileAsync(process.execPath, [
    cliPath,
    "tamper",
    ...common,
    "--delta-kwh",
    "1"
  ]);
  const tamperOutput = JSON.parse(tamper.stdout);
  assert.equal(tamperOutput.originalVerification.valid, true);
  assert.equal(tamperOutput.tamperedVerification.valid, false);
  assert.equal(tamperOutput.tamperDetected, true);
  assert.equal(tamperOutput.stateUpdated, false);
  assert.equal(await fs.readFile(statePath, "utf8"), beforeTamper);

  await fs.writeFile(
    tamperedPath,
    JSON.stringify({ readings: [tamperOutput.tampered] })
  );
  const failedVerification = await execFileAsync(process.execPath, [
    cliPath,
    "verify",
    "--input",
    tamperedPath,
    "--public-key",
    path.join(keysDirectory, "meter-public.pem")
  ]).then(
    () => null,
    (error) => error
  );
  assert.notEqual(failedVerification, null);
  assert.equal(failedVerification.code, 1);
  assert.equal(JSON.parse(failedVerification.stdout).valid, false);
});
