import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function loadEnvFile(): void {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env")
  ];
  const envFile = candidates.find((candidate) => existsSync(candidate));

  if (envFile) {
    process.loadEnvFile(envFile);
  }
}
