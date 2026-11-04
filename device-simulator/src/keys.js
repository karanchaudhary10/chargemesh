import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import {
  DEFAULT_PRIVATE_KEY_PATH,
  DEFAULT_PUBLIC_KEY_PATH
} from "./paths.js";

export function fingerprintPublicKey(publicKeyPem) {
  const publicDer = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return createHash("sha256").update(publicDer).digest("hex");
}

export function generateKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  return {
    publicKeyPem,
    privateKeyPem,
    keyFingerprint: fingerprintPublicKey(publicKeyPem)
  };
}

async function exists(filePath) {
  try {
    await fs.access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function initializeDevKeyPair({
  privateKeyPath = DEFAULT_PRIVATE_KEY_PATH,
  publicKeyPath = DEFAULT_PUBLIC_KEY_PATH,
  force = false
} = {}) {
  const privateExists = await exists(privateKeyPath);
  const publicExists = await exists(publicKeyPath);
  if (!force && (privateExists || publicExists)) {
    throw new Error(
      `A development key already exists. Refusing to overwrite ${privateKeyPath}. Use --force to replace it.`
    );
  }

  const pair = generateKeyPair();
  await fs.mkdir(path.dirname(privateKeyPath), { recursive: true, mode: 0o700 });
  await fs.mkdir(path.dirname(publicKeyPath), { recursive: true, mode: 0o700 });

  await fs.writeFile(privateKeyPath, pair.privateKeyPem, {
    mode: 0o600,
    flag: force ? "w" : "wx"
  });
  await fs.chmod(privateKeyPath, 0o600);
  await fs.writeFile(publicKeyPath, pair.publicKeyPem, {
    mode: 0o644,
    flag: force ? "w" : "wx"
  });
  await fs.chmod(publicKeyPath, 0o644);

  return {
    created: true,
    privateKeyPath,
    publicKeyPath,
    publicKeyPem: pair.publicKeyPem,
    keyFingerprint: pair.keyFingerprint
  };
}

export async function loadPrivateKey(privateKeyPath = DEFAULT_PRIVATE_KEY_PATH) {
  try {
    return await fs.readFile(privateKeyPath, "utf8");
  } catch {
    throw new Error(
      `Private key not found at ${privateKeyPath}. Run "npm run key:init" first.`
    );
  }
}

export async function loadPublicKey(publicKeyPath = DEFAULT_PUBLIC_KEY_PATH) {
  try {
    return await fs.readFile(publicKeyPath, "utf8");
  } catch {
    throw new Error(
      `Public key not found at ${publicKeyPath}. Run "npm run key:init" first.`
    );
  }
}
