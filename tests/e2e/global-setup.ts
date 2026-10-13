import { execSync } from "node:child_process";
import { config as loadEnv } from "dotenv";

/** Migrate, wipe and re-seed the *_test database before the E2E run. */
export default function globalSetup() {
  loadEnv({ quiet: true });
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5433/food_erp_test";
  if (!new URL(url).pathname.endsWith("_test")) throw new Error("E2E tests require a *_test database");
  const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url, SEED_QUIET: "1" };
  execSync("npx prisma migrate deploy", { stdio: "pipe", env });
  execSync("npx tsx tests/e2e/reset-db.ts", { stdio: "inherit", env });
}

// Allow running directly: npx tsx tests/e2e/global-setup.ts
if (process.argv[1] && /global-setup.ts$/.test(process.argv[1])) globalSetup();
