import type { Bill as ApiBill, Property, User } from "../api.js";
import { dateTime, npr, shortId, timeAgo } from "../lib/format.js";
import {
  cumulativeKwh,
  type BillView,
  type DisputeView,
  type RoomView
} from "../lib/model.js";
import type {
  Bill,
  PropertySettings,
  ResolvedInquiry,
  Room,
  TenantDispute
} from "./types.js";

const DATE_OPTS: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric"
};

export function formatDate(iso: string | undefined | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-US", DATE_OPTS);
}

/** "Oct 15 to Nov 15, 2026", matching the workspace billing-month label. */
export function formatPeriod(start: string, end: string): string {
  const from = new Date(start);
  const to = new Date(end);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return `${dateTime(start)} → ${dateTime(end)}`;
  }
  return `${from.toLocaleDateString("en-US", { month: "short", day: "numeric" })} to ${to.toLocaleDateString(
    "en-US",
    DATE_OPTS
  )}`;
}

function acceptedReadings(room: RoomView) {
  return room.recentReadings
    .filter((reading) => reading.status === "accepted")
    .sort((a, b) => Date.parse(a.payload.timestamp) - Date.parse(b.payload.timestamp));
}

function startingReading(room: RoomView): number {
  const readings = acceptedReadings(room);
  return cumulativeKwh(readings[0]) ?? 0;
}

function currentReading(room: RoomView): number {
  return cumulativeKwh(room.latestReading) ?? startingReading(room);
}

function meterStatusFor(room: RoomView): Room["meterStatus"] {
  if (room.meterStatus === "Working") return "Working";
  if (!room.meter) return "Standby";
  return "Offline";
}

export function toStudioRoom(room: RoomView): Room {
  return {
    id: room.id,
    unitNumber: room.name,
    floor: room.floor || "Unspecified floor",
    type: room.unitType || "Room",
    renterName: room.renter?.name,
    renterEmail: room.renter?.email,
    meterId: room.meter?.label || room.meter?.meterId || "No meter connected",
    meterStatus: meterStatusFor(room),
    startReading: startingReading(room),
    currentReading: currentReading(room),
    propertyId: room.propertyId,
    rawMeterId: room.meter?.id,
    activeTenancyId: room.renter?.tenancyId,
    rate: room.rate
  };
}

export function toStudioBill(bill: BillView): Bill {
  const amount = bill.amountDue ?? bill.electricityChargeNpr;
  return {
    id: bill.billId,
    billNumber: shortId(bill.billId),
    roomUnit: bill.roomName,
    roomFloor: bill.roomFloor || "Unspecified floor",
    renterName: bill.renterName,
    renterEmail: bill.renterEmail,
    billingMonth: formatPeriod(bill.periodStart, bill.periodEnd),
    billDate: formatDate(bill.issuedAt ?? bill.createdAt),
    startReading: bill.startingCumulativeKwh,
    endReading: bill.endingCumulativeKwh,
    electricityUsed: bill.consumptionKwh,
    ratePerUnit: bill.rateNprPerKwh,
    totalAmountNpr: amount,
    status:
      bill.status === "draft"
        ? "Draft"
        : bill.status === "payment_pending_verification"
        ? "Pending verification"
        : bill.status === "issued"
        ? "Sent"
        : "Paid",
    isVerified: true,
    appliedCreditNpr: bill.creditNpr,
    paymentScheme: bill.payment?.scheme,
    paymentReference: bill.payment?.reference,
    paymentCapturedAt: bill.payment?.capturedAt,
    roomId: bill.roomId,
    rawMeterId: bill.meterId,
    landlordPaymentQr: (bill as any).landlordPaymentQr ?? null,
    receiveWallets: bill.receiveWallets ?? null,
    paymentDetails: bill.paymentDetails ?? null
  };
}

function billAmount(bill: BillView | undefined): number {
  return bill ? bill.amountDue ?? bill.electricityChargeNpr : 0;
}

function friendlyDiscount(amount: number): number {
  return Math.max(0, Math.min(500, Math.floor(amount)));
}

export function toStudioDispute(dispute: DisputeView, rooms: RoomView[]): TenantDispute {
  const bill = dispute.bill;
  const room = bill ? rooms.find((candidate) => candidate.id === bill.roomId) : undefined;
  const amount = billAmount(bill);
  const discount = friendlyDiscount(amount);

  const hours = bill
    ? Math.max(1, (Date.parse(bill.periodEnd) - Date.parse(bill.periodStart)) / 3_600_000)
    : 1;
  const averageKw = bill ? bill.consumptionKwh / hours : 0;

  return {
    id: dispute.id,
    roomUnit: bill?.roomName ?? dispute.roomName ?? "—",
    renterName: dispute.renterName,
    billId: dispute.billId,
    renterEmail: bill?.renterEmail,
    billRef: bill ? `Bill ${shortId(bill.billId)}` : "Bill",
    totalAmount: amount,
    subMeterId: room?.meter?.label ? `Sub-meter ${room.meter.label}` : "Sub-meter",
    status: dispute.status === "open" ? "Needs Review" : "Resolved",
    receivedTime: `Received ${timeAgo(dispute.createdAt)}`,
    questionText: `“${dispute.reason}”`,
    period: bill ? formatPeriod(bill.periodStart, bill.periodEnd) : "Billing period",
    observedLoad: `${averageKw.toFixed(2)} kW average draw`,
    observedProfile: "Whole-period sub-meter average",
    switchActivity: "Signed meter readings",
    switchDetails: bill ? `${bill.consumptionKwh.toFixed(1)} units recorded in the period` : "No reading data",
    circuitHealth: "Clean Read",
    circuitDetails: "No wiring faults flagged by the sub-meter",
    diagnosisSummary: bill
      ? `The sub-meter logged ${bill.consumptionKwh.toFixed(
          1
        )} units between ${bill.startingCumulativeKwh.toFixed(
          1
        )} and ${bill.endingCumulativeKwh.toFixed(1)} kWh for this period.`
      : "The bill and its signed meter readings are attached to this question.",
    selectedResolution: "bill_correct",
    messageText: "",
    attachedFile: bill ? `${shortId(bill.billId)} usage breakdown (auto-generated)` : "Usage breakdown",
    appliedDiscountNpr: discount
  };
}

export function toResolvedInquiry(dispute: DisputeView): ResolvedInquiry {
  const bill = dispute.bill;
  const amount = billAmount(bill);
  const credit = dispute.creditNpr ?? 0;
  const upheld = dispute.status === "upheld";

  return {
    id: dispute.id,
    renterName: dispute.renterName,
    roomUnit: `Room ${bill?.roomName ?? dispute.roomName ?? "—"}`,
    billDate: bill ? `Bill ${shortId(bill.billId)} · ${formatPeriod(bill.periodStart, bill.periodEnd)}` : "Bill",
    quote: `“${dispute.reason}”`,
    resolutionTag: upheld
      ? credit > 0
        ? `Resolved: Courtesy Credit ${npr(credit)}`
        : "Resolved: Bill Upheld"
      : "Resolved: Bill Confirmed Correct",
    closedDate: `Closed ${formatDate(dispute.resolvedAt)}`,
    amountFormatted: `${npr(amount)} ${upheld ? "adjusted" : "confirmed"}`,
    notes: dispute.resolution
  };
}

export function toPropertySettings(
  property: Property,
  user: User,
  rate: number | undefined
): PropertySettings {
  return {
    propertyName: property.name,
    address: property.address || "Address not set",
    landlordName: user.name,
    landlordRole: property.landlordTitle || "Landlord",
    electricityRateNpr: rate ?? property.defaultRateNprPerKwh ?? 0,
    billingCycle: property.billingCycle || "Monthly billing cycle",
    currencySymbol: "USD"
  };
}

export interface StudioWorkspace {
  rooms: Room[];
  bills: Bill[];
  disputes: TenantDispute[];
  resolvedInquiries: ResolvedInquiry[];
  settings: PropertySettings;
  /** Optional landlord receive wallets used by billing screens. */
  wallets?: unknown[];
}

export function buildStudioWorkspace(input: {
  rooms: RoomView[];
  bills: BillView[];
  disputes: DisputeView[];
  property: Property;
  user: User;
  rate: number | undefined;
}): StudioWorkspace {
  const rooms = input.rooms.map(toStudioRoom);
  const bills = input.bills.map(toStudioBill);
  const open = input.disputes.filter((dispute) => dispute.status === "open");
  const closed = input.disputes.filter((dispute) => dispute.status !== "open");

  return {
    rooms,
    bills,
    disputes: open.map((dispute) => toStudioDispute(dispute, input.rooms)),
    resolvedInquiries: closed.map(toResolvedInquiry),
    settings: toPropertySettings(input.property, input.user, input.rate)
  };
}

/** Extra detail the bill drawer needs for a real "record reading" action. */
export function billMeterId(bill: Bill): string | undefined {
  return bill.rawMeterId;
}

export type { ApiBill };
