export interface Config {
  port: number;
  databaseUrl?: string;
  staleAfterMs: number;
  maxPowerW: number;
  energyJumpTolerance: number;
  creReportToken?: string;
  hederaNetwork: "testnet" | "mainnet" | "previewnet";
  hederaOperatorId?: string;
  hederaOperatorKey?: string;
  hederaTopicId?: string;
  hederaMirrorNodeUrl: string;
  hederaEnabled: boolean;
  hedera?: { network?: string; mirrorNodeUrl?: string; operatorId?: string; operatorKey?: string; topicId?: string };
  hts?: { tokenId?: string; treasuryAccountId?: string; tokenDecimals?: number };
  ens?: Record<string, unknown>;
}

function env(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined || value === "") {
    return undefined;
  }
  return value.trim();
}

function numberEnv(name: string, fallback: number): number {
  const value = env(name);
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const value = env(name);
  if (!value) {
    return fallback;
  }
  const normalized = value.toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return false;
  }
  return fallback;
}

export function loadConfig(): Config {
  const creReportToken = env("CRE_REPORT_TOKEN");
  if (creReportToken && creReportToken.length < 32) {
    throw new Error("CRE_REPORT_TOKEN must contain at least 32 characters when configured.");
  }
  const network = (env("HEDERA_NETWORK") ?? "testnet").toLowerCase();
  const hederaNetwork = (network === "mainnet" || network === "previewnet" ? network : "testnet") as Config["hederaNetwork"];
  const defaultMirror =
    hederaNetwork === "mainnet"
      ? "https://mainnet-public.mirrornode.hedera.com/api/v1"
      : hederaNetwork === "previewnet"
        ? "https://previewnet.mirrornode.hedera.com/api/v1"
        : "https://testnet.mirrornode.hedera.com/api/v1";

  const mirror = env("HEDERA_MIRROR_NODE_URL") || defaultMirror;
  return {
    port: numberEnv("PORT", 4000),
    databaseUrl: env("DATABASE_URL"),
    staleAfterMs: numberEnv("STALE_AFTER_MS", 60_000),
    maxPowerW: numberEnv("MAX_POWER_W", 5_000),
    energyJumpTolerance: numberEnv("ENERGY_JUMP_TOLERANCE", 10),
    creReportToken,
    hederaNetwork,
    hederaOperatorId: env("HEDERA_OPERATOR_ID"),
    hederaOperatorKey: env("HEDERA_OPERATOR_KEY"),
    hederaTopicId: env("HEDERA_TOPIC_ID"),
    hederaMirrorNodeUrl: mirror,
    hederaEnabled: boolEnv("HEDERA_ENABLED", false),
    hedera: {
      network: hederaNetwork,
      mirrorNodeUrl: mirror,
      operatorId: env("HEDERA_OPERATOR_ID"),
      operatorKey: env("HEDERA_OPERATOR_KEY"),
      topicId: env("HEDERA_TOPIC_ID")
    },
    hts: {},
    ens: {}
  };
}
