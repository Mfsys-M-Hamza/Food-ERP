// Local development PostgreSQL server, no Docker or admin rights needed.
// Usage: npm run db        (starts and keeps running; Ctrl+C to stop)
//        npm run db:reset  (deletes local data and re-creates databases)
import EmbeddedPostgres from "embedded-postgres";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

const dataDir = path.resolve(".data/postgres");
const port = Number(process.env.LOCAL_PG_PORT ?? 5433);
const reset = process.argv.includes("--reset");

if (reset && existsSync(dataDir)) {
  rmSync(dataDir, { recursive: true, force: true });
  console.log("Local database files removed.");
}

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  port,
  user: "postgres",
  password: "postgres",
  authMethod: "scram-sha-256",
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {},
  onError: (e) => console.error(String(e)),
});

const fresh = !existsSync(path.join(dataDir, "PG_VERSION"));
if (fresh) {
  console.log("Initialising local PostgreSQL cluster…");
  await pg.initialise();
}
await pg.start();

for (const name of ["food_erp", "food_erp_test"]) {
  try {
    await pg.createDatabase(name);
    console.log(`Created database ${name}`);
  } catch {
    // already exists
  }
}

console.log(`PostgreSQL running on postgresql://postgres:postgres@localhost:${port}`);
console.log("Keep this terminal open. Press Ctrl+C to stop.");

const shutdown = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
setInterval(() => {}, 1 << 30);
