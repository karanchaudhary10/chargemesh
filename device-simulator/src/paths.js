import path from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

export const DEFAULT_KEY_DIR = path.join(PACKAGE_ROOT, "keys");
export const DEFAULT_PRIVATE_KEY_PATH = path.join(DEFAULT_KEY_DIR, "meter-private.pem");
export const DEFAULT_PUBLIC_KEY_PATH = path.join(DEFAULT_KEY_DIR, "meter-public.pem");
export const DEFAULT_STATE_PATH = path.join(PACKAGE_ROOT, "state", "meter-state.json");
