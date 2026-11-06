export type IsoTimestamp = string;

export interface Property {
  id: string;
  name: string;
  address?: string;
  description?: string;
  ownerId?: string;
  /** Rate applied to newly added rooms; existing rooms keep their own tariffs. */
  defaultRateNprPerKwh?: number;
  billingCycle?: string;
  landlordTitle?: string;
  createdAt: IsoTimestamp;
  updatedAt?: IsoTimestamp;
}

export interface Room {
  id: string;
  propertyId?: string;
  name: string;
  description: string;
  ensName?: string;
  floor?: string;
  unitType?: string;
  createdAt: IsoTimestamp;
  updatedAt?: IsoTimestamp;
}

export interface Tariff {
  id: string;
  tariffId?: string;
  roomId?: string;
  scope?: string;
  nprPerKwh: number;
  rateNprPerKwh?: number;
  effectiveFrom: IsoTimestamp;
  effectiveTo?: IsoTimestamp | null;
  createdAt?: IsoTimestamp;
  configuredBy?: string;
}

export interface Meter {
  id: string;
  meterId?: string;
  roomId: string;
  label?: string;
  publicKeyPem: string;
  publicKey?: string;
  deviceType?: string;
  status: "active" | "suspended";
  maxPowerW?: number;
  staleAfterMs?: number;
  createdAt: IsoTimestamp;
  lastSeenAt?: IsoTimestamp;
  lastSequenceSeen?: number;
  lastAcceptedSequence?: number;
  lastAcceptedAt?: IsoTimestamp;
  lastAcceptedEnergyKwh?: number;
}

export interface SignedReadingPayload {
  meterId: string;
  roomId?: string;
  sequence: number;
  timestamp: IsoTimestamp;
  cumulativeEnergyKwh: number;
  powerW?: number;
  voltage?: number;
  current?: number;
  nonce?: string;
  deviceType?: string;
  simulated?: boolean;
}

/** Older firmware releases used `cumulativeKwh` instead of `cumulativeEnergyKwh`. */
export interface LegacySignedReadingPayload {
  meterId: string;
  roomId?: string;
  sequence: number;
  timestamp: IsoTimestamp;
  cumulativeKwh: number;
  powerW?: number;
  voltage?: number;
  current?: number;
  nonce?: string;
  deviceType?: string;
  simulated?: boolean;
}

export type RawSignedReadingPayload = SignedReadingPayload | LegacySignedReadingPayload;

export type ReadingSubmission = RawSignedReadingPayload & { signature: string };

export type ReadingFlag =
  | "unregistered_meter"
  | "room_mismatch"
  | "signature_invalid"
  | "future_timestamp"
  | "stale_timestamp"
  | "duplicate_reading"
  | "replayed_sequence"
  | "out_of_order_timestamp"
  | "meter_reset"
  | "suspicious_power"
  | "suspicious_energy_jump";

export type ReadingStatus = "accepted" | "rejected" | "quarantined";

export interface Reading {
  id: string;
  readingId?: string;
  payloadHash: string;
  meterId: string;
  roomId?: string;
  payload: SignedReadingPayload;
  signedPayload: RawSignedReadingPayload;
  signature: string;
  status: ReadingStatus;
  flags: ReadingFlag[];
  reasons: string[];
  receivedAt: IsoTimestamp;
  source: "meter";
  sessionId?: string;
}

export interface SessionSettlement {
  provider: "hts";
  tokenId: string;
  payerAccountId: string;
  treasuryAccountId: string;
  amountTokenUnits: string;
  transactionId: string;
  settledAt: IsoTimestamp;
}

/** A wallet QR the renter scanned with the in-app camera when settling a bill. */
export interface WalletPayment {
  method: "wallet_qr";
  /** Raw text decoded from the renter's wallet QR, stored with the bill. */
  payload: string;
  /** Stable SHA-256 fingerprint of the payload, safe to show in lists and audit logs. */
  reference: string;
  /** URI scheme of the QR payload when it has one (for example "fonepay" or "esewa"). */
  scheme?: string;
  capturedAt: IsoTimestamp;
}

export interface LandlordPaymentQr {
  dataUrl: string;
  mimeType?: string;
  filename?: string;
  note?: string;
}

export type WalletType = "esewa" | "fonepay" | "khalti" | "bank" | "hashpack" | "hedera" | "other";

export interface UserWallet {
  id: string;
  userId: string;
  type: WalletType;
  label: string;
  accountId?: string;
  qrPayload?: string;
  qrDataUrl?: string;
  publicKey?: string;
  network?: "testnet" | "mainnet";
  pairingData?: Record<string, unknown> | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BillPaymentDetails {
  method?: string;
  reference?: string;
  transactionId?: string;
  paidFromWalletId?: string;
  paidFromLabel?: string;
  paidFromAccountId?: string;
  note?: string;
  submittedAt?: string;
  verifiedAt?: string;
  verifiedBy?: string;
  slipDataUrl?: string;
}

export interface Bill {
  billId: string;
  id?: string;
  roomId: string;
  meterId?: string;
  periodStart: IsoTimestamp;
  periodEnd: IsoTimestamp;
  startingReadingId: string;
  endingReadingId: string;
  startingCumulativeKwh: number;
  endingCumulativeKwh: number;
  consumptionKwh: number;
  tariffId: string;
  rateNprPerKwh: number;
  electricityChargeNpr: number;
  status: "draft" | "issued" | "paid" | "payment_pending_verification";
  createdAt: IsoTimestamp;
  issuedAt?: IsoTimestamp;
  paidAt?: IsoTimestamp;
  /** Courtesy credit granted when a dispute was resolved; the meter-derived charge is unchanged. */
  creditNpr?: number;
  /** electricityChargeNpr minus creditNpr. Absent when no credit was granted. */
  amountDueNpr?: number;
  currency?: string;
  roundingRule?: string;
  precision?: Record<string, unknown>;
  /** Populated when the renter settled the bill by scanning their wallet QR. */
  payment?: WalletPayment;
  /** Landlord's payment QR to show on the bill for the renter to pay. */
  landlordPaymentQr?: LandlordPaymentQr | null;
  /** Landlord's receive wallets snapshot attached to bill on issue */
  receiveWallets?: UserWallet[] | null;
  /** Payment details submitted by renter for verification */
  paymentDetails?: BillPaymentDetails | null;
}

export interface Session {
  id: string;
  roomId: string;
  meterId: string;
  tariffId: string;
  tariffNprPerKwh: number;
  startTime: IsoTimestamp;
  endTime?: IsoTimestamp;
  startEnergyKwh: number;
  endEnergyKwh?: number;
  energyKwh?: number;
  amountNpr?: number;
  status: "active" | "closed" | "disputed";
  createdAt: IsoTimestamp;
  closedAt?: IsoTimestamp;
  settlement?: SessionSettlement;
}

export interface Dispute {
  id: string;
  sessionId: string;
  billId?: string;
  reason: string;
  openedBy: string;
  status: "open" | "upheld" | "rejected";
  createdAt: IsoTimestamp;
  resolvedAt?: IsoTimestamp;
  resolution?: string;
  resolvedBy?: string;
  creditNpr?: number;
}

export interface HederaAuditReference {
  network: string;
  topicId: string;
  sequenceNumber: string;
  transactionId: string;
  consensusTimestamp?: string;
  mirrorNodeUrl: string;
}

export interface AuditEvent {
  id: string;
  seq: number;
  type: string;
  at: IsoTimestamp;
  actor: string;
  payload: Record<string, unknown>;
  prevHash: string;
  hash: string;
  hederaStatus?: "disabled" | "pending" | "submitted" | "failed";
  hederaError?: string;
  hedera?: HederaAuditReference;
}

export interface EvidenceReading {
  id: string;
  sequence: number;
  timestamp: IsoTimestamp;
  cumulativeEnergyKwh: number;
  powerW?: number;
  status: ReadingStatus;
  flags: ReadingFlag[];
}

export interface SessionEvidence {
  sessionId: string;
  roomId: string;
  meterId: string;
  status: Session["status"];
  tariffNprPerKwh: number;
  startEnergyKwh: number;
  endEnergyKwh: number;
  energyKwh: number;
  amountNpr: number;
  readingCount: number;
  acceptedCount: number;
  rejectedCount: number;
  quarantinedCount: number;
  flags: ReadingFlag[];
  readings: EvidenceReading[];
  auditEventIds: string[];
  auditChainValid: boolean;
}

export interface EvidenceBundle {
  generatedAt: IsoTimestamp;
  evidenceHash: string;
  readingEvidenceHash: string;
  audit: {
    eventCount: number;
    headHash: string;
    chainValid: boolean;
  };
  sessions: SessionEvidence[];
}

export interface CreReadingEvidence {
  id: string;
  payloadHash: string;
  meterId: string;
  roomId?: string;
  sessionId?: string;
  signedPayload: RawSignedReadingPayload;
  signature: string;
  publicKeyPem: string;
  status: ReadingStatus;
  flags: ReadingFlag[];
  reasons: string[];
  maxPowerW: number;
  energyJumpTolerance: number;
  receivedAt: IsoTimestamp;
  auditEvents: AuditEvent[];
}

export interface CreReadingEvidenceBundle {
  generatedAt: IsoTimestamp;
  evidenceHash: string;
  readings: CreReadingEvidence[];
}

export type AttestationSeverity = "error" | "warning";

export interface AttestationFinding {
  code: string;
  severity: AttestationSeverity;
  message: string;
  sessionId?: string;
}

export interface AttestationResult {
  status: "verified" | "flagged" | "review";
  findings: AttestationFinding[];
}

export interface CreReport {
  reportId: string;
  generatedAt: IsoTimestamp;
  source: "cre-workflow" | "local-fallback";
  status: AttestationResult["status"];
  findings: AttestationFinding[];
  sessionIds: string[];
  evidenceHash: string;
  receivedAt: IsoTimestamp;
  evm?: {
    status: "pending" | "submitted" | "failed";
    chainSelectorName: string;
    contractAddress: string;
    transactionHash?: string;
    explorerUrl?: string;
    error?: string;
    updatedAt: IsoTimestamp;
  };
  auditEventId?: string;
  hedera?: HederaAuditReference;
}

export interface SessionDetail {
  session: Session;
  room: Room;
  meter: Meter;
  readings: Reading[];
  disputes: Dispute[];
  auditEvents: AuditEvent[];
}

export interface DashboardSummary {
  activeSessions: number;
  closedSessions: number;
  openDisputes: number;
  totalBilledNpr: number;
  totalEnergyKwh: number;
  acceptedReadings: number;
  rejectedReadings: number;
  quarantinedReadings: number;
}

export interface RoomOverview {
  room: Room;
  meter?: Meter;
  latestReading?: Reading;
  activeSession?: Session;
  recentReadings: Reading[];
  recentEnergyKwh: number;
  estimatedCostNpr: number;
  flags: ReadingFlag[];
}

export interface IntegrationStatus {
  hedera: {
    mode: "disabled" | "configured";
    network: string;
    topicId?: string;
    mirrorNodeUrl: string;
  };
  hts: {
    configured: boolean;
    tokenId?: string;
  };
  ens: {
    configured: boolean;
  };
  cre: {
    reportTokenRequired: boolean;
  };
}

export interface DashboardData {
  summary: DashboardSummary;
  rooms: RoomOverview[];
  recentReadings: Reading[];
  sessions: Session[];
  tariff: Tariff | null;
  disputes: Dispute[];
  creReports: CreReport[];
  integrations: IntegrationStatus;
}

export type UserRole = "landlord" | "renter" | "admin";

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  passwordHash?: string;
  propertyIds?: string[];
  roomIds?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Tenancy {
  tenancyId: string;
  roomId: string;
  userId: string;
  role: "renter";
  startDate: string;
  endDate?: string | null;
  status: "active" | "ended";
  createdAt: string;
  updatedAt: string;
}

/** Everything the renter portal needs for one signed-in renter, in a single request. */
export interface RenterSummary {
  dueNpr: number;
  paidNpr: number;
  unpaidCount: number;
  paidCount: number;
  openQuestionCount: number;
  totalUnits?: number;
  unitsSinceLastBill?: number;
  currentRateNprPerKwh?: number;
  latestBillId?: string;
}

export interface RenterOverview {
  user: User;
  tenancy: Tenancy | null;
  room: Room | null;
  property: Property | null;
  meter?: Meter;
  latestReading?: Reading;
  readings: Reading[];
  tariff: Tariff | null;
  bills: Bill[];
  disputes: Dispute[];
  summary: RenterSummary;
}

export interface AuthSession {
  sessionId: string;
  userId: string;
  role: UserRole;
  expiresAt: string;
  createdAt: string;
}
