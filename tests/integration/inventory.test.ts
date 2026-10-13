import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";
import { createOrder, transitionOrder, cancelOrder } from "@/server/modules/orders/service";
import { openShift, computeShiftSummary } from "@/server/modules/shifts/service";
import { saveIngredient, adjustStock, startStockCount, saveStockCount, postStockCount, listIngredients } from "@/server/modules/inventory/service";
import { saveRecipe, setRemovableIngredient } from "@/server/modules/inventory/recipes";
import { recordWastage } from "@/server/modules/inventory/wastage";
import { saveSupplier, savePurchaseDraft, receivePurchase, paySupplier, getSupplier } from "@/server/modules/purchasing/service";
import { updateSetting, getSetting } from "@/server/modules/settings/service";
import { resetDatabase, seedMenu, ctxForRole, counterTerminalId, productBySku } from "./helpers";

let owner: Ctx;
let cashier: Ctx;
let terminalId: string;
const ids: Record<string, string> = {};

async function onHand(name: string) {
  const s = await db.ingredientStock.findFirst({ where: { ingredientId: ids[name] } });
  return s?.onHand.toString() ?? "0";
}

beforeEach(async () => {
  await resetDatabase();
  await seedMenu();
  owner = await ctxForRole("owner");
  cashier = await ctxForRole("cashier");
  terminalId = await counterTerminalId();
  await openShift(cashier, { terminalId, openingCash: "5000" });
  const make = async (name: string, baseUnit: "g" | "piece" | "ml", openingQty: string, openingUnitCost: string, units: { unit: string; factor: string }[] = []) => {
    ids[name] = (await saveIngredient(owner, null, { name, baseUnit, openingQty, openingUnitCost, minStock: "0", units })).id;
  };
  await make("Burger bun", "piece", "100", "25", [{ unit: "pack", factor: "6" }]);
  await make("Chicken fillet", "piece", "100", "120");
  await make("Burger sauce", "g", "5000", "0.8");
  await make("Cheese slice", "g", "3000", "2");
  await make("Lettuce", "g", "2000", "0.5");

  const zinger = await productBySku("BRG-ZNG");
  await saveRecipe(owner, {
    target: { productId: zinger.id },
    items: [
      { ingredientId: ids["Burger bun"], quantity: "1" },
      { ingredientId: ids["Chicken fillet"], quantity: "1" },
      { ingredientId: ids["Burger sauce"], quantity: "20" },
      { ingredientId: ids["Cheese slice"], quantity: "15" },
      { ingredientId: ids["Lettuce"], quantity: "10" },
    ],
  });
});

async function zingerOrder(qty: number, opts: { removeFirst?: boolean; extraCheese?: boolean } = {}) {
  const p = await productBySku("BRG-ZNG");
  const cheese = p.addonGroups.find((g) => g.group.name === "Burger extras")!.group.addons[0]!;
  return createOrder(cashier, {
    clientRequestId: randomUUID(),
    source: "POS",
    type: "TAKEAWAY",
    terminalId,
    items: [
      {
        productId: p.id,
        quantity: qty,
        addonIds: opts.extraCheese ? [cheese.id] : [],
        removableIds: opts.removeFirst ? [p.removables.find((r) => r.label === "No lettuce")!.id] : [],
      },
    ],
    payments: [{ method: "CARD", amount: String((590 + (opts.extraCheese ? 80 : 0)) * qty) }],
  });
}

describe("recipe-based stock deduction", () => {
  it("deducts exactly 10 buns, 10 fillets, 200 g sauce and 150 g cheese for 10 Zinger burgers", async () => {
    const o = await zingerOrder(10);
    // Default deduction point is PREPARING: nothing moves at ACCEPTED.
    expect(await onHand("Burger bun")).toBe("100");
    await transitionOrder(owner, o.id, "PREPARING");
    expect(await onHand("Burger bun")).toBe("90");
    expect(await onHand("Chicken fillet")).toBe("90");
    expect(await onHand("Burger sauce")).toBe("4800");
    expect(await onHand("Cheese slice")).toBe("2850");
    // Moving on does not deduct twice.
    await transitionOrder(owner, o.id, "READY");
    await transitionOrder(owner, o.id, "COMPLETED");
    expect(await onHand("Burger bun")).toBe("90");
    const tx = await db.inventoryTransaction.findMany({ where: { referenceId: o.id, type: "SALE" } });
    expect(tx).toHaveLength(5);
  });

  it("skips removed ingredients and adds add-on recipes", async () => {
    const p = await productBySku("BRG-ZNG");
    await setRemovableIngredient(owner, p.removables.find((r) => r.label === "No lettuce")!.id, ids["Lettuce"]!);
    const extra = p.addonGroups.find((g) => g.group.name === "Burger extras")!.group.addons[0]!;
    await saveRecipe(owner, { target: { addonId: extra.id }, items: [{ ingredientId: ids["Cheese slice"], quantity: "15" }] });

    const o = await zingerOrder(2, { removeFirst: true, extraCheese: true });
    await transitionOrder(owner, o.id, "PREPARING");
    expect(await onHand("Lettuce")).toBe("2000");
    expect(await onHand("Cheese slice")).toBe("2940"); // 2 × (15 + 15)
  });

  it("can deduct at acceptance instead, when configured", async () => {
    await updateSetting(owner, "inventory", { ...(await getSetting("inventory")), deductionPoint: "ACCEPTED" });
    await zingerOrder(3);
    expect(await onHand("Burger bun")).toBe("97");
  });

  it("returns nothing to stock when cancelled before preparation, and records wastage after", async () => {
    const early = await zingerOrder(2);
    await cancelOrder(owner, early.id, { reason: "Customer left", terminalId });
    expect(await onHand("Burger bun")).toBe("100");
    expect(await db.wastage.count()).toBe(0);

    const late = await zingerOrder(2);
    await transitionOrder(owner, late.id, "PREPARING");
    await cancelOrder(owner, late.id, { reason: "Customer left", terminalId });
    expect(await onHand("Burger bun")).toBe("98"); // food was made: still gone
    const w = await db.wastage.findMany({ where: { orderId: late.id } });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ reason: "CANCELLED_ORDER", itemName: "Zinger Burger" });
    const types = (await db.inventoryTransaction.findMany({ where: { referenceId: late.id, ingredientId: ids["Burger bun"] } })).map((t) => t.type);
    expect(types).toEqual(["SALE", "SALE_REVERSAL", "WASTAGE"]);
  });

  it("allows negative stock and flags it low, without blocking the sale", async () => {
    await adjustStock(owner, { ingredientId: ids["Chicken fillet"], quantity: "-99", unit: "piece", reason: "Spoiled batch" });
    const o = await zingerOrder(3);
    await transitionOrder(owner, o.id, "PREPARING");
    expect(await onHand("Chicken fillet")).toBe("-2");
    const low = (await listIngredients(owner, { filter: "low" })).map((i) => i.name);
    expect(low).toContain("Chicken fillet");
  });
});

describe("costing", () => {
  it("rolls recipe cost into the product and order cost snapshots", async () => {
    const p = await db.product.findUniqueOrThrow({ where: { sku: "BRG-ZNG" } });
    // 25 + 120 + 20×0.8 + 15×2 + 10×0.5 = 196
    expect(p.cost.toFixed(2)).toBe("196.00");
    const o = await zingerOrder(1);
    expect(o.estimatedCostTotal).toBe("196.00");
  });

  it("receives a purchase in packs, updates weighted average cost and menu cost", async () => {
    const supplier = await saveSupplier(owner, null, { name: "Bakery Bros", phone: "0300 1231231", paymentTermsDays: 7, ingredientIds: [ids["Burger bun"]] });
    const draft = await savePurchaseDraft(owner, null, {
      supplierId: supplier.id,
      supplierInvoiceNo: "BB-101",
      invoiceDate: "2026-10-12",
      items: [{ ingredientId: ids["Burger bun"], quantity: "10", unit: "pack", unitCost: "210" }], // 60 buns at 35
    });
    expect(await onHand("Burger bun")).toBe("100");
    await receivePurchase(owner, draft.id);
    expect(await onHand("Burger bun")).toBe("160");
    const bun = await db.ingredient.findUniqueOrThrow({ where: { id: ids["Burger bun"] } });
    // (100×25 + 60×35) / 160 = 28.75
    expect(bun.averageCost.toFixed(2)).toBe("28.75");
    expect(bun.lastPurchaseCost?.toFixed(2)).toBe("35.00");
    const p = await db.product.findUniqueOrThrow({ where: { sku: "BRG-ZNG" } });
    expect(p.cost.toFixed(2)).toBe("199.75");
    await expect(receivePurchase(owner, draft.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(
      savePurchaseDraft(owner, null, { supplierId: supplier.id, supplierInvoiceNo: "BB-101", invoiceDate: "2026-10-12", items: [{ ingredientId: ids["Burger bun"], quantity: "1", unit: "piece", unitCost: "1" }] }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("tracks supplier balance and pays from the cash drawer through the shift", async () => {
    const supplier = await saveSupplier(owner, null, { name: "Fresh Poultry" });
    const draft = await savePurchaseDraft(owner, null, {
      supplierId: supplier.id,
      invoiceDate: "2026-10-12",
      items: [{ ingredientId: ids["Chicken fillet"], quantity: "50", unit: "piece", unitCost: "118" }],
      discount: "100",
    });
    await receivePurchase(owner, draft.id);
    expect((await getSupplier(owner, supplier.id)).balance.outstanding).toBe("5800.00");
    await expect(paySupplier(owner, { supplierId: supplier.id, purchaseId: draft.id, amount: "6000", method: "BANK_TRANSFER" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await paySupplier(owner, { supplierId: supplier.id, purchaseId: draft.id, amount: "1000", method: "CASH_DRAWER", terminalId });
    await paySupplier(owner, { supplierId: supplier.id, purchaseId: draft.id, amount: "4800", method: "BANK_TRANSFER", reference: "TX-9" });
    const s = await getSupplier(owner, supplier.id);
    expect(s.balance.outstanding).toBe("0.00");
    expect(s.purchases[0]!.paymentStatus).toBe("PAID");
    const shift = await db.cashShift.findFirstOrThrow({ where: { status: "OPEN" } });
    expect((await computeShiftSummary(shift.id)).supplierPayments).toBe("1000.00");
  });
});

describe("counts and wastage", () => {
  it("posts stock count variances", async () => {
    const c = await startStockCount(owner, "Weekly count");
    await saveStockCount(owner, c.id, [
      { ingredientId: ids["Burger bun"], countedQty: "95" },
      { ingredientId: ids["Burger sauce"], countedQty: "5100" },
    ]);
    const r = await postStockCount(owner, c.id);
    expect(await onHand("Burger bun")).toBe("95");
    expect(await onHand("Burger sauce")).toBe("5100");
    expect(await onHand("Lettuce")).toBe("2000"); // not counted → unchanged
    expect(r.varianceValue).toBe("-45.00"); // -5×25 + 100×0.8
    await expect(postStockCount(owner, c.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("records ingredient and dish wastage with costs; kitchen may record, riders may not", async () => {
    const kitchen = await ctxForRole("kitchen");
    const w1 = await recordWastage(kitchen, { kind: "INGREDIENT", ingredientId: ids["Burger sauce"], quantity: "0.5", unit: "kg", reason: "EXPIRED" });
    expect(w1.estimatedCost).toBe("400.00");
    expect(await onHand("Burger sauce")).toBe("4500");
    const zinger = await productBySku("BRG-ZNG");
    const w2 = await recordWastage(kitchen, { kind: "PRODUCT", productId: zinger.id, quantity: "2", reason: "BURNED" });
    expect(w2.estimatedCost).toBe("392.00");
    expect(await onHand("Burger bun")).toBe("98");
    const rider = await ctxForRole("rider");
    await expect(recordWastage(rider, { kind: "INGREDIENT", ingredientId: ids["Lettuce"], quantity: "1", reason: "SPOILED" })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("keeps the stock ledger append-only", async () => {
    const row = await db.inventoryTransaction.findFirstOrThrow();
    await expect(db.inventoryTransaction.update({ where: { id: row.id }, data: { reason: "x" } })).rejects.toThrow(/append-only/);
  });
});
