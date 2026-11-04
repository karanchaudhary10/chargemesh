import { HashConnect } from "hashconnect";
import { LedgerId } from "@hashgraph/sdk";

/**
 * HashConnect opens a WalletConnect pairing client. Creating a new instance on
 * every render/visit stacks sessions and can make HashPack prompt repeatedly,
 * so keep one instance per portal for the lifetime of the tab.
 */
const instances = new Map<string, HashConnect>();
const pending = new Map<string, Promise<HashConnect>>();

export function getHashConnect(key: string, description: string): Promise<HashConnect> {
  const existing = instances.get(key);
  if (existing) return Promise.resolve(existing);

  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const projectId = import.meta.env.VITE_HASHCONNECT_PROJECT_ID?.trim();
  if (!projectId || projectId === "YOUR_WALLETCONNECT_PROJECT_ID") {
    return Promise.reject(
      new Error("HashPack is not configured. Set VITE_HASHCONNECT_PROJECT_ID in apps/web/.env.local.")
    );
  }

  const connection = (async () => {
    const hashconnect = new HashConnect(
      LedgerId.TESTNET,
      projectId,
      {
        name: "ChargeMesh",
        description,
        icons: ["https://www.hashpack.app/img/logo.svg"],
        url: window.location.origin
      },
      false
    );
    await hashconnect.init();
    instances.set(key, hashconnect);
    return hashconnect;
  })().finally(() => {
    pending.delete(key);
  });

  pending.set(key, connection);
  return connection;
}
