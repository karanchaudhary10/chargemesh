import { promises as fs } from "node:fs";
import path from "node:path";
import { DEFAULT_METER_ID } from "./reading.js";

export const STATE_SCHEMA_VERSION = 1;

export function createMeterState({
  meterId = DEFAULT_METER_ID,
  initialCumulativeKwh = 0
} = {}) {
  if (!Number.isFinite(initialCumulativeKwh) || initialCumulativeKwh < 0) {
    throw new Error("initialCumulativeKwh must be a finite non-negative number");
  }
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    meterId,
    sequence: 0,
    cumulativeKwh: initialCumulativeKwh,
    updatedAt: null
  };
}

function validateState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("Meter state must be an object");
  }
  if (state.schemaVersion !== STATE_SCHEMA_VERSION) {
    throw new Error(`Unsupported meter state schema version: ${String(state.schemaVersion)}`);
  }
  if (typeof state.meterId !== "string" || state.meterId.trim() === "") {
    throw new Error("Meter state meterId must be a non-empty string");
  }
  if (!Number.isInteger(state.sequence) || state.sequence < 0) {
    throw new Error("Meter state sequence must be a non-negative integer");
  }
  if (!Number.isFinite(state.cumulativeKwh) || state.cumulativeKwh < 0) {
    throw new Error("Meter state cumulativeKwh must be a finite non-negative number");
  }
}

export async function readState(statePath) {
  let content;
  try {
    content = await fs.readFile(statePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }

  let state;
  try {
    state = JSON.parse(content);
  } catch {
    throw new Error(`Meter state at ${statePath} is not valid JSON`);
  }
  validateState(state);
  return state;
}

export async function writeState(statePath, state) {
  validateState(state);
  await fs.mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 });
  const temporary = `${statePath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600
  });
  await fs.rename(temporary, statePath);
}
