import {
  Client,
  PrivateKey,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  AccountId
} from "@hiero-ledger/sdk";
import type { Config } from "../config.js";

export class HederaClient {
  private client: Client | null = null;

  constructor(private readonly config: Config) {}

  private ensureClient(): Client {
    if (this.client) return this.client;
    if (!this.config.hederaEnabled) {
      throw new Error("Hedera is not enabled");
    }
    if (!this.config.hederaOperatorId || !this.config.hederaOperatorKey) {
      throw new Error("Missing HEDERA_OPERATOR_ID or HEDERA_OPERATOR_KEY");
    }
    const client =
      this.config.hederaNetwork === "mainnet"
        ? Client.forMainnet()
        : this.config.hederaNetwork === "previewnet"
          ? Client.forPreviewnet()
          : Client.forTestnet();
    client.setOperator(AccountId.fromString(this.config.hederaOperatorId), PrivateKey.fromString(this.config.hederaOperatorKey));
    this.client = client;
    return client;
  }

  async createTopic(): Promise<string> {
    const client = this.ensureClient();
    const tx = await new TopicCreateTransaction().execute(client);
    const receipt = await tx.getReceipt(client);
    const topicId = receipt.topicId;
    if (!topicId) {
      throw new Error("Failed to create HCS topic");
    }
    return topicId.toString();
  }

  async submitMessage(topicId: string, message: string | Uint8Array): Promise<{ topicId: string; sequenceNumber?: string; transactionId?: string }> {
    const client = this.ensureClient();
    const tx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(typeof message === "string" ? message : Buffer.from(message))
      .execute(client);
    const receipt = await tx.getReceipt(client);
    const sequenceNumber = receipt.topicSequenceNumber?.toString();
    return {
      topicId,
      sequenceNumber,
      transactionId: tx.transactionId?.toString()
    };
  }

  close(): void {
    if (this.client) {
      this.client.close();
      this.client = null;
    }
  }
}
