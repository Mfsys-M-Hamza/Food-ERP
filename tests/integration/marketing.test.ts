import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";
import { createOrder, cancelOrder, transitionOrder, refundOrder, quoteOrder } from "@/server/modules/orders/service";
import { openShift } from "@/server/modules/shifts/service";
import { saveCoupon } from "@/server/modules/marketing/coupons";
import { adjustPoints, customerLoyalty, expirePoints } from "@/server/modules/marketing/loyalty";
import { updateSetting } from "@/server/modules/settings/service";
import { placeOnlineOrder } from "@/server/modules/storefront/checkout";
import { saveZone } from "@/server/modules/delivery/zones";
import { resetDatabase, seedMenu, ctxForRole, counterTerminalId, productBySku } from "./helpers";

let owner: Ctx;
let cashier: Ctx;
let terminalId: string;

beforeEach(async () => {
  await resetDatabase();
  await seedMenu();
  owner = await ctxForRole("owner");
  cashier = await ctxForRole("cashier");
  terminalId = await counterTerminalId();
  await openShift(cashier, { terminalId, openingCash: "5000" });
});

const zinger = async (quantity = 1) => ({ productId: (await productBySku("BRG-ZNG")).id, quantity }); // 590
const pos = async (over: Record<string, unknown> = {}, qty = 2) => ({ clientRequestId: randomUUID(), source: "POS", type: "TAKEAWAY", terminalId, items: [await zinger(qty)], ...over });
const coupon = (over: Record<string, unknown> = {}) => saveCoupon(owner, null, { code: "SAVE10", type: "PERCENT", value: "10", minOrder: "500", ...over });

describe("coupons", () => {
  it("applies a percentage coupon with a cap and counts the use", async () => {
    await coupon({ maxDiscount: "100" });
    const o = await createOrder(cashier, await pos({ couponCode: "save10", payments: [{ method: "CARD", amount: "1080" }] }));
    expect(o).toMatchObject({ subtotal: "1180.00", discountTotal: "100.00", grandTotal: "1080.00" });
    const c = await db.coupon.findFirstOrThrow();
    expect(c.usedCount).toBe(1);
    expect(await db.couponRedemption.count()).toBe(1);
    expect((await db.orderDiscount.findFirstOrThrow({ where: { kind: "COUPON" } })).amount.toString()).toBe("100");
  });

  it("enforces minimum order, dates, channel, limits and no stacking with staff discounts", async () => {
    await coupon({ usageLimit: 1, channel: "POS" });
    await createOrder(cashier, await pos({ couponCode: "SAVE10", payments: [{ method: "CARD", amount: "1062" }] }));
    // Fully used now.
    await expect(quoteOrder(cashier, { items: [await zinger(2)], type: "TAKEAWAY", couponCode: "SAVE10" }, "POS")).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await saveCoupon(owner, null, { code: "BIG", type: "AMOUNT", value: "200", minOrder: "5000" });
    await expect(quoteOrder(cashier, { items: [await zinger(2)], type: "TAKEAWAY", couponCode: "BIG" }, "POS")).rejects.toThrow(/more to use this coupon/);
    await saveCoupon(owner, null, { code: "LATER", type: "AMOUNT", value: "50", startsAt: "2999-01-01T10:00" });
    await expect(quoteOrder(cashier, { items: [await zinger(2)], type: "TAKEAWAY", couponCode: "LATER" }, "POS")).rejects.toThrow(/not active yet/);
    await saveCoupon(owner, null, { code: "WEB", type: "AMOUNT", value: "50", channel: "ONLINE" });
    await expect(quoteOrder(cashier, { items: [await zinger(2)], type: "TAKEAWAY", couponCode: "WEB" }, "POS")).rejects.toThrow(/online orders only/);
    await saveCoupon(owner, null, { code: "FLAT", type: "AMOUNT", value: "50" });
    await expect(createOrder(cashier, await pos({ couponCode: "FLAT", discount: { type: "PERCENT", value: "5", reason: "x" } }))).rejects.toThrow(/cannot be combined/);
    await expect(quoteOrder(cashier, { items: [await zinger(2)], type: "TAKEAWAY", couponCode: "NOPE" }, "POS")).rejects.toThrow(/not valid/);
  });

  it("limits per customer by phone and gives the use back when the order is cancelled", async () => {
    await coupon({ perCustomerLimit: 1 });
    const customer = { name: "Ali", phone: "03001234567" };
    await expect(createOrder(cashier, await pos({ couponCode: "SAVE10" }))).rejects.toThrow(/phone number/);
    const first = await createOrder(cashier, await pos({ couponCode: "SAVE10", customer }));
    await expect(createOrder(cashier, await pos({ couponCode: "SAVE10", customer }))).rejects.toThrow(/already been used/);
    await cancelOrder(owner, first.id, { reason: "Mistake", terminalId });
    expect((await db.coupon.findFirstOrThrow()).usedCount).toBe(0);
    await expect(createOrder(cashier, await pos({ couponCode: "SAVE10", customer }))).resolves.toBeTruthy();
  });

  it("free-delivery coupons waive the delivery charge online", async () => {
    await saveZone(owner, null, { name: "Gulberg", charge: "150", minimumOrder: "0", estimatedMinutes: 30 });
    const zone = await db.deliveryZone.findFirstOrThrow();
    await saveCoupon(owner, null, { code: "FREEDEL", type: "FREE_DELIVERY", firstOrderOnly: true });
    const base = { clientRequestId: randomUUID(), type: "DELIVERY", name: "Sana", phone: "03211234567", zoneId: zone.id, addressLine: "House 1, Street 2", paymentMethod: "CASH_ON_DELIVERY", items: [await zinger(1)] };
    const o = await placeOnlineOrder({ ...base, couponCode: "FREEDEL" }, null, { ip: "1.2.3.4", userAgent: "t" });
    expect(o).toMatchObject({ deliveryCharge: "0.00", grandTotal: "590.00" });
    expect((await db.couponRedemption.findFirstOrThrow()).amount.toString()).toBe("150");
    await expect(placeOnlineOrder({ ...base, clientRequestId: randomUUID(), couponCode: "FREEDEL" }, null, { ip: "1.2.3.4", userAgent: "t" })).rejects.toThrow(/first order/);
  });
});

describe("loyalty", () => {
  beforeEach(async () => {
    await updateSetting(owner, "loyalty", { enabled: true, spendPerPoint: "100", pointValue: "1", minimumRedeemPoints: 10, maxRedeemPercent: 50, expiryDays: 365 });
  });

  async function completed(customer = { name: "Hira", phone: "03007654321" }, qty = 2) {
    const o = await createOrder(cashier, await pos({ customer, payments: [{ method: "CASH", amount: String(590 * qty) }] }, qty));
    await transitionOrder(owner, o.id, "PREPARING");
    await transitionOrder(owner, o.id, "READY");
    await transitionOrder(owner, o.id, "COMPLETED");
    return o;
  }

  it("earns points on completion, redeems them as a discount, and caps redemption", async () => {
    const o = await completed();
    const cust = await db.customer.findFirstOrThrow();
    expect(cust.loyaltyPoints).toBe(11); // 1180 / 100
    await expect(createOrder(cashier, await pos({ customerId: cust.id, redeemPoints: 5 }))).rejects.toThrow(/At least 10 points/);
    const r = await createOrder(cashier, await pos({ customerId: cust.id, redeemPoints: 11, payments: [{ method: "CASH", amount: "1169" }] }));
    expect(r).toMatchObject({ discountTotal: "11.00", grandTotal: "1169.00" });
    expect((await db.customer.findUniqueOrThrow({ where: { id: cust.id } })).loyaltyPoints).toBe(0);
    await expect(createOrder(cashier, await pos({ customerId: cust.id, redeemPoints: 10 }))).rejects.toThrow(/Only 0 points/);
    void o;
  });

  it("returns points when an order is cancelled and takes back points on a refund", async () => {
    const o = await completed();
    const cust = await db.customer.findFirstOrThrow();
    await adjustPoints(owner, cust.id, { points: 100, note: "Welcome gift" });
    const r = await createOrder(cashier, await pos({ customerId: cust.id, redeemPoints: 50, payments: [{ method: "CASH", amount: "1130" }] }));
    expect((await db.customer.findUniqueOrThrow({ where: { id: cust.id } })).loyaltyPoints).toBe(61);
    await cancelOrder(owner, r.id, { reason: "Changed mind", terminalId });
    expect((await db.customer.findUniqueOrThrow({ where: { id: cust.id } })).loyaltyPoints).toBe(111);
    await refundOrder(owner, o.id, { amount: "1180", method: "CARD", reason: "Wrong order" });
    expect((await db.customer.findUniqueOrThrow({ where: { id: cust.id } })).loyaltyPoints).toBe(100);
    const view = await customerLoyalty(owner, cust.id);
    expect(view.history.map((h) => h.type)).toEqual(["REVERSE_EARN", "REVERSE_REDEEM", "REDEEM", "ADJUST", "EARN"]);
    await expect(db.loyaltyTransaction.deleteMany({})).rejects.toThrow(/append-only/);
  });

  it("guests cannot spend points online, and points expire", async () => {
    await completed({ name: "Sana", phone: "03211234567" });
    const items = [await zinger(1)];
    const base = { clientRequestId: randomUUID(), type: "TAKEAWAY", name: "Sana", phone: "03211234567", paymentMethod: "PAY_AT_PICKUP", items, redeemPoints: 11 };
    const o = await placeOnlineOrder(base, null, { ip: "1.1.1.1", userAgent: "t" });
    expect(o.discountTotal).toBe("0.00"); // ignored for a guest
    await db.$executeRaw`UPDATE loyalty_transactions SET expires_at = now() - interval '1 day' WHERE type = 'EARN'`;
    const r = await expirePoints();
    expect(r.expired).toBe(11);
    expect((await db.customer.findFirstOrThrow({ where: { phone: "+923211234567" } })).loyaltyPoints).toBe(0);
  });
});
