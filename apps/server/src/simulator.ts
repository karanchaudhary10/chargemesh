import { randomUUID } from "node:crypto";
import {
  energyFromPower,
  roundKwh,
  type AttackInput,
  type Reading,
  type ReadingSubmission,
  type SignedReadingPayload
} from "@chargemesh/shared";
import { generateMeterKeyPair, signReading } from "@chargemesh/shared/node";
import type { Config } from "./config.js";
import type { SimulatorKeyStore } from "./keys.js";
import type { Repositories } from "./repositories.js";
import type { ReadingService } from "./readings.js";
import { AppError } from "./errors.js";

export interface AttackResult {
  attack: AttackInput["type"];
  explanation: string;
  reading: Reading;
}

function nextSequence(meterSequence: number | undefined, readings: Reading[]): number {
  const maxReadingSequence = readings.reduce(
    (max, reading) => Math.max(max, reading.payload.sequence),
    0
  );
  return Math.max(meterSequence ?? 0, maxReadingSequence) + 1;
}

function simulatedPowerW(): number {
  const base = 90 + Math.random() * 420;
  const applianceBurst = Math.random() > 0.9 ? 650 : 0;
  return Math.round(base + applianceBurst);
}

export class SimulatorService {
  constructor(
    private readonly repositories: Repositories,
    private readonly keys: SimulatorKeyStore,
    private readonly readings: ReadingService,
    private readonly config: Config
  ) {}

  async state() {
    const simulator = await this.repositories.simulator.get();
    return {
      enabled: simulator.enabled,
      intervalMs: this.config.simulatorIntervalMs,
      tickCount: simulator.tickCount,
      lastTickAt: simulator.lastTickAt ?? null
    };
  }

  async setEnabled(enabled: boolean): Promise<{ enabled: boolean; intervalMs: number }> {
    await this.repositories.transaction(async (tx) => {
      const simulator = await tx.simulator.get();
      simulator.enabled = enabled;
      await tx.simulator.save(simulator);
    });
    return { enabled, intervalMs: this.config.simulatorIntervalMs };
  }

  async tick(meterId?: string, now = Date.now()): Promise<Reading[]> {
    const activeMeters = (await this.repositories.meters.list()).filter(
      (meter) =>
        meter.status === "active" &&
        (!meterId || meter.id === meterId || meter.meterId === meterId)
    );
    if (meterId && activeMeters.length === 0) {
      throw new AppError(404, "meter_not_found", "Active meter was not found");
    }
    if (meterId && activeMeters.some((meter) => meter.deviceType !== "simulator")) {
      throw new AppError(
        409,
        "simulator_meter_required",
        "Simulator readings can only be generated for software simulator meters"
      );
    }
    const meters = activeMeters.filter((meter) => meter.deviceType === "simulator");

    const created: Reading[] = [];
    for (const meter of meters) {
      const meterKeyId = (meter as any).meterId ?? meter.id;
      const privateKeyPem = this.keys.privateKey(meterKeyId) ?? this.keys.privateKey(meter.id);
      if (!privateKeyPem) {
        // A sweep over every meter must not stall on one meter whose key was lost.
        if (!meterId) continue;
        throw new AppError(
          500,
          "simulator_key_missing",
          `Simulator signing key is missing for meter ${meter.id}`
        );
      }
      const readings = (await this.repositories.readings.list({ meterId: meter.id }))
        .concat(
          await this.repositories.readings.list({ meterId: meter.meterId })
        )
        .sort((a, b) => b.payload.sequence - a.payload.sequence);
      const last = readings.find((reading) => reading.status === "accepted");
      const baseline = meter.lastAcceptedEnergyKwh ?? last?.payload.cumulativeEnergyKwh ?? 0;
      const lastTimestamp = meter.lastAcceptedAt
        ? Date.parse(meter.lastAcceptedAt)
        : now - 1000;
      const elapsedSeconds = Math.min(300, Math.max(0.001, (now - lastTimestamp) / 1000));
      const powerW = simulatedPowerW();
      const energyKwh = roundKwh(baseline + energyFromPower(powerW, elapsedSeconds));
      const voltage = Math.round((228 + Math.random() * 6) * 10) / 10;
      const payload: SignedReadingPayload = {
        meterId: meter.meterId ?? meter.id,
        roomId: meter.roomId,
        sequence: nextSequence(meter.lastSequenceSeen, readings),
        timestamp: new Date(now).toISOString(),
        cumulativeEnergyKwh: energyKwh,
        powerW,
        voltage,
        current: Math.round((powerW / voltage) * 1000) / 1000,
        nonce: randomUUID()
      };
      const submission: ReadingSubmission = {
        ...payload,
        signature: signReading(payload, privateKeyPem)
      };
      created.push(await this.readings.submit(submission, "simulator", now));
    }

    await this.repositories.transaction(async (tx) => {
      const simulator = await tx.simulator.get();
      simulator.tickCount += 1;
      simulator.lastTickAt = new Date(now).toISOString();
      await tx.simulator.save(simulator);
    });
    return created;
  }

  async attack(
    type: AttackInput["type"],
    meterId?: string,
    now = Date.now()
  ): Promise<AttackResult> {
    const allMeters = (await this.repositories.meters.list()).filter(
      (meter) => meter.status === "active"
    );
    const meter = meterId
      ? allMeters.find((candidate) => candidate.id === meterId || candidate.meterId === meterId)
      : allMeters.find((candidate) => candidate.deviceType === "simulator");
    if (!meter) {
      throw new AppError(404, "meter_not_found", "Active meter was not found");
    }
    if (meter.deviceType !== "simulator") {
      throw new AppError(
        409,
        "simulator_meter_required",
        "Simulator attacks can only target software simulator meters"
      );
    }

    const readings = (await this.repositories.readings.list({ meterId: meter.id })).sort(
      (a, b) => a.payload.sequence - b.payload.sequence
    );
    const accepted = readings.filter((reading) => reading.status === "accepted");
    const latest = accepted[accepted.length - 1];
    const oldest = accepted[0];
    const baseline = meter.lastAcceptedEnergyKwh ?? latest?.payload.cumulativeEnergyKwh ?? 0;
    const sequence = nextSequence(meter.lastSequenceSeen, readings);
    const privateKeyPem = this.keys.privateKey(meter.id);

        if (type !== "unregistered" && !privateKeyPem) {
          throw new AppError(500, "simulator_key_missing", "No simulator key exists for this meter");
        }

        const base = (overrides: Partial<SignedReadingPayload>): SignedReadingPayload => ({
          meterId: meter.meterId ?? meter.id,
          roomId: meter.roomId,
          sequence,
          timestamp: new Date(now).toISOString(),
          cumulativeEnergyKwh: baseline,
          powerW: 150,
          voltage: 230,
          current: 0.65,
          nonce: randomUUID(),
          ...overrides
        });

    let submission: ReadingSubmission;
    let explanation: string;

    switch (type) {
      case "duplicate": {
        if (!latest) {
          throw new AppError(409, "no_reading_to_duplicate", "Meter has no reading to duplicate");
        }
        submission = { ...latest.payload, signature: latest.signature };
        explanation =
          "Resubmitted an identical signed reading. It must be rejected as a duplicate.";
        break;
      }
      case "replay": {
        if (!oldest) {
          throw new AppError(409, "no_reading_to_replay", "Meter has no reading to replay");
        }
        const replayPayload = base({
          sequence: oldest.payload.sequence,
          nonce: `replay-${randomUUID()}`
        });
        submission = {
          ...replayPayload,
          signature: signReading(replayPayload, privateKeyPem!)
        };
        explanation =
          "Re-signed an old sequence with fresh data. A valid signature must not bypass replay protection.";
        break;
      }
      case "stale": {
        const stalePayload = base({
          timestamp: new Date(now - (meter.staleAfterMs ?? 60000) * 2).toISOString(),
          cumulativeEnergyKwh: roundKwh(baseline + 0.4)
        });
        submission = { ...stalePayload, signature: signReading(stalePayload, privateKeyPem!) };
        explanation = "Signed a valid reading with a timestamp outside the freshness window.";
        break;
      }
      case "suspicious": {
        const suspiciousPayload = base({
          cumulativeEnergyKwh: roundKwh(baseline + 25),
          powerW: (meter.maxPowerW ?? 5000) * 2
        });
        submission = {
          ...suspiciousPayload,
          signature: signReading(suspiciousPayload, privateKeyPem!)
        };
        explanation =
          "Signed an implausible energy jump. It must be quarantined, not billed, pending review.";
        break;
      }
      case "unregistered": {
        const pair = generateMeterKeyPair();
        const foreignPayload = base({
          meterId: `mtr_unregistered_${randomUUID().slice(0, 8)}`,
          roomId: meter.roomId,
          sequence: 1,
          cumulativeEnergyKwh: 1,
          powerW: 120
        });
        submission = {
          ...foreignPayload,
          signature: signReading(foreignPayload, pair.privateKeyPem)
        };
        explanation =
          "Signed with a key that is not registered to any meter. The server must reject it.";
        break;
      }
      case "tamper":
      default: {
        const signedPayload = base({
          cumulativeEnergyKwh: roundKwh(baseline + 1.5),
          powerW: 180
        });
        const signature = signReading(signedPayload, privateKeyPem!);
        submission = {
          ...signedPayload,
          cumulativeEnergyKwh: roundKwh(signedPayload.cumulativeEnergyKwh + 5),
          signature
        };
        explanation =
          "Changed cumulative energy after signing. Signature verification must reject the reading.";
        break;
      }
    }

    const reading = await this.readings.submit(submission, "simulator", now);
    return { attack: type, explanation, reading };
  }
}
