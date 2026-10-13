/**
 * Idempotent seed: safe to run repeatedly.
 *   npm run db:seed
 * - permissions catalog + system roles (custom role edits are preserved)
 * - main branch, terminals, default settings, opening hours
 * - first Owner account (from SEED_OWNER_* env) and optional demo staff
 * Later phases add their own demo data modules here (menu, orders, stock …).
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "better-auth/crypto";
import { PrismaClient } from "../../src/generated/prisma/client";
import {
  PERMISSIONS,
  PERMISSION_KEYS,
  ROLE_KEYS,
  SYSTEM_ROLES,
  defaultPermissionsFor,
} from "../../src/lib/rbac/catalog";
import { SETTINGS_KEYS, defaultSettings, settingsSchemas } from "../../src/lib/settings/registry";
import { seedDemoMenu } from "./demo-menu";
import { seedDemoOps } from "./demo-ops";
import { seedDemoInventory } from "./demo-inventory";
import { seedDemoPeople } from "./demo-people";
import { seedDemoSales } from "./demo-sales";

const url = process.env.SEED_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const log = (msg: string) => {
  if (!process.env.SEED_QUIET) console.log(msg);
};

export async function seedFoundation(db: PrismaClient = prisma) {
  // 1. Branch
  const branch = await db.branch.upsert({
    where: { code: "MAIN" },
    update: {},
    create: { code: "MAIN", name: "Main Branch", timezone: "Asia/Karachi" },
  });
  log(`✓ Branch ${branch.name}`);

  // 2. Permissions (remove keys no longer in the catalog)
  const existingPerms = await db.permission.findMany({ select: { key: true } });
  const existingKeys = new Set(existingPerms.map((p) => p.key));
  const newKeys = PERMISSION_KEYS.filter((k) => !existingKeys.has(k));
  for (const key of PERMISSION_KEYS) {
    const def = PERMISSIONS[key];
    await db.permission.upsert({
      where: { key },
      update: { module: def.module, description: def.description },
      create: { key, module: def.module, description: def.description },
    });
  }
  const stale = [...existingKeys].filter((k) => !(k in PERMISSIONS));
  if (stale.length) await db.permission.deleteMany({ where: { key: { in: stale } } });
  log(`✓ ${PERMISSION_KEYS.length} permissions (${newKeys.length} new, ${stale.length} removed)`);

  // 3. System roles. New roles get defaults; existing roles only receive
  //    permissions that are new to the catalog (custom edits are kept).
  const allPerms = await db.permission.findMany({ select: { id: true, key: true } });
  const permId = new Map(allPerms.map((p) => [p.key, p.id]));
  for (const roleKey of ROLE_KEYS) {
    const meta = SYSTEM_ROLES[roleKey];
    const existing = await db.role.findUnique({ where: { key: roleKey } });
    const role = await db.role.upsert({
      where: { key: roleKey },
      update: { name: meta.name, description: meta.description, isSystem: true },
      create: { key: roleKey, name: meta.name, description: meta.description, isSystem: true },
    });
    const defaults = defaultPermissionsFor(roleKey);
    const grant =
      roleKey === "owner" || !existing ? defaults : defaults.filter((k) => newKeys.includes(k));
    if (grant.length) {
      await db.rolePermission.createMany({
        data: grant.map((k) => ({ roleId: role.id, permissionId: permId.get(k)! })),
        skipDuplicates: true,
      });
    }
  }
  log(`✓ System roles: ${ROLE_KEYS.join(", ")}`);

  // 4. Settings (only keys that do not exist yet)
  const demoProfile = {
    name: process.env.SEED_BUSINESS_NAME ?? "Demo Burger House",
    tagline: "Fresh burgers, pizza & more",
    address: "Shop 12, Main Boulevard",
    city: "Lahore",
    phone: "+92 42 1234567",
    whatsapp: "+92 300 1234567",
    email: "hello@example.com",
  };
  for (const key of SETTINGS_KEYS) {
    const exists = await db.setting.findFirst({ where: { key, branchId: null }, select: { id: true } });
    if (exists) continue;
    const value =
      key === "business.profile"
        ? settingsSchemas["business.profile"].parse(demoProfile)
        : defaultSettings(key);
    await db.setting.create({ data: { key, branchId: null, value: value as object } });
  }
  log("✓ Default settings");

  // 5. Opening hours: 11:00 – 01:00 (past midnight) every day
  for (let weekday = 0; weekday < 7; weekday++) {
    await db.businessHour.upsert({
      where: { branchId_weekday: { branchId: branch.id, weekday } },
      update: {},
      create: { branchId: branch.id, weekday, opensAt: "11:00", closesAt: "01:00", isClosed: false },
    });
  }
  log("✓ Opening hours");

  // 6. Terminals
  for (const t of [
    { name: "Counter 1", kind: "POS" as const },
    { name: "Kitchen Screen", kind: "KDS" as const },
  ]) {
    await db.posTerminal.upsert({
      where: { branchId_name: { branchId: branch.id, name: t.name } },
      update: {},
      create: { branchId: branch.id, ...t },
    });
  }
  log("✓ Terminals");

  // 7. Expense categories. System ones are used by payroll; the rest are a
  //    starting list the owner can rename or archive.
  const categories: { name: string; systemKey?: string }[] = [
    { name: "Salaries", systemKey: "salaries" },
    { name: "Salary advances", systemKey: "salary_advances" },
    { name: "Rent" },
    { name: "Electricity" },
    { name: "Gas" },
    { name: "Water" },
    { name: "Internet & phone" },
    { name: "Repairs & maintenance" },
    { name: "Cleaning supplies" },
    { name: "Packaging" },
    { name: "Fuel & transport" },
    { name: "Marketing" },
    { name: "Staff food" },
    { name: "Bank charges" },
    { name: "Other" },
  ];
  for (const [i, c] of categories.entries()) {
    const found = c.systemKey
      ? await db.expenseCategory.findUnique({ where: { systemKey: c.systemKey } })
      : await db.expenseCategory.findFirst({ where: { name: { equals: c.name, mode: "insensitive" } } });
    if (!found) await db.expenseCategory.create({ data: { name: c.name, systemKey: c.systemKey ?? null, sortOrder: i } });
  }
  log("✓ Expense categories");

  return branch;
}

async function ensureUser(
  db: PrismaClient,
  u: { name: string; email: string; password: string; roleKey: string; pin?: string; phone?: string },
) {
  const email = u.email.toLowerCase();
  const existing = await db.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  if (existing) return { user: existing, created: false };
  const role = await db.role.findUniqueOrThrow({ where: { key: u.roleKey } });
  const user = await db.user.create({
    data: {
      name: u.name,
      email,
      phone: u.phone ?? null,
      emailVerified: true,
      kind: "STAFF",
      status: "ACTIVE",
      pinHash: u.pin ? await hashPassword(u.pin) : null,
      userRoles: { create: [{ roleId: role.id }] },
    },
  });
  await db.account.create({
    data: { userId: user.id, accountId: user.id, providerId: "credential", password: await hashPassword(u.password) },
  });
  return { user, created: true };
}

export async function seedUsers(db: PrismaClient = prisma) {
  const ownerEmail = process.env.SEED_OWNER_EMAIL;
  const ownerPassword = process.env.SEED_OWNER_PASSWORD;
  if (!ownerEmail || !ownerPassword) {
    log("! SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD not set — owner account skipped");
  } else {
    const { created } = await ensureUser(db, {
      name: process.env.SEED_OWNER_NAME ?? "Owner",
      email: ownerEmail,
      password: ownerPassword,
      roleKey: "owner",
      pin: "1234",
    });
    log(`${created ? "✓ Created" : "• Exists"} owner ${ownerEmail}`);
  }

  if (process.env.SEED_DEMO_USERS === "true") {
    const pw = process.env.SEED_DEMO_PASSWORD ?? "Demo!2026pass";
    const demo = [
      { name: "Ayesha Khan", email: "manager@demo.local", roleKey: "manager", pin: "2222", phone: "+92 300 0000001" },
      { name: "Bilal Ahmed", email: "cashier@demo.local", roleKey: "cashier", pin: "3333", phone: "+92 300 0000002" },
      { name: "Usman Ali", email: "kitchen@demo.local", roleKey: "kitchen", pin: "4444", phone: "+92 300 0000003" },
      { name: "Hamid Raza", email: "rider@demo.local", roleKey: "rider", pin: "5555", phone: "+92 300 0000004" },
    ];
    for (const d of demo) {
      const { created } = await ensureUser(db, { ...d, password: pw });
      log(`${created ? "✓ Created" : "• Exists"} ${d.roleKey} ${d.email}`);
    }
  }
}

/** Demo restaurant data. Each module skips itself when real data already exists. */
export async function seedDemoData(db: PrismaClient = prisma) {
  await seedDemoMenu(db, log);
  const branch = await db.branch.findFirstOrThrow({ where: { code: "MAIN" } });
  await seedDemoOps(db, branch.id, log);
  await seedDemoInventory(db, branch.id, log);
  await seedDemoPeople(db, branch.id, log);
  // Past sales for the dashboard and reports (off in the end-to-end test database).
  if (process.env.SEED_DEMO_SALES !== "false") await seedDemoSales(db, branch.id, log);
}

async function main() {
  await seedFoundation();
  await seedUsers();
  if (process.env.SEED_DEMO_DATA === "true") await seedDemoData();
  log("Seed complete.");
}

// Run when executed directly (not when imported by tests).
const isDirect = process.argv[1] && /seed[\\/]index\.ts$/.test(process.argv[1]);
if (isDirect) {
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
