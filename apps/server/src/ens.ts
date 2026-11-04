import type { Config } from "./config.js";

export class EnsService {
  constructor(private readonly config: Config) {}

  get configured(): boolean {
    const ens = (this.config.ens as Record<string, unknown> | undefined) ?? {};
    return Object.keys(ens).length > 0;
  }

  async resolveName(name: string): Promise<string | null> {
    const ens = (this.config.ens as Record<string, unknown> | undefined) ?? {};
    const value = ens[name];
    if (typeof value === "string") {
      return value;
    }
    return null;
  }

  async resolve(name: string): Promise<string | null> {
    return this.resolveName(name);
  }

  async reverseName(_address: string): Promise<string | null> {
    return null;
  }
}
