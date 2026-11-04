import type { ReactNode } from "react";
import {
  ArrowRight,
  Camera,
  CheckCircle2,
  ChevronRight,
  Clock,
  Gauge,
  Home,
  MapPin,
  MessageSquare,
  Receipt,
  Wallet,
  Zap
} from "lucide-react";
import type { Bill, User } from "../api.js";
import { dateOnly, dateTime, firstName, kwh, npr, period, shortId } from "../lib/format.js";
import { BillStatusBadge, cardClass } from "../components/ui.js";
import { amountDue, disputeBillId, type RenterData } from "./useRenterData.js";

const badgeStatus = (status: string) => (status === "issued" ? "unpaid" : status);

function Stat({
  label,
  value,
  hint,
  icon
}: {
  label: string;
  value: string;
  hint: string;
  icon: ReactNode;
}) {
  return (
    <div className={`${cardClass} p-5`}>
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">{label}</div>
        {icon}
      </div>
      <div className="text-2xl font-bold text-slate-900 mt-2 tabular-nums">{value}</div>
      <p className="text-xs text-slate-500 mt-1">{hint}</p>
    </div>
  );
}

function CurrentBillCard({
  bill,
  data,
  onOpenBill,
  onPay
}: {
  bill: Bill;
  data: RenterData;
  onOpenBill: (billId: string) => void;
  onPay: (billId: string) => void;
}) {
  const unpaid = bill.status === "issued";
  const pending = bill.status === "payment_pending_verification";

  if (pending) {
    return (
      <section className={`${cardClass} p-6 sm:p-7`}>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 text-[11px] font-semibold border border-indigo-100">
            <Clock className="w-3.5 h-3.5" />
            Payment pending verification
          </span>
          <span className="text-[11px] text-slate-400">Bill {shortId(bill.billId)}</span>
        </div>
        <h2 className="text-lg font-bold text-slate-900 mt-3">We received your payment details</h2>
        <p className="text-xs text-slate-500 mt-1">
          Your landlord is checking transaction{" "}
          <span className="font-mono font-semibold text-slate-700">
            {bill.paymentDetails?.transactionId ?? "—"}
          </span>
          .
        </p>
        <div className="mt-5 flex items-end justify-between gap-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Amount submitted
            </div>
            <div className="text-3xl font-bold text-slate-900 tabular-nums mt-0.5">
              {npr(amountDue(bill))}
            </div>
          </div>
          <button
            onClick={() => onOpenBill(bill.billId)}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition-colors"
          >
            View bill
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </section>
    );
  }

  if (!unpaid) {
    return (
      <section className={`${cardClass} p-6 sm:p-7`}>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-semibold border border-emerald-100">
            <CheckCircle2 className="w-3.5 h-3.5" />
            All paid up
          </span>
          <span className="text-[11px] text-slate-400">Latest bill {shortId(bill.billId)}</span>
        </div>
        <h2 className="text-lg font-bold text-slate-900 mt-3">No amount due</h2>
        <p className="text-xs text-slate-500 mt-1">{period(bill.periodStart, bill.periodEnd)}</p>
        <div className="mt-5 flex items-end justify-between gap-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Last paid
            </div>
            <div className="text-3xl font-bold text-slate-900 tabular-nums mt-0.5">
              {npr(amountDue(bill))}
            </div>
          </div>
          <button
            onClick={() => onOpenBill(bill.billId)}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition-colors"
          >
            View bill
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="relative overflow-hidden rounded-2xl bg-slate-900 p-6 sm:p-7 text-white">
      <div className="pointer-events-none absolute -right-16 -top-16 w-56 h-56 rounded-full bg-blue-500/25 blur-3xl" />
      <div className="relative">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-blue-200">
            <Zap className="w-3.5 h-3.5" />
            Current bill
          </span>
          <span className="px-2.5 py-0.5 rounded-full bg-amber-400/15 text-amber-200 border border-amber-300/30 text-[11px] font-semibold">
            Payment due
          </span>
        </div>

        <div className="text-4xl sm:text-5xl font-bold tabular-nums tracking-tight mt-4">
          {npr(amountDue(bill))}
        </div>
        <p className="text-xs text-slate-300 mt-2">
          {period(bill.periodStart, bill.periodEnd)}
        </p>

        <div className="mt-5 flex flex-wrap gap-4 text-xs text-slate-300">
          <span className="inline-flex items-center gap-1.5">
            <Receipt className="w-3.5 h-3.5 text-blue-300" />
            {kwh(bill.consumptionKwh)} used
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Gauge className="w-3.5 h-3.5 text-blue-300" />
            {npr(bill.rateNprPerKwh)} / kWh
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Home className="w-3.5 h-3.5 text-blue-300" />
            Room {data.room?.name}
          </span>
        </div>

        <div className="mt-6 flex flex-col sm:flex-row gap-2.5">
          <button
            onClick={() => onOpenBill(bill.billId)}
            className="cm-on-dark inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-white hover:bg-slate-100 text-slate-900 rounded-lg text-xs font-bold transition-colors"
          >
            <Receipt className="w-4 h-4" />
            View bill & pay
          </button>
        </div>
      </div>
    </section>
  );
}

function RoomCard({ data }: { data: RenterData }) {
  const rows: Array<[string, string]> = [
    ["Property", data.property?.name ?? "—"],
    ["Room", data.room?.name ?? "—"],
    ["Floor", data.room?.floor || "—"],
    ["Unit type", data.room?.unitType || "—"],
    ["Current rate", data.currentRate !== undefined ? `${npr(data.currentRate)} / kWh` : "—"]
  ];

  return (
    <section className={`${cardClass} p-5 sm:p-6`}>
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
          <Home className="w-4 h-4" />
        </div>
        <h2 className="text-sm font-bold text-slate-900">Your room</h2>
      </div>
      {data.property?.address && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-500 leading-relaxed">
          <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-px" />
          {data.property.address}
        </p>
      )}
      <dl className="mt-4 space-y-2.5 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-4">
            <dt className="text-slate-500">{label}</dt>
            <dd className="font-semibold text-slate-900 text-right">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function MeterCard({ data }: { data: RenterData }) {
  const hasReading = data.totalUnits !== undefined;

  return (
    <section className={`${cardClass} p-5 sm:p-6`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
            <Gauge className="w-4 h-4" />
          </div>
          <h2 className="text-sm font-bold text-slate-900">Live meter</h2>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              !data.meter ? "bg-slate-400" : data.meter.status === "active" ? "bg-emerald-500" : "bg-amber-500"
            }`}
          />
          {!data.meter ? "No meter" : data.meter.status === "active" ? "Active" : "Suspended"}
        </span>
      </div>

      {hasReading ? (
        <>
          <div className="mt-4 text-2xl font-bold text-slate-900 tabular-nums">
            {kwh(data.totalUnits)}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {data.unitsSinceLastBill !== undefined
              ? `${kwh(data.unitsSinceLastBill)} since your last bill`
              : "Total on your meter"}
          </p>
          <p className="mt-3 pt-3 border-t border-slate-100 text-[11px] text-slate-400">
            Last reading {dateTime(data.latestReading?.payload?.timestamp)}
          </p>
        </>
      ) : (
        <p className="mt-4 text-xs text-slate-500 leading-relaxed">
          No meter reading yet. Your live usage appears here once the meter sends its first reading.
        </p>
      )}
    </section>
  );
}

export function HomeView({
  user,
  data,
  onOpenBill,
  onOpenBills,
  onPay
}: {
  user: User;
  data: RenterData;
  onOpenBill: (billId: string) => void;
  onOpenBills: () => void;
  onPay: (billId: string) => void;
}) {
  const current = data.unpaid[0] ?? data.latestBill;
  const recent = data.bills.slice(0, 4);
  const openIssue = (billId: string) =>
    data.disputes.some(
      (dispute) => dispute.status === "open" && disputeBillId(dispute) === billId
    );

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs font-semibold text-blue-600 tracking-wider uppercase mb-1">
          Room {data.room?.name}
          {data.room?.floor ? ` · ${data.room.floor}` : ""}
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
          Hello, {firstName(user.name)}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {data.unpaid.length > 0
            ? `You have ${npr(data.due)} to pay across ${data.unpaid.length} bill${data.unpaid.length === 1 ? "" : "s"}.`
            : "You are all caught up. Here is your latest bill and meter."}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-6 items-start">
        {current ? (
          <CurrentBillCard bill={current} data={data} onOpenBill={onOpenBill} onPay={onPay} />
        ) : (
          <section className={`${cardClass} p-8 text-center`}>
            <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto">
              <Receipt className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 mt-4">No bills yet</h2>
            <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto leading-relaxed">
              Your landlord has not sent a bill for Room {data.room?.name} yet. When one is sent, it
              will show up here.
            </p>
          </section>
        )}
        <RoomCard data={data} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat
          label="Amount due"
          value={npr(data.due)}
          hint={data.unpaid.length === 0 ? "Nothing to pay." : `${data.unpaid.length} unpaid bill${data.unpaid.length === 1 ? "" : "s"}.`}
          icon={<Wallet className="w-4 h-4 text-amber-500" />}
        />
        <Stat
          label="Already paid"
          value={npr(data.paidTotal)}
          hint={`${data.paid.length} settled bill${data.paid.length === 1 ? "" : "s"}.`}
          icon={<CheckCircle2 className="w-4 h-4 text-emerald-600" />}
        />
        <Stat
          label="Bills received"
          value={String(data.bills.length)}
          hint={data.latestBill ? `Latest ${dateOnly(data.latestBill.periodEnd)}` : "No bills yet."}
          icon={<Receipt className="w-4 h-4 text-blue-600" />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-6 items-start">
        <section className={`${cardClass} overflow-hidden`}>
          <div className="p-5 pb-4 flex items-center justify-between gap-3 border-b border-slate-100">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Recent bills</h2>
              <p className="text-xs text-slate-500 mt-0.5">Newest first.</p>
            </div>
            {data.bills.length > recent.length && (
              <button
                onClick={onOpenBills}
                className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700"
              >
                View all
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {recent.length === 0 ? (
            <p className="p-5 text-xs text-slate-500">No bills sent yet.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {recent.map((bill) => (
                <button
                  key={bill.billId}
                  onClick={() => onOpenBill(bill.billId)}
                  className="w-full text-left px-5 py-4 flex items-center justify-between gap-4 hover:bg-slate-100 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-slate-900">
                        {shortId(bill.billId)}
                      </span>
                      <BillStatusBadge status={badgeStatus(bill.status)} />
                      {openIssue(bill.billId) && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700">
                          <MessageSquare className="w-3 h-3" />
                          Issue open
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1 truncate">
                      {period(bill.periodStart, bill.periodEnd)} · {kwh(bill.consumptionKwh)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-bold text-slate-900 tabular-nums">
                      {npr(amountDue(bill))}
                    </span>
                    <ChevronRight className="w-4 h-4 text-slate-300" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <MeterCard data={data} />
      </div>
    </div>
  );
}
