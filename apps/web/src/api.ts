import type {
  Bill,
  BillPaymentDetails,
  CreReport,
  Dispute,
  Meter,
  Property,
  Reading,
  RenterOverview,
  Room,
  RoomOverview,
  Tariff,
  Tenancy,
  User,
  UserWallet
} from "@chargemesh/shared";

export type {
  Bill,
  BillPaymentDetails,
  CreReport,
  Dispute,
  Meter,
  Property,
  Reading,
  RenterOverview,
  Room,
  RoomOverview,
  Tariff,
  Tenancy,
  User,
  UserWallet
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

// Empty by default: dev uses the Vite proxy and production can serve the API same-origin.
const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: "include" });
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    const error = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    const issues = Array.isArray(error?.details)
      ? (error.details as Array<{ path?: unknown[]; message?: string }>)
          .map((issue) => `${issue.path?.join(".") || "input"}: ${issue.message}`)
          .join("; ")
      : "";
    const message = [error?.message || response.statusText || "Request failed", issues].filter(Boolean).join(" — ");
    throw new ApiError(response.status, error?.code ?? "request_failed", message);
  }
  return data as T;
}

const post = <T>(path: string, body: unknown = {}) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body) });
const patch = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "PATCH", body: JSON.stringify(body) });

export interface TenancyWithRenter extends Tenancy {
  renter: { id: string; name: string; email: string } | null;
}

export interface ServerStatus {
  integrations: {
    hedera: { mode: "disabled" | "configured"; network: string; topicId?: string; mirrorNodeUrl: string };
  };
  storage: { mode: string; persists: boolean };
}

export const api = {
  // auth
  me: () => request<{ user: User }>("/api/auth/me"),
  login: (email: string, password: string) =>
    post<{ user: User }>("/api/auth/login", { email, password }),
  register: (input: { name: string; email: string; password: string; role: "landlord" | "renter" }) =>
    post<{ user: User }>("/api/auth/register", input),
  logout: () => post<{ ok: boolean }>("/api/auth/logout"),
  updateMyName: (name: string) => patch<{ user: User }>("/api/auth/me", { name }),

  // renter portal
  renterOverview: () => request<RenterOverview>("/api/renter/overview"),

  // properties & rooms
  properties: () => request<{ properties: Property[] }>("/api/properties"),
  createProperty: (input: { name: string; address?: string; defaultRateNprPerKwh?: number; billingCycle?: string }) =>
    post<{ property: Property }>("/api/properties", input),
  updateProperty: (
    propertyId: string,
    input: { name?: string; address?: string; defaultRateNprPerKwh?: number; billingCycle?: string; landlordTitle?: string }
  ) => patch<{ property: Property }>(`/api/properties/${propertyId}`, input),
  rooms: () => request<{ rooms: RoomOverview[] }>("/api/rooms"),
  createRoom: (input: { propertyId: string; name: string; floor?: string; unitType?: string }) =>
    post<{ room: Room }>("/api/rooms", input),
  createMeter: (roomId: string, label?: string) =>
    post<{ meter: Meter }>(`/api/rooms/${roomId}/meters`, label ? { label } : {}),
  roomTenancies: (roomId: string) =>
    request<{ tenancies: TenancyWithRenter[] }>(`/api/rooms/${roomId}/tenancies`),
  assignRenter: (roomId: string, email: string) =>
    post<{ tenancy: Tenancy }>(`/api/rooms/${roomId}/tenancies`, { email }),
  endTenancy: (tenancyId: string) => post<{ tenancy: Tenancy }>(`/api/tenancies/${tenancyId}/end`),

  // readings & meters
  readings: (roomId: string, limit = 500) =>
    request<{ readings: Reading[] }>(`/api/readings?roomId=${encodeURIComponent(roomId)}&limit=${limit}`),

  // tariffs
  tariffs: () => request<{ tariffs: Tariff[] }>("/api/tariffs"),
  createTariff: (roomId: string, nprPerKwh: number) =>
    post<{ tariff: Tariff }>("/api/tariffs", { roomId, nprPerKwh }),

  // bills
  bills: () => request<{ bills: Bill[] }>("/api/bills"),
  billSuggestion: (roomId: string) =>
    request<{ periodStart: string; periodEnd: string }>(`/api/rooms/${roomId}/bill-suggestion`),
  previewBill: (input: { roomId: string; periodStart: string; periodEnd: string }) =>
    post<{ bill: Bill }>("/api/bills/preview", input),
  createBill: (input: { roomId: string; periodStart: string; periodEnd: string; landlordPaymentQr?: any }) =>
    post<{ bill: Bill }>("/api/bills", input),
  issueBill: (billId: string) => post<{ bill: Bill }>(`/api/bills/${billId}/issue`),
  markBillPaid: (billId: string) => post<{ bill: Bill }>(`/api/bills/${billId}/mark-paid`),
  payBill: (billId: string, payment?: { payload: string }) =>
    post<{ bill: Bill }>(`/api/bills/${billId}/pay`, payment ? { payment } : {}),
  submitBillPayment: (
    billId: string,
    input: {
      method?: string;
      transactionId: string;
      reference?: string;
      paidFromWalletId?: string;
      note?: string;
      slipDataUrl?: string;
    }
  ) => post<{ bill: Bill }>(`/api/bills/${billId}/submit-payment`, input),
  verifyBillPayment: (billId: string, input: { transactionId?: string; note?: string } = {}) =>
    post<{ bill: Bill }>(`/api/bills/${billId}/verify-payment`, input),
  deleteBill: (billId: string) => request<{ ok: boolean }>(`/api/bills/${billId}`, { method: "DELETE" }),

  // receive wallets (landlord payment details)
  wallets: () => request<{ wallets: UserWallet[] }>("/api/wallets"),
  createWallet: (input: {
    type: UserWallet["type"];
    label: string;
    accountId?: string;
    qrDataUrl?: string;
    qrPayload?: string;
    publicKey?: string;
    network?: "testnet" | "mainnet";
    pairingData?: Record<string, unknown> | null;
    isDefault?: boolean;
  }) => post<{ wallet: UserWallet }>("/api/wallets", input),
  updateWallet: (
    walletId: string,
    input: Partial<{
      type: UserWallet["type"];
      label: string;
      accountId: string;
      qrDataUrl: string;
      qrPayload: string;
      publicKey: string;
      network: "testnet" | "mainnet";
      pairingData: Record<string, unknown> | null;
      isDefault: boolean;
      isActive: boolean;
    }>
  ) => patch<{ wallet: UserWallet }>(`/api/wallets/${walletId}`, input),
  deleteWallet: (walletId: string) =>
    request<{ ok: boolean }>(`/api/wallets/${walletId}`, { method: "DELETE" }),

  // disputes
  disputes: () => request<{ disputes: Dispute[] }>("/api/disputes"),
  openDispute: (billId: string, reason: string) => post<{ dispute: Dispute }>("/api/disputes", { billId, reason }),
  resolveDispute: (
    disputeId: string,
    input: { status: "upheld" | "rejected"; resolution: string; creditNpr?: number }
  ) => post<{ dispute: Dispute }>(`/api/disputes/${disputeId}/resolve`, input),

  // verification
  status: () => request<ServerStatus>("/api/status"),
  verifyAudit: () => request<{ valid: boolean; count: number; headHash?: string; brokenAt?: number }>("/api/audit/verify"),
  creReports: () => request<{ reports: CreReport[] }>("/api/cre/reports")
};
