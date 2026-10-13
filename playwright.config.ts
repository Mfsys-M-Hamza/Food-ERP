import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv({ quiet: true });

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;
const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5433/food_erp_test";

/**
 * End-to-end tests run against a production build (`next build && next start`)
 * using the *_test database, which global-setup wipes and re-seeds.
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /responsive/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /responsive/ },
    { name: "tablet", use: { ...devices["Galaxy Tab S4"], browserName: "chromium" }, testMatch: /responsive/ },
  ],
  webServer: {
    // Reset the test database BEFORE building: the build caches the public menu.
    command: `npx tsx tests/e2e/global-setup.ts && npm run build && npx next start -p ${PORT}`,
    url: `${BASE_URL}/api/v1/health`,
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
    env: {
      DATABASE_URL: TEST_DB,
      DIRECT_URL: TEST_DB,
      BETTER_AUTH_URL: BASE_URL,
      NEXT_PUBLIC_APP_URL: BASE_URL,
      E2E_DISABLE_RATE_LIMIT: "true",
      STORAGE_DRIVER: "local",
      SEED_QUIET: "1",
    },
  },
});
