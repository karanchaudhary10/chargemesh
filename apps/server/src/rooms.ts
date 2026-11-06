import { randomUUID } from "node:crypto";
import {
  roundKwh,
  type Meter,
  type Room,
  type RoomCreateInput,
  type RoomOverview,
  type MeterCreateInput,
  type Reading,
  type Session,
  type Tariff
} from "@chargemesh/shared";
import type { Config } from "./config.js";
import type { MeterKeyStore } from "./keys.js";
import type { Repositories } from "./repositories.js";
import { appendAuditEvent } from "./audit-core.js";
import type { AuditService } from "./audit.js";
import { latestTariff } from "./tariffs.js";
import { AppError } from "./errors.js";

function slug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return normalized || "room";
}

export class RoomService {
  constructor(
    private readonly repositories: Repositories,
    private readonly keys: MeterKeyStore,
    private readonly audit: AuditService,
    private readonly config: Config
  ) {}

  async createRoom(input: RoomCreateInput, actor: string): Promise<Room> {
    const result = await this.repositories.transaction(async (tx) => {
      const room: Room = {
        id: `room_${slug(input.name)}_${randomUUID().slice(0, 6)}`,
        propertyId: input.propertyId,
        name: input.name.trim(),
        description: input.description.trim(),
        ensName: input.ensName?.trim() || undefined,
        floor: input.floor?.trim() || undefined,
        unitType: input.unitType?.trim() || undefined,
        createdAt: new Date().toISOString()
      };
      await tx.rooms.save(room);
      const event = await appendAuditEvent(tx.auditEvents, {
        type: "room.created",
        actor,
        payload: {
          roomId: room.id,
          name: room.name,
          ensName: room.ensName ?? null
        }
      });
      return { room, event };
    });
    void this.audit.notarize(result.event);
    return result.room;
  }

  async createMeter(roomId: string, input: MeterCreateInput, actor: string): Promise<Meter> {
    const meterId = `mtr_${randomUUID().slice(0, 12)}`;
    const pair = this.keys.create(meterId);
    const result = await this.repositories.transaction(async (tx) => {
      const room = await tx.rooms.findById(roomId);
      if (!room) {
        throw new AppError(404, "room_not_found", "Room was not found");
      }
      if (await tx.meters.findActiveByRoom(roomId)) {
        throw new AppError(
          409,
          "meter_already_registered",
          "Room already has an active submeter"
        );
      }

      const meter: Meter = {
        id: meterId,
        meterId,
        roomId,
        label: input.label?.trim() || meterId,
        publicKeyPem: pair.publicKeyPem,
        publicKey: pair.publicKeyPem,
        deviceType: input.deviceType ?? "physical",
        status: "active",
        maxPowerW: input.maxPowerW ?? this.config.maxPowerW,
        staleAfterMs: input.staleAfterMs ?? this.config.staleAfterMs,
        createdAt: new Date().toISOString()
      };
      await tx.meters.save(meter);
      await tx.meterKeys?.save(meterId, pair.privateKeyPem);
      const event = await appendAuditEvent(tx.auditEvents, {
        type: "meter.registered",
        actor,
        payload: {
          meterId: meter.id,
          roomId,
          label: meter.label,
          maxPowerW: meter.maxPowerW,
          staleAfterMs: meter.staleAfterMs
        }
      });
      return { meter, event };
    });
    void this.audit.notarize(result.event);
    return result.meter;
  }

  async listOverviews(): Promise<RoomOverview[]> {
    const [rooms, meters, readings, bills, tariffs] = await Promise.all([
      this.repositories.rooms.list(),
      this.repositories.meters.list(),
      this.repositories.readings.list(),
      this.repositories.bills.list(),
      this.repositories.tariffs.list()
    ]);
    const tariff = latestTariff(tariffs);
    return rooms
      .map((room) =>
        this.overviewFromData(room, meters, readings, bills, tariff)
      )
      .sort((a, b) => a.room.name.localeCompare(b.room.name));
  }

  async overview(roomId: string): Promise<RoomOverview> {
    const [room, meters, readings, bills, tariffs] = await Promise.all([
      this.repositories.rooms.findById(roomId),
      this.repositories.meters.list(),
      this.repositories.readings.list({ roomId }),
      this.repositories.bills.list(),
      this.repositories.tariffs.list()
    ]);
    if (!room) {
      throw new AppError(404, "room_not_found", "Room was not found");
    }
    return this.overviewFromData(room, meters, readings, bills, latestTariff(tariffs));
  }

  private overviewFromData(
    room: Room,
    meters: Meter[],
    readings: Reading[],
    bills: Session[],
    tariff: Tariff | null
  ): RoomOverview {
    const roomMeters = meters.filter(
      (meter) => meter.roomId === room.id && meter.status === "active"
    );
    const meter = roomMeters[0];
    const accepted = readings
      .filter((reading) => reading.roomId === room.id && reading.status === "accepted")
      .sort((a, b) => Date.parse(a.payload.timestamp) - Date.parse(b.payload.timestamp));
    const latest = accepted[accepted.length - 1];
    const activeSession = bills.find(
      (bill) => bill.roomId === room.id && bill.status === "active"
    );
    const recent = accepted.slice(-30);
    const firstRecent = recent[0];
    const recentEnergyKwh =
      latest && firstRecent
        ? roundKwh(
            Math.max(
              0,
              latest.payload.cumulativeEnergyKwh - firstRecent.payload.cumulativeEnergyKwh
            )
          )
        : 0;
    const sessionEnergy =
      latest && activeSession
        ? roundKwh(
            Math.max(
              0,
              latest.payload.cumulativeEnergyKwh - activeSession.startEnergyKwh
            )
          )
        : 0;
    const tariffNprPerKwh = tariff?.nprPerKwh ?? 0;

    return {
      room,
      meter,
      latestReading: latest,
      activeSession,
      recentReadings: recent,
      recentEnergyKwh,
      estimatedCostNpr: Math.round(sessionEnergy * tariffNprPerKwh * 100) / 100,
      flags: latest?.flags ?? []
    };
  }
}
