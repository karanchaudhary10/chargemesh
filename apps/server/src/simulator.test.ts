import { describe, expect, it } from "vitest";
import { generateMeterKeyPair } from "@chargemesh/shared/node";
import type { Config } from "./config.js";
import { AuditService } from "./audit.js";
import { AppError } from "./errors.js";
import { HederaService } from "./hedera.js";
import { createTestRepositories } from "./test-db.js";
import { SimulatorKeyStore } from "./keys.js";
import { ReadingService } from "./readings.js";
import { SimulatorService } from "./simulator.js";

const NOW = Date.parse("2026-10-23T10:00:00.000Z");

function testConfig(): Config {
  return {
    port: 4000,
    simulatorEnabled: false,
    simulatorIntervalMs: 5_000,
    staleAfterMs: 120_000,
    maxPowerW: 5_000,
    energyJumpTolerance: 1.5,
    hederaNetwork: "testnet",
    hederaMirrorNodeUrl: "https://testnet.mirrornode.hedera.com/api/v1",
    hederaEnabled: false
  } as Config;
}

describe("simulator meter isolation", () => {
  it("only generates simulator readings for software meters and preserves physical keys", async () => {
    const repositories = await createTestRepositories();
    const keys = new SimulatorKeyStore();
    const config = testConfig();
    const audit = new AuditService(repositories, new HederaService(config));
    const readings = new ReadingService(repositories, audit, config);
    const simulatorKey = keys.create("software_meter");
    const physicalKey = generateMeterKeyPair();
    await repositories.transaction(async (tx) => {
      await tx.meters.save({
        id: "software_meter",
        meterId: "software_meter",
        roomId: "room_software",
        publicKeyPem: simulatorKey.publicKeyPem,
        deviceType: "simulator",
        status: "active",
        createdAt: new Date(NOW - 10_000).toISOString()
      });
      await tx.meters.save({
        id: "physical_meter",
        meterId: "physical_meter",
        roomId: "room_physical",
        publicKeyPem: physicalKey.publicKeyPem,
        deviceType: "physical",
        status: "active",
        createdAt: new Date(NOW - 10_000).toISOString()
      });
    });
    const simulator = new SimulatorService(repositories, keys, readings, config);

    const generated = await simulator.tick(undefined, NOW);

    expect(generated).toHaveLength(1);
    expect(generated[0]?.meterId).toBe("software_meter");
    expect(generated[0]?.source).toBe("simulator");
    expect((await repositories.meters.findById("physical_meter"))?.publicKeyPem)
      .toBe(physicalKey.publicKeyPem);
    await expect(simulator.tick("physical_meter", NOW)).rejects.toMatchObject({
      code: "simulator_meter_required"
    } satisfies Partial<AppError>);
    await expect(simulator.attack("tamper", "physical_meter", NOW)).rejects.toMatchObject({
      code: "simulator_meter_required"
    } satisfies Partial<AppError>);
  });

  it("keeps ticking other meters when one simulator meter has lost its key", async () => {
    const repositories = await createTestRepositories();
    const keys = new SimulatorKeyStore();
    const config = testConfig();
    const audit = new AuditService(repositories, new HederaService(config));
    const readings = new ReadingService(repositories, audit, config);
    const withKey = keys.create("keyed_meter");
    const orphan = generateMeterKeyPair();
    await repositories.transaction(async (tx) => {
      for (const [id, publicKeyPem] of [
        ["keyed_meter", withKey.publicKeyPem],
        ["orphan_meter", orphan.publicKeyPem]
      ] as const) {
        await tx.meters.save({
          id,
          meterId: id,
          roomId: `room_${id}`,
          publicKeyPem,
          deviceType: "simulator",
          status: "active",
          createdAt: new Date(NOW - 10_000).toISOString()
        });
      }
    });
    const simulator = new SimulatorService(repositories, keys, readings, config);

    const generated = await simulator.tick(undefined, NOW);

    expect(generated.map((reading) => reading.meterId)).toEqual(["keyed_meter"]);
    await expect(simulator.tick("orphan_meter", NOW)).rejects.toMatchObject({
      code: "simulator_key_missing"
    } satisfies Partial<AppError>);
  });
});
