/**
 * Presentation models used by the ChargeMesh workspace screens.
 *
 * These mirror the original studio UI exactly. The API exposes a richer,
 * ledger-oriented shape, so `adapter.ts` maps API records onto these types.
 * Keep UI components dependent on this file only.
 */

import type { BillPaymentDetails, UserWallet } from "@chargemesh/shared";

export interface Room {
  id: string;
  unitNumber: string;
  floor: string;
  type: string;
  renterName?: string;
  renterEmail?: string;
  meterId: string;
  meterStatus: 'Working' | 'Standby' | 'Offline';
  startReading: number;
  currentReading: number;
  /** Raw backend identifiers, used for real actions from the UI. */
  propertyId?: string;
  rawMeterId?: string;
  activeTenancyId?: string;
  rate?: number;
}

export interface Bill {
  id: string;
  billNumber: string; // e.g. "#102"
  roomUnit: string;
  roomFloor: string;
  renterName: string;
  renterEmail?: string;
  billingMonth: string; // e.g. "Oct 15 to Nov 15, 2024"
  billDate: string; // e.g. "Nov 15, 2024"
  startReading: number;
  endReading: number;
  electricityUsed: number;
  ratePerUnit: number;
  totalAmountNpr: number;
  status: 'Draft' | 'Sent' | 'Paid' | 'Pending verification';
  isVerified?: boolean;
  /** Courtesy credit granted after a tenant question was upheld. */
  appliedCreditNpr?: number;
  /** Wallet QR fields captured by the renter when they settled online. */
  paymentScheme?: string;
  paymentReference?: string;
  paymentCapturedAt?: string;
  /** Raw backend identifiers, used for real actions from the UI. */
  roomId?: string;
  rawMeterId?: string;
  landlordPaymentQr?: {
    dataUrl: string;
    mimeType?: string;
    filename?: string;
    note?: string;
  } | null;
  /** Landlord receive wallets snapshot attached when the bill was issued. */
  receiveWallets?: UserWallet[] | null;
  /** Transaction reference submitted by the renter and awaiting verification. */
  paymentDetails?: BillPaymentDetails | null;
}

export interface TenantDispute {
  id: string;
  roomUnit: string;
  renterName: string;
  /** Present when the question was raised against a specific bill. */
  billId?: string;
  renterEmail?: string;
  billRef: string; // "Nov 15 Bill"
  totalAmount: number; // 3450
  subMeterId: string; // "Sub-meter #M-204-B"
  status: 'Needs Review' | 'Resolved';
  receivedTime: string; // "Received Yesterday, 4:15 PM"
  questionText: string;
  period: string; // "Oct 20 – Oct 25"
  observedLoad: string; // "0.70 kW continuous"
  observedProfile: string; // "Flatline 24/7 baseline profile"
  switchActivity: string; // "0 spikes detected"
  switchDetails: string; // "Zero indoor lights turned on"
  circuitHealth: string; // "Clean Read"
  circuitDetails: string; // "No leaks or crossed wiring detected"
  diagnosisSummary: string;
  selectedResolution: 'bill_correct' | 'courtesy_discount';
  messageText: string;
  attachedFile: string;
  appliedDiscountNpr?: number;
}

export interface ResolvedInquiry {
  id: string;
  renterName: string;
  roomUnit: string;
  billDate: string;
  quote: string;
  resolutionTag: string;
  closedDate: string;
  amountFormatted: string;
  notes?: string;
}

export interface PropertySettings {
  propertyName: string;
  address: string;
  landlordName: string;
  landlordRole: string;
  electricityRateNpr: number;
  billingCycle: string;
  currencySymbol: string;
}
