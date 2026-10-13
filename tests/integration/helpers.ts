import { db } from "@/server/core/db";
import { buildContext, type Ctx } from "@/server/core/context";
import { __resetBranchCache } from "@/server/core/branch";
import { hashSecret } from "@/server/core/password";
import { seedFoundation } from "../../prisma/seed/index";

/** Wipe every table in the *_test database and re-seed the foundation data. */
export async function resetDatabase() {
  const dbName = new URL(process.env.DATABASE_URL!).pathname.replace(/^\//, "");
  if (!dbName.endsWith("_test")) throw new Error("resetDatabase() only runs against a *_test database");
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await db.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`,
    );
  }
  __resetBranchCache();
  // The seed module uses the same generated client type.
  await seedFoundation(db as never);
}

let counter = 0;

/** Create a staff user with the given system role and return its id. */
export async function createUserWithRole(roleKey: string, opts: { password?: string; email?: string } = {}) {
  counter++;
  const role = await db.role.findUniqueOrThrow({ where: { key: roleKey } });
  const email = opts.email ?? `${roleKey}${counter}-${Date.now()}@test.local`;
  const user = await db.user.create({
    data: {
      name: `${roleKey} user ${counter}`,
      email,
      kind: "STAFF",
      status: "ACTIVE",
      emailVerified: true,
      userRoles: { create: [{ roleId: role.id }] },
    },
  });
  await db.account.create({
    data: {
      userId: user.id,
      accountId: user.id,
      providerId: "credential",
      password: await hashSecret(opts.password ?? "Password123!"),
    },
  });
  return user;
}

export async function ctxFor(userId: string): Promise<Ctx> {
  const ctx = await buildContext(userId, { ip: "127.0.0.1", userAgent: "vitest" });
  if (!ctx) throw new Error("No context for user");
  return ctx;
}

export async function ctxForRole(roleKey: string): Promise<Ctx> {
  const u = await createUserWithRole(roleKey);
  return ctxFor(u.id);
}

/** Load the demo menu (6 categories, 21 products). */
export async function seedMenu() {
  const { seedDemoMenu } = await import("../../prisma/seed/demo-menu");
  await seedDemoMenu(db as never, () => {});
}

export async function setPin(userId: string, pin: string) {
  await db.user.update({ where: { id: userId }, data: { pinHash: await hashSecret(pin) } });
}

export async function counterTerminalId() {
  return (await db.posTerminal.findFirstOrThrow({ where: { name: "Counter 1" } })).id;
}

/** Product (with first/default variant and add-ons) by SKU for building order lines. */
export async function productBySku(sku: string) {
  return db.product.findUniqueOrThrow({
    where: { sku },
    include: {
      variants: { orderBy: { sortOrder: "asc" } },
      addonGroups: { include: { group: { include: { addons: { orderBy: { sortOrder: "asc" } } } } } },
      removables: true,
    },
  });
}
