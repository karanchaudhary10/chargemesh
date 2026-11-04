import type { AuditEvent, HederaAuditReference } from "@chargemesh/shared";
import type { Config } from "./config.js";
import { AppError } from "./errors.js";

export interface TokenTransferResult {
  transactionId: string;
  tokenId: string;
  payerAccountId: string;
  treasuryAccountId: string;
  amountTokenUnits: string;
}

export class HederaService {
  constructor(private readonly config: Config) {}

  get hcsConfigured(): boolean {
    return Boolean(
      this.config.hederaEnabled &&
        (this.config.hedera?.operatorId ?? this.config.hederaOperatorId) &&
        (this.config.hedera?.operatorKey ?? this.config.hederaOperatorKey) &&
        (this.config.hedera?.topicId ?? this.config.hederaTopicId)
    );
  }

  get htsConfigured(): boolean {
    return Boolean(
      (this.config.hts?.tokenId) &&
        (this.config.hedera?.operatorId ?? this.config.hederaOperatorId) &&
        (this.config.hedera?.operatorKey ?? this.config.hederaOperatorKey) &&
        ((this.config.hts?.treasuryAccountId) ?? (this.config.hedera?.operatorId ?? this.config.hederaOperatorId))
    );
  }

  status() {
    return {
      hedera: {
        mode: this.hcsConfigured ? ("configured" as const) : ("disabled" as const),
        network: (this.config.hedera?.network ?? this.config.hederaNetwork),
        topicId: (this.config.hedera?.topicId ?? this.config.hederaTopicId),
        mirrorNodeUrl: (this.config.hedera?.mirrorNodeUrl ?? this.config.hederaMirrorNodeUrl)
      },
      hts: {
        configured: this.htsConfigured,
        tokenId: (this.config.hts?.tokenId)
      }
    };
  }

  mirrorMessageUrl(sequence: string): string {
    if (!(this.config.hedera?.topicId ?? this.config.hederaTopicId)) {
      throw new AppError(503, "hedera_not_configured", "Hedera HCS is not configured");
    }
    return `${(this.config.hedera?.mirrorNodeUrl ?? this.config.hederaMirrorNodeUrl)}/topics/${(this.config.hedera?.topicId ?? this.config.hederaTopicId)}/messages/${encodeURIComponent(sequence)}`;
  }

  async submitAuditEvent(event: AuditEvent): Promise<HederaAuditReference> {
    if (!this.hcsConfigured) {
      throw new AppError(503, "hedera_not_configured", "Hedera HCS is not configured");
    }

    const sdk = await import("@hiero-ledger/sdk");
    const client =
      (this.config.hedera?.network ?? this.config.hederaNetwork) === "mainnet"
        ? sdk.Client.forMainnet()
        : (this.config.hedera?.network ?? this.config.hederaNetwork) === "previewnet"
          ? sdk.Client.forPreviewnet()
          : sdk.Client.forTestnet();
    client.setOperator(
      sdk.AccountId.fromString((this.config.hedera?.operatorId ?? this.config.hederaOperatorId)!),
      sdk.PrivateKey.fromString((this.config.hedera?.operatorKey ?? this.config.hederaOperatorKey)!)
    );

    try {
      const message = JSON.stringify({
        v: 1,
        app: "chargemesh",
        id: event.id,
        seq: event.seq,
        type: event.type,
        at: event.at,
        hash: event.hash,
        prevHash: event.prevHash
      });
      if (Buffer.byteLength(message, "utf8") > 1024) {
        throw new AppError(500, "hcs_message_too_large", "Audit reference exceeds the HCS message limit");
      }

      const transaction = new sdk.TopicMessageSubmitTransaction()
        .setTopicId(sdk.TopicId.fromString((this.config.hedera?.topicId ?? this.config.hederaTopicId)!))
        .setMessage(message);
      const response = await transaction.execute(client);
      const receipt = await response.getReceipt(client);
      if (!receipt.topicSequenceNumber) {
        throw new Error("HCS receipt did not include a topic sequence number");
      }

      return {
        network: (this.config.hedera?.network ?? this.config.hederaNetwork),
        topicId: (this.config.hedera?.topicId ?? this.config.hederaTopicId)!,
        sequenceNumber: receipt.topicSequenceNumber.toString(),
        transactionId: response.transactionId.toString(),
        mirrorNodeUrl: this.mirrorMessageUrl(receipt.topicSequenceNumber.toString())
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(502, "hedera_submit_failed", "Hedera HCS submission failed");
    } finally {
      client.close();
    }
  }

  async fetchMirrorMessage(sequence: string): Promise<unknown> {
    if (!/^\d+$/.test(sequence)) {
      throw new AppError(400, "invalid_sequence", "Sequence must be a positive integer");
    }
    const url = this.mirrorMessageUrl(sequence);
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) {
      throw new AppError(
        response.status === 404 ? 404 : 502,
        "mirror_node_failed",
        `Mirror Node request failed with status ${response.status}`
      );
    }
    return response.json();
  }

  async fetchMirrorMessages(limit = 25): Promise<unknown> {
    if (!(this.config.hedera?.topicId ?? this.config.hederaTopicId)) {
      throw new AppError(503, "hedera_not_configured", "Hedera HCS is not configured");
    }
    const mirrorNodeUrl = this.config.hedera?.mirrorNodeUrl ?? this.config.hederaMirrorNodeUrl;
    const url = new URL(
      `${mirrorNodeUrl.replace(/\/$/, "")}/topics/${encodeURIComponent(
        (this.config.hedera?.topicId ?? this.config.hederaTopicId)!
      )}/messages`
    );
    url.searchParams.set("limit", String(Math.max(1, Math.min(Math.floor(limit), 100))));
    url.searchParams.set("order", "desc");
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) {
      throw new AppError(502, "mirror_node_failed", "Hedera Mirror Node request failed");
    }
    return response.json();
  }

  async transferTestTokens(payerAccountId: string, amountNpr: number): Promise<TokenTransferResult> {
    if (!this.htsConfigured) {
      throw new AppError(503, "hts_not_configured", "Hedera Token Service is not configured");
    }
    if (!Number.isFinite(amountNpr) || amountNpr <= 0) {
      throw new AppError(400, "invalid_amount", "Settlement amount must be positive");
    }

    const sdk = await import("@hiero-ledger/sdk");
    const treasuryAccountId = (this.config.hts?.treasuryAccountId) ?? (this.config.hedera?.operatorId ?? this.config.hederaOperatorId)!;
    const decimals = (this.config.hts?.tokenDecimals ?? 0);
    const units = Math.round(amountNpr * 10 ** decimals);
    if (!Number.isSafeInteger(units) || units <= 0) {
      throw new AppError(400, "invalid_amount", "Settlement amount cannot be represented safely");
    }

    const client =
      (this.config.hedera?.network ?? this.config.hederaNetwork) === "mainnet"
        ? sdk.Client.forMainnet()
        : (this.config.hedera?.network ?? this.config.hederaNetwork) === "previewnet"
          ? sdk.Client.forPreviewnet()
          : sdk.Client.forTestnet();
    client.setOperator(
      sdk.AccountId.fromString((this.config.hedera?.operatorId ?? this.config.hederaOperatorId)!),
      sdk.PrivateKey.fromString((this.config.hedera?.operatorKey ?? this.config.hederaOperatorKey)!)
    );

    try {
      const tokenId = sdk.TokenId.fromString((this.config.hts?.tokenId)!);
      const payer = sdk.AccountId.fromString(payerAccountId);
      const treasury = sdk.AccountId.fromString(treasuryAccountId);
      const transaction = new sdk.TransferTransaction()
        .addTokenTransfer(tokenId, payer, -units)
        .addTokenTransfer(tokenId, treasury, units);
      const response = await transaction.execute(client);
      const receipt = await response.getReceipt(client);

      return {
        transactionId: response.transactionId.toString(),
        tokenId: (this.config.hts?.tokenId)!,
        payerAccountId,
        treasuryAccountId,
        amountTokenUnits: String(units)
      };
    } catch {
      throw new AppError(
        502,
        "hts_transfer_failed",
        "HTS test-token transfer failed; verify token association and payer balance"
      );
    } finally {
      client.close();
    }
  }

  async createTopic(memo: string): Promise<string> {
    if (!(this.config.hedera?.operatorId ?? this.config.hederaOperatorId) || !(this.config.hedera?.operatorKey ?? this.config.hederaOperatorKey)) {
      throw new AppError(503, "hedera_not_configured", "Hedera operator credentials are not configured");
    }

    const sdk = await import("@hiero-ledger/sdk");
    const client =
      (this.config.hedera?.network ?? this.config.hederaNetwork) === "mainnet"
        ? sdk.Client.forMainnet()
        : (this.config.hedera?.network ?? this.config.hederaNetwork) === "previewnet"
          ? sdk.Client.forPreviewnet()
          : sdk.Client.forTestnet();
    client.setOperator(
      sdk.AccountId.fromString(String(this.config.hedera?.operatorId ?? this.config.hederaOperatorId)),
      sdk.PrivateKey.fromString(String(this.config.hedera?.operatorKey ?? this.config.hederaOperatorKey))
    );

    try {
      const transaction = new sdk.TopicCreateTransaction().setTopicMemo(memo.slice(0, 100));
      const response = await transaction.execute(client);
      const receipt = await response.getReceipt(client);
      if (!receipt.topicId) {
        throw new Error("No topic ID in receipt");
      }
      return receipt.topicId.toString();
    } catch {
      throw new AppError(502, "hedera_topic_create_failed", "Hedera topic creation failed");
    } finally {
      client.close();
    }
  }
}
