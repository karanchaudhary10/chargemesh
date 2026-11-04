import type { Bill, Dispute, Meter, Reading, RoomOverview, Tariff } from "../api.js";
import type { TenancyWithRenter } from "../api.js";

export type MeterStatus = "Working" | "Offline" | "No meter";

export interface RoomView {
  id: string;
  name: string;
  floor: string;
  unitType: string;
  propertyId?: string;
  meter?: Meter;
  meterStatus: MeterStatus;
  latestReading?: Reading;
  recentReadings: Reading[];
  renter?: { id: string; name: string; email: string; tenancyId: string; since: string };
  tenancies: TenancyWithRenter[];
  rate?: number;
}

export interface BillView extends Bill {
  roomName: string;
  roomFloor: string;
  renterName: string;
  renterEmail?: string;
  amountDue: number;
}

export interface DisputeView extends Dispute {
  bill?: BillView;
  renterName: string;
  roomName: string;
}

export function cumulativeKwh(reading: Reading | undefined): number | undefined {
  if (!reading) return undefined;
  const payload = reading.payload as { cumulativeEnergyKwh?: number; cumulativeKwh?: number };
  return payload.cumulativeEnergyKwh ?? payload.cumulativeKwh;
}

/** A meter is "Working" while it keeps reporting within its stale window (default 60 s). */
export function meterStatus(meter: Meter | undefined, latest: Reading | undefined): MeterStatus {
  if (!meter) return "No meter";
  if (meter.status !== "active" || !latest) return "Offline";
  const staleAfter = meter.staleAfterMs ?? 60_000;
  return Date.now() - Date.parse(latest.payload.timestamp) <= staleAfter * 2 ? "Working" : "Offline";
}

/** The open-ended (current) tariff for a room. */
export function currentRoomRate(tariffs: Tariff[], roomId: string): number | undefined {
  const now = Date.now();
  const applicable = tariffs
    .filter((tariff) => (tariff.roomId ?? tariff.scope) === roomId)
    .filter((tariff) => Date.parse(tariff.effectiveFrom) <= now && (!tariff.effectiveTo || Date.parse(tariff.effectiveTo) >= now))
    .sort((a, b) => Date.parse(b.effectiveFrom) - Date.parse(a.effectiveFrom));
  const tariff = applicable[0];
  return tariff ? (tariff.rateNprPerKwh ?? tariff.nprPerKwh) : undefined;
}

export function buildRoomView(
  overview: RoomOverview,
  tenancies: TenancyWithRenter[],
  tariffs: Tariff[]
): RoomView {
  const active = tenancies.find((tenancy) => tenancy.status === "active");
  return {
    id: overview.room.id,
    name: overview.room.name,
    floor: overview.room.floor ?? "",
    unitType: overview.room.unitType ?? "",
    propertyId: overview.room.propertyId,
    meter: overview.meter,
    meterStatus: meterStatus(overview.meter, overview.latestReading),
    latestReading: overview.latestReading,
    recentReadings: overview.recentReadings,
    renter:
      active && active.renter
        ? { ...active.renter, tenancyId: active.tenancyId, since: active.startDate }
        : undefined,
    tenancies,
    rate: currentRoomRate(tariffs, overview.room.id)
  };
}

/** The renter who held the room at the end of the bill's period. */
function renterForBill(room: RoomView | undefined, bill: Bill): TenancyWithRenter["renter"] {
  if (!room) return null;
  const at = Date.parse(bill.periodEnd);
  const tenancy = room.tenancies.find((t) => {
    const start = Date.parse(t.startDate);
    const end = t.endDate ? Date.parse(t.endDate) : Number.POSITIVE_INFINITY;
    return start <= at && at <= end;
  });
  return tenancy?.renter ?? null;
}

export function buildBillView(bill: Bill, rooms: RoomView[]): BillView {
  const room = rooms.find((r) => r.id === bill.roomId);
  const renter = renterForBill(room, bill);
  return {
    ...bill,
    roomName: room?.name ?? bill.roomId,
    roomFloor: room?.floor ?? "",
    renterName: renter?.name ?? "No renter",
    renterEmail: renter?.email,
    amountDue: bill.amountDueNpr ?? bill.electricityChargeNpr
  };
}

export function buildDisputeView(dispute: Dispute, bills: BillView[]): DisputeView {
  const bill = bills.find((b) => b.billId === (dispute.billId ?? dispute.sessionId));
  return {
    ...dispute,
    bill,
    renterName: bill?.renterName ?? "Renter",
    roomName: bill?.roomName ?? ""
  };
}

export interface MeterStats {
  readings: number;
  rejected: number;
  averageW?: number;
  peakW?: number;
  minimumW?: number;
}

/** Load profile for a time window, from the readings the API returned. */
export function meterStats(readings: Reading[], start: string, end: string): MeterStats {
  const from = Date.parse(start);
  const to = Date.parse(end);
  const inWindow = readings.filter((reading) => {
    const t = Date.parse(reading.payload.timestamp);
    return t >= from && t <= to;
  });
  const accepted = inWindow.filter((reading) => reading.status === "accepted");
  const powers = accepted
    .map((reading) => (reading.payload as { powerW?: number }).powerW)
    .filter((value): value is number => typeof value === "number");
  return {
    readings: accepted.length,
    rejected: inWindow.length - accepted.length,
    averageW: powers.length ? powers.reduce((sum, value) => sum + value, 0) / powers.length : undefined,
    peakW: powers.length ? Math.max(...powers) : undefined,
    minimumW: powers.length ? Math.min(...powers) : undefined
  };
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}
