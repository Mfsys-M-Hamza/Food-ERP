import { execSync } from "node:child_process";
import { config as loadEnv } from "dotenv";

/** Apply migrations to the dedicated test database once per run. */
export default function setup() {
  loadEnv({ quiet: true });
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5433/food_erp_test";
  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (!dbName.endsWith("_test")) {
    throw new Error(`Refusing to run integration tests: TEST_DATABASE_URL must point to a *_test database (got "${dbName}").`);
  }
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DIRECT_URL: url, DATABASE_URL: url },
  });
}
