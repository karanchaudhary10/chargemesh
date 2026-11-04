import { loadConfig } from "../apps/server/src/config.js";
import { HederaClient } from "../apps/server/src/hedera/client.js";
import { loadEnvFile } from "../apps/server/src/env.js";

async function main() {
  loadEnvFile();
  const config = loadConfig();
  if (!config.hederaEnabled) {
    console.error("Set HEDERA_ENABLED=true and operator credentials first");
    process.exit(1);
  }
  const client = new HederaClient(config);
  try {
    const topicId = await client.createTopic();
    console.log(topicId);
  } catch (e: any) {
    console.error(e?.message || e);
    process.exit(1);
  } finally {
    client.close();
  }
}

main();
