import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";
import { createOrder, transitionOrder } from "@/server/modules/orders/service";
import { openShift, computeShiftSummary } from "@/server/modules/shifts/service";
import { listKitchenTickets, listBoardNumbers } from "@/server/modules/kitchen/service";
import { assignRider, listMyDeliveries, riderUpdate, listUnsettledCash, settleRiderCash, listRiders } from "@/server/modules/delivery/service";
import { eventsSince } from "@/server/modules/realtime/stream";
import { resetDatabase, seedMenu, ctxForRole, ctxFor, createUserWithRole, counterTerminalId, productBySku } from "./helpers";

let owner: Ctx;
let cashier: Ctx;
let kitchen: Ctx;
let rider: Ctx;
let terminalId: string;

beforeEach(async () => {
  await resetDatabase();
  await seedMenu();
  owner = await ctxForRole("owner");
  cashier = await ctxForRole("cashier");
  kitchen = await ctxForRole("kitchen");
  rider = await ctxFor((await createUserWithRole("rider")).id);
  terminalId = await counterTerminalId();
  await openShift(cashier, { terminalId, openingCash: "1000" });
});

async function deliveryOrder() {
  const p = await productBySku("BRG-TKA"); // 550
  return createOrder(cashier, {
    clientRequestId: randomUUID(),
    source: "PHONE",
    type: "DELIVERY",
    terminalId,
    customer: { name: "Hina Shah", phone: "03214445556" },
    delivery: { addressLine: "House 1, Street 2, Gulberg" },
    items: [{ productId: p.id, quantity: 2, removableIds: [p.removables[0]!.id] }],
  });
}

describe("kitchen display", () => {
  it("shows preparation details without prices or phone numbers", async () => {
    const o = await deliveryOrder();
    const tickets = await listKitchenTickets(kitchen);
    expect(tickets).toHaveLength(1);
    const t = tickets[0]!;
    expect(t).toMatchObject({ displayNumber: o.displayNumber, status: "ACCEPTED", type: "DELIVERY", customerFirstName: "Hina" });
    expect(t.items[0]).toMatchObject({ quantity: 2, name: "Chicken Tikka Burger", removals: ["No onions"] });
    const json = JSON.stringify(t);
    expect(json).not.toContain("+92321");
    expect(json).not.toMatch(/grandTotal|unitPrice|"phone"|"customerPhone"/);

    await transitionOrder(kitchen, o.id, "PREPARING", { source: "KDS" });
    await transitionOrder(kitchen, o.id, "READY", { source: "KDS" });
    expect((await listKitchenTickets(kitchen))[0]!.status).toBe("READY");
  });

  it("does not let riders open the kitchen screen", async () => {
    await expect(listKitchenTickets(rider)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("puts counter orders on the order-ready board", async () => {
    const p = await productBySku("DR-WTR");
    const o = await createOrder(cashier, { clientRequestId: randomUUID(), source: "POS", type: "TAKEAWAY", terminalId, items: [{ productId: p.id, quantity: 1 }], payments: [{ method: "CARD", amount: "100" }] });
    expect(await listBoardNumbers(cashier)).toEqual({ preparing: [o.displayNumber], ready: [] });
    await transitionOrder(kitchen, o.id, "READY");
    expect(await listBoardNumbers(cashier)).toEqual({ preparing: [], ready: [o.displayNumber] });
  });
});

describe("live events", () => {
  it("streams branch events with IDs and statuses only", async () => {
    const before = (await db.outboxEvent.findFirst({ orderBy: { id: "desc" } }))?.id ?? BigInt(0);
    const o = await deliveryOrder();
    await transitionOrder(kitchen, o.id, "PREPARING");
    const events = await eventsSince(owner.branchId, before);
    expect(events.map((e) => e.type)).toEqual(["order.created", "order.status_changed"]);
    expect(events[1]!.payload).toEqual({ orderId: o.id, from: "ACCEPTED", to: "PREPARING" });
    expect(await eventsSince(randomUUID(), before)).toEqual([]);
  });
});

describe("delivery with riders", () => {
  it("assigns a rider who sees only their deliveries and completes them", async () => {
    const o = await deliveryOrder();
    const riders = await listRiders(cashier);
    expect(riders.map((r) => r.id)).toContain(rider.user.id);
    await assignRider(cashier, o.id, rider.user.id);

    const otherRider = await ctxFor((await createUserWithRole("rider")).id);
    expect(await listMyDeliveries(otherRider)).toEqual([]);
    const mine = await listMyDeliveries(rider);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ displayNumber: o.displayNumber, codAmount: "1250.00", phone: "+923214445556" });

    // Not ready yet
    await expect(riderUpdate(rider, o.id, { action: "PICKED_UP" })).rejects.toMatchObject({ code: "INVALID_STATE" });
    await transitionOrder(kitchen, o.id, "READY");
    // Another rider cannot touch it, nor use the generic transition
    await expect(riderUpdate(otherRider, o.id, { action: "PICKED_UP" })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(transitionOrder(otherRider, o.id, "OUT_FOR_DELIVERY")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });

    await riderUpdate(rider, o.id, { action: "PICKED_UP" });
    await riderUpdate(rider, o.id, { action: "DELIVERED" });
    const done = await db.order.findUniqueOrThrow({ where: { id: o.id }, include: { delivery: true } });
    expect(done.status).toBe("COMPLETED");
    expect(done.paymentStatus).toBe("UNPAID");
    expect(done.delivery?.status).toBe("DELIVERED");
    expect(done.delivery?.codCollectedAt).not.toBeNull();
  });

  it("settles rider cash into the shift and marks orders paid", async () => {
    const a = await deliveryOrder();
    const b = await deliveryOrder();
    for (const o of [a, b]) {
      await assignRider(cashier, o.id, rider.user.id);
      await transitionOrder(kitchen, o.id, "READY");
      await riderUpdate(rider, o.id, { action: "PICKED_UP" });
      await riderUpdate(rider, o.id, { action: "DELIVERED" });
    }
    const unsettled = await listUnsettledCash(cashier);
    expect(unsettled).toHaveLength(1);
    expect(unsettled[0]).toMatchObject({ riderId: rider.user.id, total: "2500.00" });

    const result = await settleRiderCash(cashier, { riderId: rider.user.id, orderIds: unsettled[0]!.deliveries.map((d) => d.orderId), terminalId });
    expect(result).toEqual({ total: "2500.00", count: 2 });
    expect(await listUnsettledCash(cashier)).toEqual([]);
    const paid = await db.order.findUniqueOrThrow({ where: { id: a.id } });
    expect(paid.paymentStatus).toBe("PAID");
    const shift = await db.cashShift.findFirstOrThrow({ where: { status: "OPEN" } });
    expect((await computeShiftSummary(shift.id)).riderSettlements).toBe("2500.00");
    await expect(
      settleRiderCash(cashier, { riderId: rider.user.id, orderIds: [a.id], terminalId }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("records failed deliveries with a reason", async () => {
    const o = await deliveryOrder();
    await assignRider(cashier, o.id, rider.user.id);
    await expect(riderUpdate(rider, o.id, { action: "FAILED", note: "" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await riderUpdate(rider, o.id, { action: "FAILED", note: "Customer not answering" });
    const d = await db.delivery.findUniqueOrThrow({ where: { orderId: o.id } });
    expect(d).toMatchObject({ status: "FAILED", notes: "Customer not answering" });
  });
});
