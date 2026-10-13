import "server-only";
import { z } from "zod";
import { db, withTransaction } from "@/server/core/db";
import { getContext, type Ctx } from "@/server/core/context";
import { consumeThrottle } from "@/server/core/throttle";
import { forbidden, notFound, unauthenticated, validationFailed } from "@/server/core/errors";
import { zodFieldErrors } from "@/server/core/action";
import { hashSecret } from "@/server/core/password";
import { recordAudit } from "@/server/core/audit";
import { normalizePhone } from "@/lib/phone";
import { passwordSchema } from "@/server/modules/users/schemas";
import { addressSchema } from "@/server/modules/customers/service";

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(80),
  phone: z
    .string()
    .trim()
    .refine((v) => normalizePhone(v) !== null, "Enter a valid mobile number"),
  email: z.email("Enter a valid e-mail").trim().toLowerCase(),
  password: passwordSchema,
  marketingOptIn: z.boolean().optional().default(false),
});

/**
 * Create a customer login. If phone orders already exist for this number, the
 * account is linked to that customer record, but the account only shows
 * orders and addresses from now on until the phone is verified.
 */
export async function registerCustomer(raw: unknown, ip: string | null) {
  const r = registerSchema.safeParse(raw);
  if (!r.success) throw validationFailed(zodFieldErrors(r.error));
  const data = r.data;
  await consumeThrottle(`register:${ip ?? "unknown"}`, 5, 3600);
  const phone = normalizePhone(data.phone)!;
  const passwordHash = await hashSecret(data.password);

  return withTransaction(async (tx) => {
    if (await tx.user.findFirst({ where: { email: { equals: data.email, mode: "insensitive" } }, select: { id: true } })) {
      throw validationFailed({ email: ["An account with this e-mail already exists. Try signing in."] });
    }
    const existing = await tx.customer.findUnique({ where: { phone } });
    if (existing?.userId) throw validationFailed({ phone: ["This number already has an account. Try signing in."] });

    const user = await tx.user.create({
      data: { name: data.name, email: data.email, phone: null, kind: "CUSTOMER", status: "ACTIVE", emailVerified: false },
    });
    await tx.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: passwordHash } });
    const now = new Date();
    const customer = existing
      ? await tx.customer.update({
          where: { id: existing.id },
          data: { userId: user.id, linkedAt: now, email: data.email, marketingOptIn: data.marketingOptIn || existing.marketingOptIn },
        })
      : await tx.customer.create({
          data: { userId: user.id, name: data.name, phone, email: data.email, marketingOptIn: data.marketingOptIn, linkedAt: now },
        });
    await recordAudit(tx, null, { action: "customer.register", module: "customers", entityType: "customer", entityId: customer.id, after: { linkedExisting: !!existing } });
    return { userId: user.id, customerId: customer.id };
  });
}

export type CustomerSession = { ctx: Ctx; customer: { id: string; name: string; phone: string | null; email: string | null; linkedAt: Date | null; phoneVerifiedAt: Date | null; loyaltyPoints: number } };

/** The signed-in customer, or null (staff sessions are not customers). */
export async function getCustomerSession(): Promise<CustomerSession | null> {
  const ctx = await getContext();
  if (!ctx || ctx.user.kind !== "CUSTOMER") return null;
  const customer = await db.customer.findUnique({
    where: { userId: ctx.user.id },
    select: { id: true, name: true, phone: true, email: true, linkedAt: true, phoneVerifiedAt: true, loyaltyPoints: true },
  });
  if (!customer) return null;
  return { ctx, customer };
}

export async function requireCustomer(): Promise<CustomerSession> {
  const s = await getCustomerSession();
  if (!s) throw unauthenticated();
  return s;
}

/** Orders visible to the account holder (see linking rule above). */
function visibleSince(c: CustomerSession["customer"]) {
  return c.phoneVerifiedAt ? undefined : (c.linkedAt ?? undefined);
}

export async function listMyOrders(s: CustomerSession) {
  const since = visibleSince(s.customer);
  const rows = await db.order.findMany({
    where: { customerId: s.customer.id, ...(since ? { createdAt: { gte: since } } : {}) },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { items: { select: { quantity: true, productName: true } } },
  });
  return rows.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    type: o.type,
    createdAt: o.createdAt,
    grandTotal: o.grandTotal.toFixed(2),
    trackingToken: o.trackingToken,
    summary: o.items.map((i) => `${i.quantity}× ${i.productName}`).join(", "),
  }));
}

export async function getMyOrderLines(s: CustomerSession, orderId: string) {
  const since = visibleSince(s.customer);
  const o = await db.order.findFirst({
    where: { id: orderId, customerId: s.customer.id, ...(since ? { createdAt: { gte: since } } : {}) },
    include: { items: { include: { addons: true, removals: true } } },
  });
  if (!o) throw notFound("Order");
  return o.items.map((i) => ({
    productId: i.productId,
    variantId: i.variantId,
    quantity: i.quantity,
    addonIds: i.addons.map((a) => a.addonId),
    removableIds: i.removals.map((r) => r.removableOptionId).filter(Boolean) as string[],
    note: i.note ?? "",
  }));
}

export async function listMyAddresses(s: CustomerSession) {
  const since = visibleSince(s.customer);
  const rows = await db.customerAddress.findMany({
    where: { customerId: s.customer.id, ...(since ? { createdAt: { gte: since } } : {}) },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    include: { zone: { select: { name: true } } },
  });
  return rows.map((a) => ({
    id: a.id,
    label: a.label,
    addressLine: a.addressLine,
    landmark: a.landmark,
    mapUrl: a.mapUrl,
    zoneId: a.zoneId,
    zoneName: a.zone?.name ?? null,
    isDefault: a.isDefault,
  }));
}

export async function addMyAddress(s: CustomerSession, raw: unknown) {
  const r = addressSchema.safeParse(raw);
  if (!r.success) throw validationFailed(zodFieldErrors(r.error));
  const a = r.data;
  const count = await db.customerAddress.count({ where: { customerId: s.customer.id } });
  if (count >= 10) throw validationFailed({ addressLine: ["You can save up to 10 addresses"] });
  if (a.isDefault) await db.customerAddress.updateMany({ where: { customerId: s.customer.id }, data: { isDefault: false } });
  await db.customerAddress.create({
    data: {
      customerId: s.customer.id,
      label: a.label || "Home",
      addressLine: a.addressLine,
      landmark: a.landmark || null,
      mapUrl: a.mapUrl || null,
      zoneId: a.zoneId ?? null,
      isDefault: a.isDefault,
    },
  });
}

export async function deleteMyAddress(s: CustomerSession, id: string) {
  const res = await db.customerAddress.deleteMany({ where: { id, customerId: s.customer.id } });
  if (res.count === 0) throw forbidden();
}

export async function listMyFavorites(s: CustomerSession) {
  const rows = await db.customerFavorite.findMany({ where: { customerId: s.customer.id }, select: { productId: true } });
  return rows.map((r) => r.productId);
}

export async function toggleFavorite(s: CustomerSession, productId: string, on: boolean) {
  if (!z.uuid().safeParse(productId).success) throw validationFailed({ productId: ["Invalid product"] });
  if (on) {
    const exists = await db.product.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true } });
    if (!exists) throw notFound("Product");
    await db.customerFavorite.upsert({
      where: { customerId_productId: { customerId: s.customer.id, productId } },
      create: { customerId: s.customer.id, productId },
      update: {},
    });
  } else {
    await db.customerFavorite.deleteMany({ where: { customerId: s.customer.id, productId } });
  }
}

export const profileSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(80),
  marketingOptIn: z.boolean().default(false),
});

export async function updateMyProfile(s: CustomerSession, raw: unknown) {
  const r = profileSchema.safeParse(raw);
  if (!r.success) throw validationFailed(zodFieldErrors(r.error));
  await db.customer.update({ where: { id: s.customer.id }, data: { name: r.data.name, marketingOptIn: r.data.marketingOptIn } });
  await db.user.update({ where: { id: s.ctx.user.id }, data: { name: r.data.name } });
}

export async function getMyProfile(s: CustomerSession) {
  const c = await db.customer.findUniqueOrThrow({ where: { id: s.customer.id }, select: { name: true, phone: true, marketingOptIn: true } });
  return c;
}
