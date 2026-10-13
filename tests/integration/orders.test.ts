import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";
import {
  createOrder,
  addPayment,
  transitionOrder,
  refundOrder,
  cancelOrder,
} from "@/server/modules/orders/service";
import { openShift, closeShift, computeShiftSummary, addCashMovement, approveShift } from "@/server/modules/shifts/service";
import { saveZone } from "@/server/modules/delivery/zones";
import { updateSetting, getSetting } from "@/server/modules/settings/service";
import { setAvailability } from "@/server/modules/menu/service";
import {
  resetDatabase,
  seedMenu,
  ctxForRole,
  createUserWithRole,
  ctxFor,
  setPin,
  counterTerminalId,
  productBySku,
} from "./helpers";

let owner: Ctx;
let cashier: Ctx;
let terminalId: string;
let shiftId: string;

beforeEach(async () => {
  await resetDatabase();
  await seedMenu();
  owner = await ctxForRole("owner");
  cashier = await ctxForRole("cashier");
  terminalId = await counterTerminalId();
  shiftId = (await openShift(cashier, { terminalId, openingCash: "5000" })).id;
});

async function zingerLine(qty = 1) {
  const p = await productBySku("BRG-ZNG");
  const cheese = p.addonGroups.find((g) => g.group.name === "Burger extras")!.group.addons[0]!; // +80
  return { productId: p.id, quantity: qty, addonIds: [cheese.id], removableIds: [p.removables[0]!.id], note: "well done" };
}

const order = (over: Record<string, unknown> = {}) => ({
  clientRequestId: randomUUID(),
  source: "POS",
  type: "TAKEAWAY",
  terminalId,
  ...over,
});

describe("POS orders", () => {
  it("creates a paid counter order with snapshots, change, numbering and a cash ledger entry", async () => {
    const o = await createOrder(cashier, order({ items: [await zingerLine(2)], payments: [{ method: "CASH", amount: "1340", tendered: "2000" }] }));
    expect(o).toMatchObject({ status: "ACCEPTED", paymentStatus: "PAID", displayNumber: 1, subtotal: "1340.00", grandTotal: "1340.00" });
    expect(o.orderNumber).toMatch(/^\d{6}-0001$/);
    expect(o.items[0]).toMatchObject({ productName: "Zinger Burger", quantity: 2, unitPrice: "590.00", addonsUnitTotal: "80.00", lineTotal: "1340.00", note: "well done" });
    expect(o.items[0]!.addons[0]!.name).toBe("Extra cheese slice");
    expect(o.items[0]!.removals[0]!.label).toBe("No mayo");
    expect(o.payments[0]).toMatchObject({ method: "CASH", amount: "1340.00", tendered: "2000.00", changeGiven: "660.00" });
    expect(Number(o.estimatedCostTotal)).toBeCloseTo((230 + 30) * 2);
    const summary = await computeShiftSummary(shiftId);
    expect(summary).toMatchObject({ cashSales: "1340.00", expectedCash: "6340.00", orderCount: 1 });

    const second = await createOrder(cashier, order({ items: [await zingerLine()], payments: [{ method: "CARD", amount: "670" }] }));
    expect(second.displayNumber).toBe(2);
    expect((await computeShiftSummary(shiftId)).cardSales).toBe("670.00");
  });

  it("is idempotent: repeating a request returns the same order", async () => {
    const input = order({ items: [await zingerLine()], payments: [{ method: "CASH", amount: "670" }] });
    const [a, b] = await Promise.all([createOrder(cashier, input), createOrder(cashier, input)]);
    expect(a.id).toBe(b.id);
    expect(await db.order.count()).toBe(1);
    expect(await db.payment.count()).toBe(1);
  });

  it("gives concurrent orders unique, consecutive numbers", async () => {
    const line = await zingerLine();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => createOrder(cashier, order({ items: [line], payments: [{ method: "CARD", amount: "670" }] }))),
    );
    expect(results.map((r) => r.displayNumber).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("re-prices on the server and ignores anything the client claims about prices", async () => {
    const p = await productBySku("PZA-TKA");
    const large = p.variants.find((v) => v.name === "Large")!;
    const o = await createOrder(cashier, order({ items: [{ productId: p.id, variantId: large.id, quantity: 1 }], payments: [{ method: "CARD", amount: "1799" }] }));
    expect(o.grandTotal).toBe("1799.00");
    await expect(
      createOrder(cashier, order({ items: [{ productId: p.id, variantId: large.id, quantity: 1 }], payments: [{ method: "CARD", amount: "100" }] })),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("rejects out-of-stock items, missing sizes and missing required choices", async () => {
    const pizza = await productBySku("PZA-TKA");
    await expect(createOrder(cashier, order({ items: [{ productId: pizza.id, quantity: 1 }] }))).rejects.toMatchObject({ message: expect.stringMatching(/Choose a size/) });
    const deal = await productBySku("DEAL-SOLO");
    await expect(createOrder(cashier, order({ items: [{ productId: deal.id, quantity: 1 }] }))).rejects.toMatchObject({ message: expect.stringMatching(/choose one/i) });
    const cake = await productBySku("DS-LAVA");
    await setAvailability(owner, { productId: cake.id, available: false });
    await expect(createOrder(cashier, order({ items: [{ productId: cake.id, quantity: 1 }] }))).rejects.toMatchObject({ message: expect.stringMatching(/out of stock/) });
  });

  it("requires an open shift for cash", async () => {
    const otherTill = await db.posTerminal.create({ data: { branchId: owner.branchId, name: "Counter 2" } });
    await expect(
      createOrder(cashier, order({ terminalId: otherTill.id, items: [await zingerLine()], payments: [{ method: "CASH", amount: "670" }] })),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("requires manager approval for discounts above the cashier limit", async () => {
    const manager = await createUserWithRole("manager");
    await setPin(manager.id, "2468");
    const line = await zingerLine();
    // 10% is within the default cashier limit
    const ok = await createOrder(cashier, order({ items: [line], discount: { type: "PERCENT", value: "10", reason: "Regular" }, payments: [{ method: "CARD", amount: "603" }] }));
    expect(ok.discountTotal).toBe("67.00");
    // 50% needs a PIN
    const big = { items: [line], discount: { type: "PERCENT", value: "50", reason: "Complaint" }, payments: [{ method: "CARD", amount: "335" }] };
    await expect(createOrder(cashier, order(big))).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(createOrder(cashier, order({ ...big, overridePin: "1111" }))).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    const approved = await createOrder(cashier, order({ ...big, overridePin: "2468" }));
    expect(approved.discountTotal).toBe("335.00");
    const d = await db.orderDiscount.findFirstOrThrow({ where: { orderId: approved.id } });
    expect(d.approvedById).toBe(manager.id);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "order.discount", entityId: approved.id } });
    expect(audit.overrideUserId).toBe(manager.id);
  });

  it("calculates tax by payment method when tax is on", async () => {
    await updateSetting(owner, "finance", { ...(await getSetting("finance")), taxEnabled: true, taxRateCash: 16, taxRateCard: 5 });
    const line = await zingerLine();
    const cash = await createOrder(cashier, order({ items: [line], payments: [{ method: "CASH", amount: "777.20" }] }));
    expect(cash).toMatchObject({ taxTotal: "107.20", grandTotal: "777.20", taxRate: 16 });
    const card = await createOrder(cashier, order({ items: [line], payments: [{ method: "CARD", amount: "703.50" }] }));
    expect(card).toMatchObject({ taxTotal: "33.50", grandTotal: "703.50", taxRate: 5 });
  });
});

describe("delivery and pay-later orders", () => {
  it("creates a delivery order with zone charge, customer and saved address; collects payment later", async () => {
    const zone = await saveZone(owner, null, { name: "DHA Phase 5", charge: "150", minimumOrder: "500", freeAbove: "3000", estimatedMinutes: 40 });
    const o = await createOrder(
      cashier,
      order({
        source: "PHONE",
        type: "DELIVERY",
        customer: { name: "Ali Raza", phone: "0300-7654321" },
        delivery: { zoneId: zone.id, addressLine: "House 12, Street 4, DHA Phase 5", landmark: "Near park" },
        items: [await zingerLine()],
      }),
    );
    expect(o).toMatchObject({ grandTotal: "820.00", deliveryCharge: "150.00", paymentStatus: "UNPAID", customerPhone: "+923007654321" });
    expect(o.delivery).toMatchObject({ zoneName: "DHA Phase 5", codAmount: "820.00", status: "PENDING" });
    const customer = await db.customer.findUniqueOrThrow({ where: { phone: "+923007654321" }, include: { addresses: true } });
    expect(customer).toMatchObject({ name: "Ali Raza", totalOrders: 1 });
    expect(customer.addresses).toHaveLength(1);

    const paid = await addPayment(cashier, o.id, { clientRequestId: randomUUID(), terminalId, payments: [{ method: "CASH", amount: "820" }] });
    expect(paid.paymentStatus).toBe("PAID");
    expect(paid.delivery?.codAmount).toBe("0.00");
  });

  it("requires a phone number for delivery", async () => {
    await expect(
      createOrder(cashier, order({ type: "DELIVERY", delivery: { addressLine: "Somewhere long enough" }, items: [await zingerLine()] })),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("status flow, refunds and cancellation", () => {
  it("moves through the kitchen flow and only completes paid orders", async () => {
    const unpaid = await createOrder(cashier, order({ source: "PHONE", items: [await zingerLine()] }));
    await transitionOrder(owner, unpaid.id, "PREPARING");
    await transitionOrder(owner, unpaid.id, "READY");
    await expect(transitionOrder(cashier, unpaid.id, "COMPLETED")).rejects.toMatchObject({ code: "INVALID_STATE" });
    await addPayment(cashier, unpaid.id, { clientRequestId: randomUUID(), terminalId, payments: [{ method: "CARD", amount: "670" }] });
    const done = await transitionOrder(cashier, unpaid.id, "COMPLETED");
    expect(done.status).toBe("COMPLETED");
    expect(done.history.map((h) => h.to)).toEqual(["ACCEPTED", "PREPARING", "READY", "COMPLETED"]);

    const kitchen = await ctxForRole("kitchen");
    await expect(transitionOrder(kitchen, unpaid.id, "COMPLETED")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("rejects stale updates from another screen", async () => {
    const o = await createOrder(cashier, order({ items: [await zingerLine()], payments: [{ method: "CARD", amount: "670" }] }));
    await transitionOrder(owner, o.id, "PREPARING", { expectedVersion: o.version });
    await expect(transitionOrder(owner, o.id, "READY", { expectedVersion: o.version })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("refunds partially then fully, with cash leaving the drawer and the order marked refunded", async () => {
    const o = await createOrder(cashier, order({ items: [await zingerLine(2)], payments: [{ method: "CASH", amount: "1340" }] }));
    await transitionOrder(owner, o.id, "READY");
    await transitionOrder(owner, o.id, "COMPLETED");
    // cashiers need a manager PIN
    await expect(refundOrder(cashier, o.id, { amount: "100", method: "CASH", reason: "Cold fries", terminalId })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    const partial = await refundOrder(owner, o.id, { amount: "340", method: "CASH", reason: "Cold fries", terminalId });
    expect(partial).toMatchObject({ paymentStatus: "PARTIALLY_REFUNDED", status: "COMPLETED", amountRefunded: "340.00" });
    await expect(refundOrder(owner, o.id, { amount: "1001", method: "CASH", reason: "Too much", terminalId })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    const full = await refundOrder(owner, o.id, { amount: "1000", method: "CARD", reason: "Wrong order" });
    expect(full).toMatchObject({ paymentStatus: "REFUNDED", status: "REFUNDED" });
    expect(full.refunds.map((r) => r.refundNumber)).toEqual(["RF-00001", "RF-00002"]);
    const s = await computeShiftSummary(shiftId);
    expect(s).toMatchObject({ cashSales: "1340.00", cashRefunds: "340.00", expectedCash: "6000.00" });
  });

  it("cancels a paid order by refunding it and restores customer totals", async () => {
    const o = await createOrder(
      cashier,
      order({ customer: { name: "Sana", phone: "03111234567" }, items: [await zingerLine()], payments: [{ method: "CASH", amount: "670" }] }),
    );
    const cancelled = await cancelOrder(owner, o.id, { reason: "Customer left", terminalId });
    expect(cancelled).toMatchObject({ status: "CANCELLED", paymentStatus: "REFUNDED", amountRefunded: "670.00", cancelReason: "Customer left" });
    const c = await db.customer.findUniqueOrThrow({ where: { phone: "+923111234567" } });
    expect(c.totalOrders).toBe(0);
    expect(c.totalSpent.toFixed(2)).toBe("0.00");
    expect((await computeShiftSummary(shiftId)).expectedCash).toBe("5000.00");
    await expect(cancelOrder(owner, o.id, { reason: "Again", terminalId })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("never allows financial rows to be deleted", async () => {
    const o = await createOrder(cashier, order({ items: [await zingerLine()], payments: [{ method: "CASH", amount: "670" }] }));
    await expect(db.order.delete({ where: { id: o.id } })).rejects.toThrow(/cannot be deleted/);
    await expect(db.payment.deleteMany({ where: { orderId: o.id } })).rejects.toThrow(/cannot be deleted/);
    await expect(db.cashTransaction.deleteMany({})).rejects.toThrow(/cannot be deleted/);
  });
});

describe("cash shifts", () => {
  it("closes with expected vs counted cash, flags discrepancies and supports approval", async () => {
    await createOrder(cashier, order({ items: [await zingerLine()], payments: [{ method: "CASH", amount: "670", tendered: "1000" }] }));
    await addCashMovement(cashier, { shiftId, type: "PAY_OUT", amount: "200", reason: "Ice purchase" });
    await addCashMovement(cashier, { shiftId, type: "PAY_IN", amount: "1000", reason: "Change float" });
    const closed = await closeShift(cashier, { shiftId, countedCash: "6300", note: "Short by 170" });
    expect(closed).toMatchObject({ expectedCash: "6470.00", countedCash: "6300.00", difference: "-170.00", status: "CLOSED", payOuts: "200.00", payIns: "1000.00" });
    const ev = await db.outboxEvent.findFirstOrThrow({ where: { type: "shift.closed" } });
    expect(ev.payload).toMatchObject({ outOfTolerance: true });

    await expect(approveShift(cashier, shiftId)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await approveShift(owner, shiftId, "Checked");
    expect((await db.cashShift.findUniqueOrThrow({ where: { id: shiftId } })).status).toBe("APPROVED");
  });

  it("allows only one open shift per till and blocks other cashiers from closing it", async () => {
    await expect(openShift(owner, { terminalId, openingCash: "0" })).rejects.toMatchObject({ code: "CONFLICT" });
    const other = await ctxFor((await createUserWithRole("cashier")).id);
    await expect(closeShift(other, { shiftId, countedCash: "5000" })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
});
