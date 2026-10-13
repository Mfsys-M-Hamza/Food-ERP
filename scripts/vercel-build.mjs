// Vercel build: apply database migrations for production deployments only,
// then build. Preview deployments never touch the production database
// (give previews their own DATABASE_URL / DIRECT_URL, or none).
import { execSync } from "node:child_process";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });
const env = process.env.VERCEL_ENV ?? "development";
if (env === "production" || process.env.MIGRATE_ON_BUILD === "true") {
  console.log(`[vercel-build] ${env}: applying migrations`);
  run("npx prisma migrate deploy");
} else {
  console.log(`[vercel-build] ${env}: skipping migrations`);
}
run("npx next build");
