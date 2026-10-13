import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";
import { buildContext } from "@/server/core/context";
import { placeOnlineOrder, getTracking, quoteOnline } from "@/server/modules/storefront/checkout";
import { getStoreStatus, setOnlinePause } from "@/server/modules/storefront/store";
import { registerCustomer, listMyOrders, listMyAddresses, type CustomerSession } from "@/server/modules/storefront/account";
import { createOrder } from "@/server/modules/orders/service";
import { updateSetting, getSetting } from "@/server/modules/settings/service";
import { listZones } from "@/server/modules/delivery/zones";
import { resetDatabase, seedMenu, ctxForRole, productBySku } from "./helpers";

let owner: Ctx;
const ip = () => `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

async function openAllDay() {
  await db.businessHour.updateMany({ data: { opensAt: "00:00", closesAt: "00:00", isClosed: false } });
}

beforeEach(async () => {
  await resetDatabase();
  await seedMenu();
  const { seedDemoOps } = await import("../../prisma/seed/demo-ops");
  owner = await ctxForRole("owner");
  await seedDemoOps(db as never, owner.branchId, () => {});
  await openAllDay();
});

async function checkoutInput(over: Record<string, unknown> = {}) {
  const p = await productBySku("BRG-ZNG");
  const zones = await listZones(owner.branchId);
  return {
    clientRequestId: randomUUID(),
    type: "DELIVERY",
    name: "Online Guest",
    phone: "0333 1234567",
    zoneId: zones.find((z) => z.name === "Gulberg")!.id,
    addressLine: "House 9, Main Boulevard, Gulberg",
    paymentMethod: "CASH_ON_DELIVERY",
    items: [{ productId: p.id, quantity: 2 }],
    ...over,
  };
}

describe("online checkout", () => {
  it("lets a guest place a delivery order that waits for acceptance", async () => {
    const o = await placeOnlineOrder(await checkoutInput(), null, { ip: ip(), userAgent: "test" });
    expect(o).toMatchObject({ source: "WEBSITE", status: "NEW", paymentStatus: "UNPAID", grandTotal: "1300.00", deliveryCharge: "120.00" });
    expect(o.createdBy).toBeNull();
    const c = await db.customer.findUniqueOrThrow({ where: { phone: "+923331234567" } });
    expect(c.userId).toBeNull();
  });

  it("quotes the same total the order will have", async () => {
    const input = await checkoutInput();
    const q = await quoteOnline({ type: input.type, zoneId: input.zoneId, items: input.items }, ip());
    expect(q.grandTotal).toBe("1300.00");
    expect(q.minimumOrder).toBe("500.00");
  });

  it("enforces the area minimum and requires a valid phone and address", async () => {
    const water = await productBySku("DR-WTR");
    await expect(placeOnlineOrder(await checkoutInput({ items: [{ productId: water.id, quantity: 1 }] }), null, { ip: ip(), userAgent: null })).rejects.toMatchObject({
      message: expect.stringMatching(/Minimum order/),
    });
    const bad = await placeOnlineOrder(await checkoutInput({ phone: "12", addressLine: "" }), null, { ip: ip(), userAgent: null }).catch((e) => e);
    expect(bad.fieldErrors.phone).toBeDefined();
    expect(bad.fieldErrors.addressLine).toBeDefined();
  });

  it("refuses orders when online ordering is off, closed or paused", async () => {
    await updateSetting(owner, "ordering", { ...(await getSetting("ordering")), onlineOrderingEnabled: false });
    expect((await getStoreStatus()).accepting).toBe(false);
    await expect(placeOnlineOrder(await checkoutInput(), null, { ip: ip(), userAgent: null })).rejects.toMatchObject({ code: "INVALID_STATE" });

    await updateSetting(owner, "ordering", { ...(await getSetting("ordering")), onlineOrderingEnabled: true });
    const cashier = await ctxForRole("cashier");
    await setOnlinePause(cashier, 30);
    expect(await getStoreStatus()).toMatchObject({ accepting: false, open: true });
    await setOnlinePause(cashier, 0);
    expect((await getStoreStatus()).accepting).toBe(true);

    await db.businessHour.updateMany({ data: { isClosed: true } });
    expect((await getStoreStatus()).accepting).toBe(false);
  });

  it("blocks customers flagged for fake orders", async () => {
    await placeOnlineOrder(await checkoutInput(), null, { ip: ip(), userAgent: null });
    await db.customer.update({ where: { phone: "+923331234567" }, data: { isBlocked: true } });
    await expect(placeOnlineOrder(await checkoutInput(), null, { ip: ip(), userAgent: null })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("throttles repeated checkouts from one address", async () => {
    const same = ip();
    for (let i = 0; i < 8; i++) await placeOnlineOrder(await checkoutInput(), null, { ip: same, userAgent: null });
    await expect(placeOnlineOrder(await checkoutInput(), null, { ip: same, userAgent: null })).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("tracks by secret token without exposing phone or address", async () => {
    const o = await placeOnlineOrder(await checkoutInput(), null, { ip: ip(), userAgent: null });
    const t = await getTracking(o.trackingToken);
    expect(t).toMatchObject({ displayNumber: o.displayNumber, status: "NEW", grandTotal: "1300.00", area: "Gulberg", customerFirstName: "Online" });
    const json = JSON.stringify(t);
    expect(json).not.toContain("3331234567");
    expect(json).not.toContain("Main Boulevard");
    expect(await getTracking("not-a-real-token-123")).toBeNull();
  });
});

describe("customer accounts", () => {
  it("registers, links an existing phone customer, and hides history from before linking", async () => {
    const cashier = await ctxForRole("cashier");
    const zinger = await productBySku("BRG-ZNG");
    // A phone order placed before the account existed
    await createOrder(cashier, {
      clientRequestId: randomUUID(),
      source: "PHONE",
      type: "DELIVERY",
      customer: { name: "Sana Tariq", phone: "+923001110002" },
      delivery: { addressLine: "Old secret address 123" },
      items: [{ productId: zinger.id, quantity: 1 }],
    });

    const { userId, customerId } = await registerCustomer(
      { name: "Sana T", phone: "0300-1110002", email: "sana@example.com", password: "Password1234" },
      ip(),
    );
    const c = await db.customer.findUniqueOrThrow({ where: { id: customerId } });
    expect(c.userId).toBe(userId);
    const session: CustomerSession = {
      ctx: (await buildContext(userId))!,
      customer: { id: c.id, name: c.name, phone: c.phone, email: c.email, linkedAt: c.linkedAt, phoneVerifiedAt: null, loyaltyPoints: 0 },
    };
    expect(await listMyOrders(session)).toEqual([]);
    expect((await listMyAddresses(session)).map((a) => a.addressLine)).not.toContain("Old secret address 123");

    await new Promise((r) => setTimeout(r, 5));
    const o = await placeOnlineOrder(await checkoutInput({ name: "Sana T", phone: "03001110002" }), { ctx: session.ctx, customerId }, { ip: ip(), userAgent: null });
    const mine = await listMyOrders(session);
    expect(mine.map((x) => x.id)).toEqual([o.id]);
    expect((await listMyAddresses(session)).map((a) => a.addressLine)).toContain("House 9, Main Boulevard, Gulberg");
  });

  it("rejects duplicate e-mails and already-registered phones", async () => {
    await registerCustomer({ name: "A", phone: "03005556667", email: "a@example.com", password: "Password1234" }, ip()).catch(() => undefined);
    await registerCustomer({ name: "Ali", phone: "03005556667", email: "ali@example.com", password: "Password1234" }, ip());
    await expect(registerCustomer({ name: "Ali 2", phone: "03009998887", email: "ALI@example.com", password: "Password1234" }, ip())).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(registerCustomer({ name: "Ali 3", phone: "0300 5556667", email: "ali3@example.com", password: "Password1234" }, ip())).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});
