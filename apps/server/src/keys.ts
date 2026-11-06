import { generateMeterKeyPair, type MeterKeyPair } from "@chargemesh/shared/node";

/**
 * In-memory cache of meter signing keys. Keys are generated when a meter is
 * registered through the API and persisted in `metering.meter_keys`.
 */
export class MeterKeyStore {
  private readonly keys = new Map<string, string>();

  load(entries: Array<{ meterId: string; privateKeyPem: string }>): void {
    for (const entry of entries) {
      this.keys.set(entry.meterId, entry.privateKeyPem);
    }
  }

  has(meterId: string): boolean {
    return this.keys.has(meterId);
  }

  privateKey(meterId: string): string | undefined {
    return this.keys.get(meterId);
  }

  create(meterId: string): MeterKeyPair {
    const pair = generateMeterKeyPair();
    this.keys.set(meterId, pair.privateKeyPem);
    return pair;
  }

  ensure(meterId: string): MeterKeyPair {
    if (this.keys.has(meterId)) {
      const privateKeyPem = this.keys.get(meterId)!;
      return { privateKeyPem, publicKeyPem: "" };
    }
    return this.create(meterId);
  }
}
