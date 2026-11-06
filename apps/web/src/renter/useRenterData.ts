import { useCallback, useEffect, useState } from "react";
import {
  api,
  type Bill,
  type CreReport,
  type Dispute,
  type Meter,
  type Property,
  type Reading,
  type Room,
  type Tariff,
  type Tenancy
} from "../api.js";
import { messageOf } from "../lib/model.js";

const REFRESH_MS = 15_000;

/** A dispute always points at a bill; older rows only carry the legacy session id. */
export const disputeBillId = (dispute: Dispute) => dispute.billId ?? dispute.sessionId;

export const amountDue = (bill: Bill) => bill.amountDueNpr ?? bill.electricityChargeNpr;

export const cumulativeKwh = (reading: Reading | undefined): number | undefined => {
  const payload = reading?.payload as
    | { cumulativeEnergyKwh?: number; cumulativeKwh?: number }
    | undefined;
  return payload?.cumulativeEnergyKwh ?? payload?.cumulativeKwh;
};

export interface RenterData {
  loading: boolean;
  error: string | null;
  tenancy: Tenancy | null;
  room: Room | null;
  property: Property | null;
  meter?: Meter;
  latestReading?: Reading;
  readings: Reading[];
  tariff: Tariff | null;
  bills: Bill[];
  disputes: Dispute[];
  creReports: CreReport[];
  unpaid: Bill[];
  paid: Bill[];
  latestBill?: Bill;
  /** Outstanding amount across every issued bill. */
  due: number;
  /** Sum of every bill already settled. */
  paidTotal: number;
  /** Units on the live meter since the last bill closed. */
  unitsSinceLastBill?: number;
  /** Cumulative meter total, always available once a reading exists. */
  totalUnits?: number;
  currentRate?: number;
  openQuestions: Dispute[];
  reload: () => Promise<void>;
}

export function useRenterData(): RenterData {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<Awaited<ReturnType<typeof api.renterOverview>> | null>(
    null
  );
  const [creReports, setCreReports] = useState<CreReport[]>([]);

  const reload = useCallback(async () => {
    try {
      const [nextOverview, { reports }] = await Promise.all([
        api.renterOverview(),
        api.creReports()
      ]);
      setOverview(nextOverview);
      setCreReports(reports);
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

  const bills = overview?.bills ?? [];
  const unpaid = bills.filter(
    (bill) => bill.status === "issued" || bill.status === "payment_pending_verification"
  );
  const paid = bills.filter((bill) => bill.status === "paid");
  const latestBill = bills[0];
  const totalUnits = cumulativeKwh(overview?.latestReading);
  const unitsSinceLastBill =
    totalUnits !== undefined && latestBill
      ? Math.max(0, totalUnits - latestBill.endingCumulativeKwh)
      : totalUnits;
  const currentRate =
    overview?.summary.currentRateNprPerKwh ??
    overview?.tariff?.rateNprPerKwh ??
    overview?.tariff?.nprPerKwh ??
    latestBill?.rateNprPerKwh;

  return {
    loading,
    error,
    tenancy: overview?.tenancy ?? null,
    room: overview?.room ?? null,
    property: overview?.property ?? null,
    meter: overview?.meter,
    latestReading: overview?.latestReading,
    readings: overview?.readings ?? [],
    tariff: overview?.tariff ?? null,
    bills,
    disputes: overview?.disputes ?? [],
    creReports,
    unpaid,
    paid,
    latestBill,
    due: overview?.summary.dueNpr ?? 0,
    paidTotal: overview?.summary.paidNpr ?? 0,
    unitsSinceLastBill,
    totalUnits,
    currentRate,
    openQuestions: (overview?.disputes ?? []).filter((dispute) => dispute.status === "open"),
    reload
  };
}
