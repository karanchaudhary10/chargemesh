import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { PostgresAuthRepository, PostgresRepositories } from "./postgres-repositories.js";
import { SimulatorKeyStore } from "./keys.js";
import { AuditService } from "./audit.js";
import { HederaService } from "./hedera.js";
import { EnsService } from "./ens.js";
import { RoomService } from "./rooms.js";
import { ReadingService } from "./readings.js";
import { SessionService } from "./sessions.js";
import { SimulatorService } from "./simulator.js";
import { CreService } from "./cre.js";
import { TariffService } from "./tariffs.js";
import { BillingService } from "./billing.js";
import { AuthService } from "./auth.js";
import { loadEnvFile } from "./env.js";

async function main(): Promise<void> {
  loadEnvFile();
  const config = loadConfig();
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is not set. Add your PostgreSQL connection string to .env.");
  }

  const repositories = await PostgresRepositories.connect(config.databaseUrl);
  const keys = new SimulatorKeyStore();
  keys.load(await repositories.meterKeys.list());

  const auth = new AuthService(new PostgresAuthRepository(repositories.pool));

  const hedera = new HederaService(config);
  const audit = new AuditService(repositories, hedera);
  const ens = new EnsService(config);
  const rooms = new RoomService(repositories, keys, audit, config);
  const readings = new ReadingService(repositories, audit, config);
  const sessions = new SessionService(repositories, audit, hedera);
  const simulator = new SimulatorService(repositories, keys, readings, config);
  const cre = new CreService(repositories, audit);
  const tariffs = new TariffService(repositories, audit);
  const billing = new BillingService(repositories, audit, tariffs);

  if (config.simulatorEnabled) {
    await simulator.setEnabled(true);
  }

  const app = createApp({
    config,
    repositories,
    audit,
    hedera,
    ens,
    rooms,
    readings,
    sessions,
    simulator,
    cre,
    tariffs,
    billing,
    auth,
    simulatorKeys: keys,
    keys
  } as any);

  let ticking = false;
  setInterval(() => {
    void (async () => {
      if (ticking || !(await repositories.simulator.get()).enabled) {
        return;
      }
      ticking = true;
      try {
        await simulator.tick();
      } catch (error) {
        console.warn(
          `[simulator] Tick failed: ${error instanceof Error ? error.message : "unknown error"}`
        );
      } finally {
        ticking = false;
      }
    })();
  }, config.simulatorIntervalMs).unref();

  app.listen(config.port, () => {
    console.log(`ChargeMesh API listening on http://localhost:${config.port}`);
    console.log(
      `Storage: PostgreSQL (schemas: identity, property, metering, billing, audit, system) | HCS: ${
        hedera.hcsConfigured ? "configured" : "local hash chain"
      } | HTS: ${hedera.htsConfigured ? "configured" : "disabled"}`
    );
  });

  void audit
    .resumePendingSubmissions()
    .then((count) => {
      if (count > 0) {
        console.log(`[audit] Resubmitted ${count} pending Hedera audit event(s)`);
      }
    })
    .catch((error) => {
      console.warn(
        `[audit] Could not resume pending Hedera submissions: ${error instanceof Error ? error.message : "unknown error"}`
      );
    });
}

main().catch((error) => {
  console.error("Failed to start ChargeMesh API:", error);
  process.exitCode = 1;
});
