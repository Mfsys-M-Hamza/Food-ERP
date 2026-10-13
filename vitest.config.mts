import { defineConfig } from "vitest/config";
import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ quiet: true });
const testDbUrl = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5433/food_erp_test";

const shared = {
  resolve: { tsconfigPaths: true, alias: { "server-only": path.resolve(import.meta.dirname, "tests/support/server-only.ts") } },
};

export default defineConfig({
  test: {
    projects: [
      {
        ...shared,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        ...shared,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/integration/global-setup.ts"],
          // One shared database: run files sequentially.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
          env: {
            NODE_ENV: "test",
            DATABASE_URL: testDbUrl,
            DIRECT_URL: testDbUrl,
            BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "test-secret-test-secret-test-secret-1234",
            BETTER_AUTH_URL: "http://localhost:3000",
            STORAGE_DRIVER: "local",
            SEED_QUIET: "1",
          },
        },
      },
    ],
  },
});
