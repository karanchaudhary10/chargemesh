import { z } from "zod";

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "Expected an ISO-8601 timestamp"
});

const finiteNonNegative = z.number().refine((value) => Number.isFinite(value) && value >= 0, {
  message: "Expected a finite non-negative number"
});

export const signedReadingPayloadSchema = z.object({
  meterId: z.string().min(1).max(120),
  roomId: z.string().min(1).max(120).optional(),
  sequence: z.number().int().min(1),
  timestamp: isoDate,
  cumulativeEnergyKwh: finiteNonNegative,
  powerW: finiteNonNegative.optional(),
  voltage: finiteNonNegative.optional(),
  current: finiteNonNegative.optional(),
  nonce: z.string().min(1).max(160).optional(),
  deviceType: z.string().min(1).max(80).optional(),
  simulated: z.boolean().optional()
});

/** Older firmware releases used `cumulativeKwh` instead of `cumulativeEnergyKwh`. */
export const legacyReadingSubmissionSchema = z.object({
  meterId: z.string().min(1).max(120),
  roomId: z.string().min(1).max(120).optional(),
  cumulativeKwh: finiteNonNegative,
  sequence: z.number().int().min(1),
  timestamp: isoDate,
  powerW: finiteNonNegative.optional(),
  voltage: finiteNonNegative.optional(),
  current: finiteNonNegative.optional(),
  nonce: z.string().min(1).max(160).optional(),
  deviceType: z.string().min(1).max(80).optional(),
  simulated: z.boolean().optional(),
  signature: z.string().min(1).max(4000)
});

export const readingSubmissionSchema = z
  .union([signedReadingPayloadSchema.extend({ signature: z.string().min(1).max(4000) }), legacyReadingSubmissionSchema])
  .superRefine((value, ctx) => {
    const hasCumulativeKwh = "cumulativeKwh" in value && value.cumulativeKwh !== undefined;
    const hasCumulativeEnergyKwh = "cumulativeEnergyKwh" in value && (value as any).cumulativeEnergyKwh !== undefined;
    if (hasCumulativeKwh === hasCumulativeEnergyKwh) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Reading must provide exactly one of cumulativeKwh or cumulativeEnergyKwh"
      });
    }
  });

export const propertyCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  address: z.string().max(200).optional(),
  description: z.string().max(200).optional().default(""),
  ownerId: z.string().optional(),
  defaultRateNprPerKwh: z.number().positive().max(10000).finite().optional(),
  billingCycle: z.string().max(120).optional(),
  landlordTitle: z.string().max(80).optional()
});

export const propertyUpdateSchema = propertyCreateSchema.omit({ ownerId: true, description: true }).partial();

export const roomCreateSchema = z.object({
  propertyId: z.string().optional(),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(200).optional().default(""),
  ensName: z.string().max(120).optional(),
  floor: z.string().max(80).optional(),
  unitType: z.string().max(80).optional()
});

export const tenancyCreateSchema = z.object({
  roomId: z.string().min(1),
  userId: z.string().min(1),
  startDate: z.string().optional()
});

export const tenancyAssignSchema = z.object({
  roomId: z.string().min(1),
  email: z.string().email().max(254),
  startDate: isoDate.optional()
});

export const tenancyEndSchema = z.object({
  endDate: z.string().optional()
});

export const meterCreateSchema = z.object({
  meterId: z.string().min(1).max(120).optional(),
  roomId: z.string().min(1).max(120).optional(),
  label: z.string().min(1).max(120).optional(),
  publicKey: z.string().min(1).max(8000).optional(),
  publicKeyPem: z.string().min(1).max(8000).optional(),
  deviceType: z.string().min(1).max(80).optional(),
  status: z.enum(["active", "suspended"]).optional(),
  maxPowerW: z.number().positive().max(100000).optional(),
  staleAfterMs: z.number().int().positive().max(86_400_000).optional()
});

export const meterRegistrationSchema = z
  .object({
    meterId: z.string().min(1).max(120),
    roomId: z.string().min(1).max(120),
    publicKey: z.string().min(1).max(8000),
    publicKeyPem: z.string().min(1).max(8000).optional(),
    deviceType: z.string().min(1).max(80).optional(),
    status: z.enum(["active", "suspended"]).optional()
  })
  .passthrough();

export const tariffUpdateSchema = z.object({
  nprPerKwh: z.number().positive().max(10000).finite(),
  rateNprPerKwh: z.number().positive().max(10000).finite().optional(),
  configuredBy: z.string().min(1).max(120).optional(),
  roomId: z.string().min(1).max(120).optional(),
  scope: z.string().min(1).max(120).optional(),
  effectiveFrom: isoDate.optional(),
  effectiveTo: isoDate.nullable().optional()
});

export const tariffCreateSchema = z
  .object({
    rateNprPerKwh: z.number().positive().max(10000).finite().optional(),
    nprPerKwh: z.number().positive().max(10000).finite().optional(),
    configuredBy: z.string().min(1).max(120).optional(),
    roomId: z.string().min(1).max(120).optional(),
    scope: z.string().min(1).max(120).optional(),
    effectiveFrom: isoDate.optional(),
    effectiveTo: isoDate.nullable().optional()
  })
  .refine((data) => data.rateNprPerKwh !== undefined || data.nprPerKwh !== undefined, {
    message: "rateNprPerKwh or nprPerKwh is required"
  });

export const landlordPaymentQrSchema = z.object({
  dataUrl: z.string().min(1).max(5_000_000),
  mimeType: z.string().min(1).max(120).optional(),
  filename: z.string().min(1).max(255).optional(),
  note: z.string().min(1).max(500).optional()
});

export const userWalletCreateSchema = z.object({
  type: z.enum(["esewa", "fonepay", "khalti", "bank", "hashpack", "hedera", "other"]),
  label: z.string().min(1).max(120),
  accountId: z.string().max(160).optional(),
  qrPayload: z.string().max(4096).optional(),
  qrDataUrl: z.string().max(5_000_000).optional(),
  publicKey: z.string().max(512).optional(),
  network: z.enum(["testnet", "mainnet"]).optional(),
  pairingData: z.record(z.string(), z.unknown()).nullable().optional(),
  isDefault: z.boolean().optional()
});

export const userWalletUpdateSchema = userWalletCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional()
});

export const billCreateSchema = z.object({
  roomId: z.string().min(1).max(120),
  periodStart: isoDate,
  periodEnd: isoDate,
  tariffId: z.string().min(1).max(120).optional(),
  meterId: z.string().min(1).max(120).optional(),
  landlordPaymentQr: landlordPaymentQrSchema.nullable().optional()
});

export const billSubmitPaymentSchema = z.object({
  method: z.enum(["esewa", "fonepay", "khalti", "bank", "hashpack", "hedera", "other", "wallet_qr"]).optional(),
  transactionId: z.string().trim().min(3).max(160),
  reference: z.string().trim().min(1).max(160).optional(),
  paidFromWalletId: z.string().min(1).max(64).optional(),
  note: z.string().max(500).optional(),
  slipDataUrl: z.string().max(5_000_000).optional()
});

export const billVerifyPaymentSchema = z.object({
  transactionId: z.string().trim().min(1).max(160).optional(),
  note: z.string().max(500).optional()
});

/** Payload decoded by the renter's camera from their wallet QR. */
export const walletPaymentSchema = z.object({
  payload: z.string().trim().min(1, "Scan a wallet QR first").max(4096, "That QR payload is too long")
});

export type WalletPaymentInput = z.infer<typeof walletPaymentSchema>;

export const disputeOpenSchema = z.object({
  reason: z.string().min(5).max(2000),
  openedBy: z.string().min(1).max(120)
});

export const disputeResolveSchema = z.object({
  status: z.enum(["upheld", "rejected"]),
  resolution: z.string().min(3).max(2000),
  resolvedBy: z.string().min(1).max(120),
  creditNpr: z.number().positive().max(10_000_000).finite().optional()
});

export const settleSchema = z.object({
  payerAccountId: z.string().regex(/^\d+\.\d+\.\d+$/, "Expected a Hedera account ID such as 0.0.1234")
});

const findingSchema = z.object({
  code: z.string().min(1).max(120),
  severity: z.enum(["error", "warning"]),
  message: z.string().min(1).max(1000),
  sessionId: z.string().max(120).optional()
});

const creEvmResultSchema = z.object({
  status: z.enum(["pending", "submitted", "failed"]),
  chainSelectorName: z.string().min(1).max(80),
  contractAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  transactionHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
  explorerUrl: z.string().url().optional(),
  error: z.string().max(1000).optional(),
  updatedAt: isoDate
});

export const creReportSchema = z.object({
  reportId: z.string().min(1).max(120),
  generatedAt: isoDate,
  source: z.enum(["cre-workflow", "local-fallback"]),
  status: z.enum(["verified", "flagged", "review"]),
  findings: z.array(findingSchema).max(1000),
  sessionIds: z.array(z.string().max(120)).max(1000),
  evidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
  evm: creEvmResultSchema.optional()
});

export const ensResolveSchema = z.object({
  name: z.string().min(3).max(255)
});

export type ReadingSubmissionInput = z.infer<typeof readingSubmissionSchema>;
export type RoomCreateInput = z.infer<typeof roomCreateSchema>;
export type MeterCreateInput = z.infer<typeof meterCreateSchema>;
export type MeterRegistrationInput = z.infer<typeof meterRegistrationSchema>;
export type TariffUpdateInput = z.infer<typeof tariffUpdateSchema>;
export type DisputeOpenInput = z.infer<typeof disputeOpenSchema>;
export type DisputeResolveInput = z.infer<typeof disputeResolveSchema>;
export type SettleInput = z.infer<typeof settleSchema>;
export type CreReportInput = z.infer<typeof creReportSchema>;
