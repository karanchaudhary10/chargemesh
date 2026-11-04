import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@chargemesh/shared/node": fileURLToPath(new URL("./packages/shared/src/node.ts", import.meta.url)),
      "@chargemesh/shared": fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url))
    }
  },
  test: {
    environment: "node",
    // Server tests share one PostgreSQL test database and truncate it, so run files one at a time.
    fileParallelism: false,
    include: ["packages/**/*.test.ts", "apps/server/src/**/*.test.ts"],
    coverage: {
      reporter: ["text", "html"]
    }
  }
});
