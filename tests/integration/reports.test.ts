import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";
import { createOrder, refundOrder, cancelOrder } from "@/server/modules/orders/service";
import { openShift } from "@/server/modules/shifts/service";
import { createExpense } from "@/server/modules/expenses/service";
import { runReport } from "@/server/modules/reports/service";
import { todayFor } from "@/server/core/today";
import { REPORT_KEYS, toCsv } from "@/lib/reports";
import { buildXlsx } from "@/server/core/xlsx";
import { resetDatabase, seedMenu, ctxForRole, counterTerminalId, productBySku } from "./helpers";

let owner: Ctx;
let manager: Ctx;
let cashier: Ctx;
let terminalId: string;
let today: string;

beforeEach(async () => {
  await resetDatabase();
  await seedMenu();
  owner = await ctxForRole("owner");
  manager = await ctxForRole("manager");
  cashier = await ctxForRole("cashier");
  terminalId = await counterTerminalId();
  await openShift(cashier, { terminalId, openingCash: "5000" });
  today = await todayFor(owner.branchId);
});

const order = (items: unknown[], over: Record<string, unknown> = {}) => ({ clientRequestId: randomUUID(), source: "POS", type: "TAKEAWAY", terminalId, items, ...over });

async function sell() {
  const zinger = await productBySku("BRG-ZNG"); // 590
  const a = await createOrder(cashier, order([{ productId: zinger.id, quantity: 2 }], { payments: [{ method: "CASH", amount: "1180" }] }));
  await createOrder(cashier, order([{ productId: zinger.id, quantity: 1 }], { discount: { type: "PERCENT", value: "10", reason: "Regular" }, payments: [{ method: "CARD", amount: "531" }] }));
  const c = await createOrder(cashier, order([{ productId: zinger.id, quantity: 1 }], { payments: [{ method: "CASH", amount: "590" }] }));
  await cancelOrder(owner, c.id, { reason: "Customer left", terminalId });
  await refundOrder(owner, a.id, { amount: "100", method: "CASH", reason: "Cold fries", terminalId });
}

describe("reports", () => {
  it("daily sales count accepted orders, discounts and refunds, not cancellations", async () => {
    await sell();
    const r = await runReport(manager, "sales", {});
    expect(r.rows).toHaveLength(1);
    expect(r.totals).toMatchObject({ orders: 2, gross: "1770.00", discounts: "59.00", total: "1711.00", refunds: "100.00", net: "1611.00" });
    expect(r.tiles[0]).toMatchObject({ label: "Net sales", value: "1611.00" });
  });

  it("product, payment and discount reports agree with the orders", async () => {
    await sell();
    const products = await runReport(manager, "products", { from: today, to: today });
    expect(products.rows[0]).toMatchObject({ name: "Zinger Burger", qty: 3, revenue: "1770.00" });
    expect(Number(products.rows[0]!.cost)).toBeGreaterThan(0);
    const pay = await runReport(manager, "payments", {});
    expect(pay.rows.find((x) => x.method === "Cash")).toMatchObject({ amount: "1180.00", refunds: "100.00", net: "1080.00" });
    expect(pay.rows.find((x) => x.method === "Card")).toMatchObject({ net: "531.00" });
    const disc = await runReport(manager, "discounts", {});
    expect(disc.rows[0]).toMatchObject({ reason: "Regular", amount: "59.00" });
    const ref = await runReport(manager, "refunds", {});
    // The cancelled paid order was refunded too (590), alongside the partial refund (100).
    expect(ref.totals).toMatchObject({ amount: "690.00" });
    expect(ref.rows).toHaveLength(2);
    const cashiers = await runReport(manager, "cashiers", {});
    expect(cashiers.rows[0]).toMatchObject({ orders: 2, total: "1711.00" });
  });

  it("estimates profit as revenue less food cost, wastage and expenses", async () => {
    await sell();
    const elec = await db.expenseCategory.findFirstOrThrow({ where: { name: "Electricity" } });
    await createExpense(owner, { categoryId: elec.id, amount: "500", expenseDate: today, paymentMethod: "BANK_TRANSFER", description: "Bill" });
    const cogs = (await db.order.aggregate({ where: { status: { notIn: ["NEW", "CANCELLED"] } }, _sum: { estimatedCostTotal: true } }))._sum.estimatedCostTotal!;
    const r = await runReport(owner, "profit", {});
    const line = (name: string) => r.rows.find((x) => x.item === name)?.amount;
    expect(line("Net revenue")).toBe("1611.00");
    expect(line("Food cost of items sold (estimated)")).toBe(`-${cogs.toFixed(2)}`);
    expect(line("Electricity")).toBe("-500.00");
    const wastage = (await db.wastage.aggregate({ _sum: { estimatedCost: true } }))._sum.estimatedCost ?? 0;
    expect(line("Estimated net profit")).toBe((1611 - Number(cogs.toFixed(2)) - Number(wastage) - 500).toFixed(2));
  });

  it("runs every report without errors, and keeps financial reports from managers", async () => {
    await sell();
    for (const key of REPORT_KEYS) {
      const r = await runReport(owner, key, {});
      expect(r.columns.length).toBeGreaterThan(0);
      expect(() => toCsv(r)).not.toThrow();
    }
    await expect(runReport(manager, "profit", {})).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(runReport(manager, "payroll", {})).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(runReport(cashier, "sales", {})).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(runReport(owner, "sales", { from: "2026-02-01", to: "2026-01-01" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("exports CSV safely and a valid xlsx", async () => {
    const csv = toCsv({ columns: [{ key: "a", label: "Name", type: "text" }, { key: "b", label: "Amount", type: "money" }], rows: [{ a: "=HYPERLINK(1)", b: "-12.50" }, { a: 'Say "hi", ok', b: "3" }] });
    expect(csv).toContain("'=HYPERLINK(1),-12.5");
    expect(csv).toContain('"Say ""hi"", ok",3');
    const xlsx = buildXlsx({ name: "Sales", header: ["Name", "Amount"], formats: ["text", "money"], rows: [["Zinger", "1180.00"]] });
    expect(xlsx.subarray(0, 2).toString()).toBe("PK");
    expect(xlsx.length).toBeGreaterThan(500);
  });
});
