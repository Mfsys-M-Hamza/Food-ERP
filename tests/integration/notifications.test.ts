import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";
import { createOrder } from "@/server/modules/orders/service";
import { openShift, closeShift } from "@/server/modules/shifts/service";
import { placeOnlineOrder } from "@/server/modules/storefront/checkout";
import { myNotifications, markRead } from "@/server/modules/notifications/service";
import { dispatchOutbox, alertUnacceptedOrders, runJobs } from "@/server/modules/notifications/dispatcher";
import { requestPhoneOtp, verifyPhoneOtp } from "@/server/modules/storefront/otp";
import { updateSetting, getSetting } from "@/server/modules/settings/service";
import { resetDatabase, seedMenu, ctxForRole, counterTerminalId, productBySku } from "./helpers";

let owner: Ctx;
let manager: Ctx;
let cashier: Ctx;
let kitchen: Ctx;
let terminalId: string;

beforeEach(async () => {
  await resetDatabase();
  await seedMenu();
  owner = await ctxForRole("owner");
  manager = await ctxForRole("manager");
  cashier = await ctxForRole("cashier");
  kitchen = await ctxForRole("kitchen");
  terminalId = await counterTerminalId();
});

async function online(over: Record<string, unknown> = {}) {
  const z = await productBySku("BRG-ZNG");
  return placeOnlineOrder(
    { clientRequestId: randomUUID(), type: "TAKEAWAY", name: "Sana", phone: "03211234567", paymentMethod: "PAY_AT_PICKUP", items: [{ productId: z.id, quantity: 1 }], ...over },
    null,
    { ip: "9.9.9.9", userAgent: "t" },
  );
}

describe("notifications", () => {
  it("turns a new online order into alerts for staff who can accept orders, once", async () => {
    const o = await online();
    const r = await dispatchOutbox();
    expect(r.done).toBeGreaterThan(0);
    const mine = await myNotifications(cashier);
    expect(mine.unread).toBe(1);
    expect(mine.items[0]).toMatchObject({ title: `New online order #${o.displayNumber}`, link: "/pos", severity: "WARNING" });
    expect((await myNotifications(owner)).unread).toBe(1);
    // Kitchen staff cannot accept orders.
    expect((await myNotifications(kitchen)).unread).toBe(0);
    // Re-running finds nothing new (events are claimed once).
    expect((await dispatchOutbox()).claimed).toBe(0);
    await markRead(cashier, "all");
    expect((await myNotifications(cashier)).unread).toBe(0);
    // Another user's notification cannot be marked by someone else.
    const other = await db.notification.findFirstOrThrow({ where: { userId: owner.user.id } });
    expect((await markRead(cashier, other.id)).updated).toBe(0);
  });

  it("raises an urgent alert when an online order waits too long, without repeating it", async () => {
    await updateSetting(owner, "ordering", { ...(await getSetting("ordering")), unacceptedAlertMinutes: 5 });
    await online();
    expect(await alertUnacceptedOrders()).toBe(0);
    const later = new Date(Date.now() + 6 * 60_000);
    await alertUnacceptedOrders(later);
    await alertUnacceptedOrders(later);
    const urgent = await db.notification.findMany({ where: { userId: manager.user.id, type: "order.unaccepted" } });
    expect(urgent).toHaveLength(1);
    expect(urgent[0]!.severity).toBe("CRITICAL");
    expect(await db.outboundMessage.count()).toBe(0); // e-mail / SMS escalation is off by default
  });

  it("alerts managers about a short shift, and the job runner is safe to call", async () => {
    const shift = await openShift(cashier, { terminalId, openingCash: "5000" });
    await closeShift(cashier, { shiftId: shift.id, countedCash: "4000", note: "Short" });
    await runJobs({ force: true });
    const n = await db.notification.findFirst({ where: { userId: manager.user.id, type: "shift.difference" } });
    expect(n?.title).toMatch(/1,?000 short/);
  });
});

describe("phone verification", () => {
  async function customerSession() {
    const user = await db.user.create({ data: { name: "Hira", email: `hira${Date.now()}@test.local`, kind: "CUSTOMER", status: "ACTIVE", emailVerified: true } });
    const customer = await db.customer.create({ data: { userId: user.id, name: "Hira", phone: "+923007654321", linkedAt: new Date() } });
    const ctx = { ...owner, user: { id: user.id, name: "Hira", email: user.email, kind: "CUSTOMER" as const }, roles: [], permissions: new Set<never>(), isOwner: false };
    return { ctx, customer: { id: customer.id, name: "Hira", phone: customer.phone, email: null, linkedAt: customer.linkedAt, phoneVerifiedAt: null, loyaltyPoints: 0 } };
  }

  it("verifies with the right code, counts wrong attempts and never stores the code", async () => {
    const s = await customerSession();
    const r = await requestPhoneOtp(s, "1.2.3.4");
    expect(r.devCode).toMatch(/^\d{6}$/);
    const row = await db.otpCode.findFirstOrThrow();
    expect(row.codeHash).not.toContain(r.devCode!);
    const wrong = r.devCode === "000000" ? "111111" : "000000";
    expect(await verifyPhoneOtp(s, { code: wrong })).toMatchObject({ verified: false, attemptsLeft: 4 });
    expect(await verifyPhoneOtp(s, { code: r.devCode })).toMatchObject({ verified: true });
    expect((await db.customer.findUniqueOrThrow({ where: { id: s.customer.id } })).phoneVerifiedAt).not.toBeNull();
    await expect(verifyPhoneOtp(s, { code: r.devCode })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("throttles code requests per phone", async () => {
    const s = await customerSession();
    await requestPhoneOtp(s, "1.1.1.1");
    await requestPhoneOtp(s, "1.1.1.2");
    await requestPhoneOtp(s, "1.1.1.3");
    await expect(requestPhoneOtp(s, "1.1.1.4")).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("online points need a verified phone", async () => {
    await updateSetting(owner, "loyalty", { enabled: true, spendPerPoint: "100", pointValue: "1", minimumRedeemPoints: 1, maxRedeemPercent: 50, expiryDays: 0 });
    const s = await customerSession();
    await db.customer.update({ where: { id: s.customer.id }, data: { loyaltyPoints: 50 } });
    await db.loyaltyTransaction.create({ data: { customerId: s.customer.id, type: "ADJUST", points: 50, balanceAfter: 50 } });
    const z = await productBySku("BRG-ZNG");
    const input = { clientRequestId: randomUUID(), type: "TAKEAWAY", name: "Hira", phone: "03007654321", paymentMethod: "PAY_AT_PICKUP", items: [{ productId: z.id, quantity: 1 }], redeemPoints: 20 };
    await expect(placeOnlineOrder(input, { ctx: s.ctx, customerId: s.customer.id }, { ip: "1.1.1.9", userAgent: "t" })).rejects.toThrow(/Verify your phone/);
    await db.customer.update({ where: { id: s.customer.id }, data: { phoneVerifiedAt: new Date() } });
    const o = await placeOnlineOrder({ ...input, clientRequestId: randomUUID() }, { ctx: s.ctx, customerId: s.customer.id }, { ip: "1.1.1.9", userAgent: "t" });
    expect(o.discountTotal).toBe("20.00");
  });
});

describe("offline POS sync", () => {
  it("keeps the business day of the sale and is idempotent", async () => {
    await openShift(cashier, { terminalId, openingCash: "1000" });
    const z = await productBySku("BRG-ZNG");
    const at = new Date(Date.now() - 30 * 60_000).toISOString();
    const input = { clientRequestId: randomUUID(), source: "POS", type: "TAKEAWAY", terminalId, items: [{ productId: z.id, quantity: 1 }], payments: [{ method: "CASH", amount: "590" }], offlineCreatedAt: at };
    const a = await createOrder(cashier, input);
    const b = await createOrder(cashier, input);
    expect(a.id).toBe(b.id);
    expect((await db.order.findUniqueOrThrow({ where: { id: a.id } })).offlineCreatedAt?.toISOString()).toBe(at);
    await expect(createOrder(cashier, { ...input, clientRequestId: randomUUID(), offlineCreatedAt: new Date(Date.now() - 72 * 3_600_000).toISOString() })).rejects.toThrow(/too old/);
  });
});
