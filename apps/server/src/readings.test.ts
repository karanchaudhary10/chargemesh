import { describe, expect, it } from "vitest";
import type { Config } from "./config.js";
import { signReading } from "@chargemesh/shared/node";
import type { ReadingSubmission, SignedReadingPayload } from "@chargemesh/shared";
import { connectTestRepositories, createTestRepositories } from "./test-db.js";
import { MeterKeyStore } from "./keys.js";
import { HederaService } from "./hedera.js";
import { AuditService } from "./audit.js";
import { ReadingService } from "./readings.js";

const NOW = Date.parse("2026-10-23T10:00:00.000Z");
const METER_ID = "mtr_test";
const ROOM_ID = "room_test";

function testConfig(): Config {
  return {
    port: 4000,
    staleAfterMs: 120_000,
    maxPowerW: 5_000,
    energyJumpTolerance: 1.5,
    hederaNetwork: "testnet",
    hederaMirrorNodeUrl: "https://testnet.mirrornode.hedera.com/api/v1",
    hederaEnabled: false
  } as Config;
}

async function setup() {
  const repositories = await createTestRepositories();
  const keys = new MeterKeyStore();
  const config = testConfig();
  const audit = new AuditService(repositories, new HederaService(config));
  const readings = new ReadingService(repositories, audit, config);
  const pair = keys.create(METER_ID);
  await repositories.transaction(async (tx) => {
    await tx.rooms.save({
      id: ROOM_ID,
      name: "Test room",
      description: "Created by the test user",
      createdAt: new Date(NOW - 10_000).toISOString()
    });
    await tx.meters.save({
      id: METER_ID,
      roomId: ROOM_ID,
      label: "Test meter",
      publicKeyPem: pair.publicKeyPem,
      status: "active",
      maxPowerW: 5_000,
      staleAfterMs: 120_000,
      createdAt: new Date(NOW - 10_000).toISOString()
    });
  });
  return { repositories, keys, readings };
}

function payload(overrides: Partial<SignedReadingPayload> = {}): SignedReadingPayload {
  return {
    meterId: METER_ID,
    roomId: ROOM_ID,
    sequence: 1,
    timestamp: new Date(NOW - 1_000).toISOString(),
    cumulativeEnergyKwh: 1.25,
    powerW: 500,
    voltage: 230,
    current: 2.17,
    nonce: "reading-1",
    ...overrides
  };
}

function signed(
  keys: MeterKeyStore,
  body: SignedReadingPayload
): ReadingSubmission {
  return {
    ...body,
    signature: signReading(body, keys.privateKey(METER_ID)!)
  };
}

describe("reading submissions", () => {
  it("verifies signatures and updates the meter", async () => {
    const { repositories, keys, readings } = await setup();
    const reading = await readings.submit(signed(keys, payload()), "meter", NOW);

    expect(reading.status).toBe("accepted");
    expect((await repositories.readings.list()).map((item) => item.id)).toEqual([reading.id]);
    expect((await repositories.meters.findById(METER_ID))?.lastAcceptedEnergyKwh).toBe(1.25);
  });

  it("rejects an exact duplicate submission", async () => {
    const { keys, readings } = await setup();
    const submission = signed(keys, payload());
    await readings.submit(submission, "meter", NOW);

    await expect(readings.submit(submission, "meter", NOW)).rejects.toMatchObject({
      code: "duplicate_reading"
    });
  });

  it("rejects a re-signed replay of an observed sequence", async () => {
    const { keys, readings } = await setup();
    await readings.submit(signed(keys, payload()), "meter", NOW);

    await expect(
      readings.submit(
        signed(
          keys,
          payload({
            timestamp: new Date(NOW - 500).toISOString(),
            cumulativeEnergyKwh: 1.3,
            nonce: "replay-of-sequence-1"
          })
        ),
        "meter",
        NOW
      )
    ).rejects.toMatchObject({ code: "replayed_sequence" });
  });

  it("rejects a payload changed after signing", async () => {
    const { keys, readings } = await setup();
    const body = payload({ sequence: 2, cumulativeEnergyKwh: 1.3, nonce: "reading-2" });
    const submission = signed(keys, body) as any;
    submission.cumulativeEnergyKwh = 99;

    await expect(readings.submit(submission, "meter", NOW)).rejects.toMatchObject({
      code: "invalid_signature"
    });
  });

  it("persists data across repository instances", async () => {
    const first = await createTestRepositories();
    await first.transaction(async (tx) => {
      await tx.rooms.save({
        id: ROOM_ID,
        name: "Persistent room",
        description: "",
        createdAt: new Date(NOW).toISOString()
      });
    });
    expect(await first.rooms.list()).toHaveLength(1);

    const next = await connectTestRepositories();
    expect((await next.rooms.findById(ROOM_ID))?.name).toBe("Persistent room");
    expect(await next.readings.list()).toEqual([]);
  });

  it("rolls back every write when a transaction fails", async () => {
    const repositories = await createTestRepositories();
    await expect(
      repositories.transaction(async (tx) => {
        await tx.rooms.save({
          id: ROOM_ID,
          name: "Rolled back room",
          description: "",
          createdAt: new Date(NOW).toISOString()
        });
        throw new Error("abort");
      })
    ).rejects.toThrow("abort");
    expect(await repositories.rooms.list()).toEqual([]);
  });
});
