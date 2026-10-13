import "dotenv/config";
import { defineConfig } from "prisma/config";

// Migrations use the DIRECT connection (not the pooler).
// The running app uses DATABASE_URL through the pg driver adapter (src/server/core/db.ts).
export default defineConfig({
  schema: "prisma/schema",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed/index.ts",
  },
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
});
