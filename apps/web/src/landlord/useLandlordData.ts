import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type CreReport, type Property, type Tariff } from "../api.js";
import {
  buildBillView,
  buildDisputeView,
  buildRoomView,
  messageOf,
  type BillView,
  type DisputeView,
  type RoomView
} from "../lib/model.js";

const REFRESH_MS = 15_000;
const PROPERTY_KEY = "chargemesh_property";

function rememberedProperty(): string | null {
  try {
    return localStorage.getItem(PROPERTY_KEY);
  } catch {
    return null;
  }
}

export interface LandlordData {
  loading: boolean;
  error: string | null;
  properties: Property[];
  property: Property | null;
  selectProperty: (id: string) => void;
  rooms: RoomView[];
  bills: BillView[];
  disputes: DisputeView[];
  creReports: CreReport[];
  tariffs: Tariff[];
  wallets: any[];
  /** Rate shown as "the" property rate: its default, else the most common room rate. */
  propertyRate: number | undefined;
  reload: () => Promise<void>;
}

export function useLandlordData(): LandlordData {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [propertyId, setPropertyId] = useState<string | null>(rememberedProperty);
  const [allRooms, setAllRooms] = useState<RoomView[]>([]);
  const [allBills, setAllBills] = useState<BillView[]>([]);
  const [allDisputes, setAllDisputes] = useState<DisputeView[]>([]);
  const [creReports, setCreReports] = useState<CreReport[]>([]);
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [wallets, setWallets] = useState<any[]>([]);

  const reload = useCallback(async () => {
    try {
      const [{ properties }, { rooms }, { tariffs }, { bills }, { disputes }, { wallets: walletList }, { reports }] = await Promise.all([
        api.properties(),
        api.rooms(),
        api.tariffs(),
        api.bills(),
        api.disputes(),
        api.wallets().catch(() => ({ wallets: [] })),
        api.creReports()
      ]);
      const tenancies = await Promise.all(
        rooms.map((overview) =>
          api
            .roomTenancies(overview.room.id)
            .then((result) => result.tenancies)
            .catch(() => [])
        )
      );
      const roomViews = rooms.map((overview, index) => buildRoomView(overview, tenancies[index] ?? [], tariffs));
      const billViews = bills.map((bill) => buildBillView(bill, roomViews));
      setProperties(properties);
      setTariffs(tariffs);
      setAllRooms(roomViews);
      setAllBills(billViews);
      setAllDisputes(disputes.map((dispute) => buildDisputeView(dispute, billViews)));
      setCreReports(reports);
      setWallets(walletList ?? []);
      setError(null);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => void reload(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [reload]);

  const property = properties.find((p) => p.id === propertyId) ?? properties[0] ?? null;

  const selectProperty = (id: string) => {
    setPropertyId(id);
    try {
      localStorage.setItem(PROPERTY_KEY, id);
    } catch {
      // Remembering the choice is only a convenience.
    }
  };

  const scoped = useMemo(() => {
    const rooms = allRooms.filter((room) => room.propertyId === property?.id);
    const roomIds = new Set(rooms.map((room) => room.id));
    const bills = allBills.filter((bill) => roomIds.has(bill.roomId));
    const disputes = allDisputes.filter((dispute) => dispute.bill && roomIds.has(dispute.bill.roomId));
    return { rooms, bills, disputes };
  }, [allRooms, allBills, allDisputes, property?.id]);

  const propertyRate = useMemo(() => {
    if (property?.defaultRateNprPerKwh) return property.defaultRateNprPerKwh;
    const counts = new Map<number, number>();
    for (const room of scoped.rooms) {
      if (room.rate !== undefined) counts.set(room.rate, (counts.get(room.rate) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  }, [property, scoped.rooms]);

  return {
    loading,
    error,
    properties,
    property,
    selectProperty,
    ...scoped,
    creReports,
    tariffs,
    wallets,
    propertyRate,
    reload
  };
}
