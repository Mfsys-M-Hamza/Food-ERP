/**
 * Wipes the *_test database and seeds foundation data plus known E2E accounts.
 * Run by tests/e2e/global-setup.ts.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";
import { seedDemoData, seedFoundation, seedUsers } from "../../prisma/seed/index";
import { E2E } from "./accounts";

const url = process.env.DATABASE_URL!;
if (!new URL(url).pathname.endsWith("_test")) throw new Error("reset-db only runs against a *_test database");

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

async function main() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`,
  );
  process.env.SEED_OWNER_EMAIL = E2E.owner.email;
  process.env.SEED_OWNER_PASSWORD = E2E.owner.password;
  process.env.SEED_OWNER_NAME = "Olivia Owner";
  process.env.SEED_DEMO_USERS = "true";
  process.env.SEED_DEMO_PASSWORD = E2E.demoPassword;
  process.env.SEED_DEMO_SALES = "false";
  await seedFoundation(db);
  await seedUsers(db);
  await seedDemoData(db);
  // Open 24 h so storefront tests do not depend on the time of day.
  await db.businessHour.updateMany({ data: { opensAt: "00:00", closesAt: "00:00", isClosed: false } });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
