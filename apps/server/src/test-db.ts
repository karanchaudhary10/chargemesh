import { afterAll } from "vitest";
import { loadEnvFile } from "./env.js";
import { PostgresRepositories } from "./postgres-repositories.js";
import { POSTGRES_TRUNCATE_ALL_SQL } from "./postgres-schema.js";

const opened: PostgresRepositories[] = [];

afterAll(async () => {
  await Promise.all(opened.splice(0).map((repositories) => repositories.close()));
});

export function testDatabaseUrl(): string {
  if (!process.env.TEST_DATABASE_URL) {
    loadEnvFile();
  }
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set. Tests need a separate PostgreSQL database.");
  }
  // Tests wipe every table, so refuse anything that could be the real database.
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith("_test") || url === process.env.DATABASE_URL) {
    throw new Error(`Refusing to run tests against "${name}": the test database name must end with "_test".`);
  }
  return url;
}

export async function connectTestRepositories(): Promise<PostgresRepositories> {
  const repositories = await PostgresRepositories.connect(testDatabaseUrl());
  opened.push(repositories);
  return repositories;
}

export async function createTestRepositories(): Promise<PostgresRepositories> {
  const repositories = await connectTestRepositories();
  await repositories.pool.query(POSTGRES_TRUNCATE_ALL_SQL);
  return repositories;
}
