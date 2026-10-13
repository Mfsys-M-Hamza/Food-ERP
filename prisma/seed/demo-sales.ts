/**
 * Eight weeks of demo sales history so the dashboard and reports have
 * something to show (skipped when any order exists). Orders are written
 * directly as completed and paid; stock is not deducted for them.
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "../../src/generated/prisma/client";

/** Small deterministic PRNG so every demo database looks the same. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOUR_WEIGHTS: [number, number][] = [
  [12, 4], [13, 9], [14, 7], [15, 3], [16, 3], [17, 4], [18, 6], [19, 9], [20, 12], [21, 12], [22, 9], [23, 5], [0, 2],
];

export async function seedDemoSales(db: PrismaClient, branchId: string, log: (m: string) => void, days = 56) {
  if (await db.order.count()) {
    log("• Demo sales skipped (orders exist)");
    return;
  }
  const products = await db.product.findMany({ where: { deletedAt: null, isActive: true }, include: { variants: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } } } });
  if (!products.length) return;
  const cashier = await db.user.findFirst({ where: { email: "cashier@demo.local" } });
  const customers = await db.customer.findMany({ take: 8 });
  const random = rng(20261012);
  const pick = <T,>(xs: T[]) => xs[Math.floor(random() * xs.length)]!;
  const weightedHour = () => {
    const total = HOUR_WEIGHTS.reduce((a, [, w]) => a + w, 0);
    let x = random() * total;
    for (const [h, w] of HOUR_WEIGHTS) if ((x -= w) <= 0) return h;
    return 20;
  };
  // Popular items sell more.
  const popular = [...products].sort((a, b) => Number(b.basePrice ?? 0) - Number(a.basePrice ?? 0));
  const weighted = [...popular.slice(0, 6), ...popular.slice(0, 6), ...popular];

  const now = new Date(Date.now() + 5 * 3_600_000); // Karachi
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const orders: Prisma.OrderCreateManyInput[] = [];
  const items: { id: string; orderId: string; productId: string; variantId: string | null; productName: string; variantName: string | null; sku: string; categoryId: string | null; quantity: number; unitPrice: number; lineTotal: number; unitCostEstimate: number; sortOrder: number; createdAt: Date }[] = [];
  const payments: { branchId: string; orderId: string; method: "CASH" | "CARD" | "ONLINE"; amount: number; status: "SUCCEEDED"; receivedById: string | null; createdAt: Date }[] = [];
  const customerTotals = new Map<string, { n: number; spent: number; last: Date }>();

  for (let d = days; d >= 1; d--) {
    const day = new Date(todayUtc - d * 86_400_000);
    const iso = day.toISOString().slice(0, 10);
    const compact = iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10);
    const weekend = day.getUTCDay() === 5 || day.getUTCDay() === 6 || day.getUTCDay() === 0;
    const growth = 1 + (days - d) / (days * 4); // gentle upward trend
    const count = Math.round((24 + random() * 14) * (weekend ? 1.35 : 1) * growth);
    for (let n = 1; n <= count; n++) {
      const hour = weightedHour();
      const minute = Math.floor(random() * 60);
      // Business day: after-midnight orders belong to the previous date.
      const created = new Date(day.getTime() + (hour < 5 ? 24 + hour : hour) * 3_600_000 + minute * 60_000 - 5 * 3_600_000);
      const id = randomUUID();
      const delivery = random() < 0.3;
      const lineCount = 1 + Math.floor(random() * 3);
      let subtotal = 0;
      let cost = 0;
      for (let i = 0; i < lineCount; i++) {
        const p = pick(weighted);
        const v = p.variants.length ? pick(p.variants) : null;
        const price = Number(v?.price ?? p.basePrice ?? 0);
        const unitCost = Number(v?.cost ?? p.cost ?? 0);
        const qty = random() < 0.25 ? 2 : 1;
        subtotal += price * qty;
        cost += unitCost * qty;
        items.push({ id: randomUUID(), orderId: id, productId: p.id, variantId: v?.id ?? null, productName: p.name, variantName: v?.name ?? null, sku: v?.sku ?? p.sku ?? "", categoryId: p.categoryId, quantity: qty, unitPrice: price, lineTotal: price * qty, unitCostEstimate: unitCost, sortOrder: i, createdAt: created });
      }
      const discount = random() < 0.07 ? Math.round(subtotal * 0.1) : 0;
      const deliveryCharge = delivery ? pick([120, 150, 180, 200]) : 0;
      const grand = subtotal - discount + deliveryCharge;
      const online = delivery && random() < 0.55;
      const method = online ? (random() < 0.5 ? "ONLINE" : "CASH") : random() < 0.75 ? "CASH" : "CARD";
      const customer = delivery || random() < 0.2 ? pick(customers) : null;
      orders.push({
        id,
        branchId,
        orderNumber: `${compact}-${String(n).padStart(4, "0")}`,
        displayNumber: n,
        businessDate: new Date(`${iso}T00:00:00Z`),
        source: online ? pick(["WEBSITE", "PWA"] as const) : delivery ? "PHONE" : "POS",
        type: delivery ? "DELIVERY" : "TAKEAWAY",
        status: "COMPLETED",
        paymentStatus: "PAID",
        customerId: customer?.id ?? null,
        customerName: customer?.name ?? null,
        customerPhone: customer?.phone ?? null,
        createdById: online ? null : (cashier?.id ?? null),
        subtotal,
        discountTotal: discount,
        deliveryCharge,
        grandTotal: grand,
        amountPaid: grand,
        estimatedCostTotal: cost,
        acceptedAt: created,
        completedAt: new Date(created.getTime() + (delivery ? 45 : 15) * 60_000),
        idempotencyKey: `demo-${id}`,
        trackingToken: randomBytes(18).toString("base64url"),
        createdAt: created,
        updatedAt: created,
      });
      payments.push({ branchId, orderId: id, method, amount: grand, status: "SUCCEEDED", receivedById: cashier?.id ?? null, createdAt: created });
      if (customer) {
        const c = customerTotals.get(customer.id) ?? { n: 0, spent: 0, last: created };
        customerTotals.set(customer.id, { n: c.n + 1, spent: c.spent + grand, last: created > c.last ? created : c.last });
      }
    }
  }
  for (let i = 0; i < orders.length; i += 500) await db.order.createMany({ data: orders.slice(i, i + 500) });
  for (let i = 0; i < items.length; i += 1000) await db.orderItem.createMany({ data: items.slice(i, i + 1000) });
  for (let i = 0; i < payments.length; i += 1000) await db.payment.createMany({ data: payments.slice(i, i + 1000) });
  for (const [id, t] of customerTotals) {
    await db.customer.update({ where: { id }, data: { totalOrders: { increment: t.n }, totalSpent: { increment: t.spent }, lastOrderAt: t.last } });
  }
  log(`✓ ${orders.length} demo orders over ${days} days`);
}
