import "server-only";
import { z } from "zod";
import { db, withTransaction, Prisma, type Db } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";
import { authorize, authorizeAny } from "@/server/core/rbac";
import { recordAudit, diffObjects } from "@/server/core/audit";
import { notFound, validationFailed } from "@/server/core/errors";
import { zodFieldErrors } from "@/server/core/action";
import { normalizePhone } from "@/lib/phone";

export const customerSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(80),
  phone: z
    .string()
    .trim()
    .max(20)
    .refine((v) => v === "" || normalizePhone(v) !== null, "Enter a valid phone number")
    .optional()
    .default(""),
  email: z.union([z.email("Enter a valid e-mail"), z.literal("")]).optional().default(""),
  notes: z.string().trim().max(500).optional().default(""),
  marketingOptIn: z.boolean().optional().default(false),
  isBlocked: z.boolean().optional().default(false),
  blockReason: z.string().trim().max(200).optional().default(""),
});

export const addressSchema = z.object({
  label: z.string().trim().max(30).optional().default("Home"),
  addressLine: z.string().trim().min(5, "Enter the address").max(300),
  area: z.string().trim().max(80).optional().default(""),
  city: z.string().trim().max(80).optional().default(""),
  landmark: z.string().trim().max(120).optional().default(""),
  mapUrl: z.string().trim().max(500).optional().default(""),
  zoneId: z.uuid().nullable().optional(),
  isDefault: z.boolean().optional().default(false),
});

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw validationFailed(zodFieldErrors(r.error));
  return r.data;
}

export type CustomerSummary = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  isBlocked: boolean;
  totalOrders: number;
  totalSpent: string;
  lastOrderAt: Date | null;
  loyaltyPoints: number;
  addresses: { id: string; label: string; addressLine: string; area: string | null; landmark: string | null; mapUrl: string | null; zoneId: string | null; isDefault: boolean }[];
};

function toSummary(c: Prisma.CustomerGetPayload<{ include: { addresses: true } }>): CustomerSummary {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    isBlocked: c.isBlocked,
    totalOrders: c.totalOrders,
    totalSpent: c.totalSpent.toFixed(2),
    lastOrderAt: c.lastOrderAt,
    loyaltyPoints: c.loyaltyPoints,
    addresses: c.addresses
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
      .map((a) => ({ id: a.id, label: a.label, addressLine: a.addressLine, area: a.area, landmark: a.landmark, mapUrl: a.mapUrl, zoneId: a.zoneId, isDefault: a.isDefault })),
  };
}

/** Fast lookup for POS and phone orders: by phone digits or name. */
export async function searchCustomers(ctx: Ctx, q: string): Promise<CustomerSummary[]> {
  authorize(ctx, "customers.view");
  const term = q.trim();
  if (term.length < 2) return [];
  const digits = term.replace(/\D/g, "");
  const phoneTail = digits.length >= 4 ? digits.replace(/^0+/, "").slice(-10) : null;
  const rows = await db.customer.findMany({
    where: {
      OR: [
        ...(phoneTail ? [{ phone: { contains: phoneTail } }] : []),
        { name: { contains: term, mode: "insensitive" as const } },
      ],
    },
    orderBy: [{ lastOrderAt: { sort: "desc", nulls: "last" } }],
    take: 10,
    include: { addresses: true },
  });
  return rows.map(toSummary);
}

/** Find by phone or create. Used when an order names a new customer. */
export async function findOrCreateCustomer(tx: Db, data: { name: string; phone: string | null }, ctx: Ctx | null) {
  if (data.phone) {
    const existing = await tx.customer.findUnique({ where: { phone: data.phone } });
    if (existing) {
      if (data.name && existing.name !== data.name && existing.name === "Walk-in") {
        return tx.customer.update({ where: { id: existing.id }, data: { name: data.name } });
      }
      return existing;
    }
  }
  const created = await tx.customer.create({ data: { name: data.name || "Customer", phone: data.phone } });
  await recordAudit(tx, ctx, { action: "customer.create", module: "customers", entityType: "customer", entityId: created.id, after: { name: created.name } });
  return created;
}

export async function createCustomer(ctx: Ctx, input: unknown, address?: unknown): Promise<CustomerSummary> {
  authorize(ctx, "customers.manage");
  const data = parse(customerSchema, input);
  const addr = address ? parse(addressSchema, address) : null;
  const phone = data.phone ? normalizePhone(data.phone) : null;
  return withTransaction(async (tx) => {
    if (phone && (await tx.customer.findUnique({ where: { phone } }))) {
      throw validationFailed({ phone: ["A customer with this phone number already exists"] });
    }
    const c = await tx.customer.create({
      data: {
        name: data.name,
        phone,
        email: data.email || null,
        notes: data.notes || null,
        marketingOptIn: data.marketingOptIn,
        addresses: addr ? { create: [{ ...addr, area: addr.area || null, city: addr.city || null, landmark: addr.landmark || null, mapUrl: addr.mapUrl || null, zoneId: addr.zoneId ?? null, isDefault: true }] } : undefined,
      },
      include: { addresses: true },
    });
    await recordAudit(tx, ctx, { action: "customer.create", module: "customers", entityType: "customer", entityId: c.id, after: { name: c.name, phone } });
    return toSummary(c);
  });
}

export async function updateCustomer(ctx: Ctx, id: string, input: unknown): Promise<CustomerSummary> {
  authorize(ctx, "customers.manage");
  const data = parse(customerSchema, input);
  const phone = data.phone ? normalizePhone(data.phone) : null;
  return withTransaction(async (tx) => {
    const current = await tx.customer.findUnique({ where: { id } });
    if (!current) throw notFound("Customer");
    if (data.isBlocked !== current.isBlocked) authorize(ctx, "customers.delete");
    if (phone && phone !== current.phone && (await tx.customer.findUnique({ where: { phone } }))) {
      throw validationFailed({ phone: ["Another customer has this phone number"] });
    }
    const c = await tx.customer.update({
      where: { id },
      data: {
        name: data.name,
        phone,
        email: data.email || null,
        notes: data.notes || null,
        marketingOptIn: data.marketingOptIn,
        isBlocked: data.isBlocked,
        blockReason: data.isBlocked ? data.blockReason || null : null,
      },
      include: { addresses: true },
    });
    const diff = diffObjects(
      { name: current.name, phone: current.phone, email: current.email, isBlocked: current.isBlocked },
      { name: c.name, phone: c.phone, email: c.email, isBlocked: c.isBlocked },
    );
    if (Object.keys(diff.after).length) {
      await recordAudit(tx, ctx, { action: "customer.update", module: "customers", entityType: "customer", entityId: id, ...diff });
    }
    return toSummary(c);
  });
}

export async function addCustomerAddress(ctx: Ctx, customerId: string, input: unknown) {
  authorize(ctx, "customers.manage");
  const a = parse(addressSchema, input);
  return withTransaction(async (tx) => {
    const c = await tx.customer.findUnique({ where: { id: customerId } });
    if (!c) throw notFound("Customer");
    const count = await tx.customerAddress.count({ where: { customerId } });
    if (a.isDefault || count === 0) await tx.customerAddress.updateMany({ where: { customerId }, data: { isDefault: false } });
    return tx.customerAddress.create({
      data: {
        customerId,
        label: a.label,
        addressLine: a.addressLine,
        area: a.area || null,
        city: a.city || null,
        landmark: a.landmark || null,
        mapUrl: a.mapUrl || null,
        zoneId: a.zoneId ?? null,
        isDefault: a.isDefault || count === 0,
      },
    });
  });
}

export async function deleteCustomerAddress(ctx: Ctx, addressId: string) {
  authorize(ctx, "customers.manage");
  await db.customerAddress.delete({ where: { id: addressId } }).catch(() => {
    throw notFound("Address");
  });
}

export type CustomerListRow = CustomerSummary & { createdAt: Date };

export async function listCustomers(
  ctx: Ctx,
  opts: { q?: string; sort?: "recent" | "spend" | "orders" | "name"; page?: number } = {},
): Promise<{ rows: CustomerListRow[]; total: number; page: number; pageSize: number }> {
  authorize(ctx, "customers.view");
  const pageSize = 50;
  const page = Math.max(1, opts.page ?? 1);
  const q = opts.q?.trim();
  const digits = q?.replace(/\D/g, "") ?? "";
  const where: Prisma.CustomerWhereInput = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          ...(digits.length >= 4 ? [{ phone: { contains: digits.replace(/^0+/, "").slice(-10) } }] : []),
          { email: { contains: q, mode: "insensitive" } },
        ],
      }
    : {};
  const orderBy: Prisma.CustomerOrderByWithRelationInput[] =
    opts.sort === "spend"
      ? [{ totalSpent: "desc" }]
      : opts.sort === "orders"
        ? [{ totalOrders: "desc" }]
        : opts.sort === "name"
          ? [{ name: "asc" }]
          : [{ lastOrderAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }];
  const [rows, total] = await Promise.all([
    db.customer.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize, include: { addresses: true } }),
    db.customer.count({ where }),
  ]);
  return { rows: rows.map((c) => ({ ...toSummary(c), createdAt: c.createdAt })), total, page, pageSize };
}

export async function getCustomer(ctx: Ctx, id: string) {
  authorizeAny(ctx, ["customers.view"]);
  const c = await db.customer.findUnique({ where: { id }, include: { addresses: true } });
  if (!c) throw notFound("Customer");
  const [orders, favourites] = await Promise.all([
    db.order.findMany({
      where: { customerId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, orderNumber: true, createdAt: true, status: true, type: true, source: true, grandTotal: true, paymentStatus: true },
    }),
    db.orderItem.groupBy({
      by: ["productName"],
      where: { order: { customerId: id, status: { notIn: ["CANCELLED"] } } },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 5,
    }),
  ]);
  return {
    ...toSummary(c),
    notes: c.notes,
    marketingOptIn: c.marketingOptIn,
    blockReason: c.blockReason,
    createdAt: c.createdAt,
    orders: orders.map((o) => ({ ...o, grandTotal: o.grandTotal.toFixed(2) })),
    favourites: favourites.map((f) => ({ name: f.productName, quantity: f._sum.quantity ?? 0 })),
  };
}
