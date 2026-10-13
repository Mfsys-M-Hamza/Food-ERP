import type { PermissionKey } from "@/lib/rbac/catalog";

/**
 * Report catalogue and the shape every report returns. Pure data, safe on the
 * client: the viewer, CSV/Excel export and print layout all render this shape.
 */

export type ColumnType = "text" | "money" | "number" | "qty" | "percent" | "date" | "minutes";
export type ReportColumn = { key: string; label: string; type: ColumnType; hideOnMobile?: boolean };
export type ReportCell = string | number | null;
export type ReportRow = Record<string, ReportCell>;
export type ReportTile = { label: string; value: string | number; type: ColumnType; hint?: string };

export type ReportResult = {
  key: ReportKey;
  title: string;
  /** Period shown, or null for "as of now" reports. */
  from: string | null;
  to: string | null;
  tiles: ReportTile[];
  /** Optional chart: one bar per row, labelled by `label`, sized by `value`. */
  chart?: { label: string; value: string; type: ColumnType };
  columns: ReportColumn[];
  rows: ReportRow[];
  totals?: ReportRow;
  notes?: string[];
};

export type ReportGroup = "Sales" | "Money" | "Stock" | "People";

export const REPORTS = {
  sales: { title: "Daily sales", group: "Sales", permission: "reports.operational", description: "Orders, discounts, tax and totals per business day." },
  products: { title: "Product sales", group: "Sales", permission: "reports.operational", description: "Quantity, revenue and estimated margin per item." },
  categories: { title: "Category sales", group: "Sales", permission: "reports.operational", description: "Revenue and margin per menu category." },
  hourly: { title: "Sales by hour", group: "Sales", permission: "reports.operational", description: "Busy hours across the period." },
  payments: { title: "Payment methods", group: "Sales", permission: "reports.operational", description: "Cash, card and online takings, less refunds." },
  sources: { title: "Order sources", group: "Sales", permission: "reports.operational", description: "POS, phone and online orders by type." },
  discounts: { title: "Discounts", group: "Sales", permission: "reports.operational", description: "Every discount given, who gave and who approved it." },
  refunds: { title: "Refunds", group: "Sales", permission: "reports.operational", description: "Refunds with reasons and approvers." },
  cashiers: { title: "Cashier performance", group: "Sales", permission: "reports.operational", description: "Orders, sales, discounts and cash differences per cashier." },
  customers: { title: "Top customers", group: "Sales", permission: "reports.operational", description: "Repeat customers and what they spend." },
  profit: { title: "Estimated profit", group: "Money", permission: "reports.financial", description: "Revenue less food cost, wastage and expenses." },
  expenses: { title: "Expenses", group: "Money", permission: "reports.operational", description: "Spending per category." },
  purchases: { title: "Purchases", group: "Money", permission: "reports.operational", description: "Supplier invoices, payments and what is still owed." },
  payroll: { title: "Payroll", group: "Money", permission: "reports.financial", description: "Salaries by employee for payroll runs in the period." },
  inventory: { title: "Stock valuation", group: "Stock", permission: "reports.operational", description: "Current stock and its value at average cost." },
  "low-stock": { title: "Low stock", group: "Stock", permission: "reports.operational", description: "Ingredients at or below their minimum." },
  wastage: { title: "Wastage", group: "Stock", permission: "reports.operational", description: "What was thrown away and what it cost." },
  consumption: { title: "Ingredient usage", group: "Stock", permission: "reports.operational", description: "Ingredients used by sales in the period." },
  attendance: { title: "Attendance", group: "People", permission: "reports.operational", description: "Presence, lateness and hours per employee." },
} as const satisfies Record<string, { title: string; group: ReportGroup; permission: PermissionKey; description: string }>;

export type ReportKey = keyof typeof REPORTS;
export const REPORT_KEYS = Object.keys(REPORTS) as ReportKey[];
export const isReportKey = (v: string): v is ReportKey => Object.prototype.hasOwnProperty.call(REPORTS, v);

/** Reports that describe "now" rather than a period. */
export const SNAPSHOT_REPORTS: ReportKey[] = ["inventory", "low-stock"];

/** Plain value of a cell for exports (no currency symbol, no grouping). */
export function plainCell(value: ReportCell, type: ColumnType): string | number {
  if (value === null || value === undefined) return "";
  if (type === "money" || type === "number" || type === "qty" || type === "percent" || type === "minutes") {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : String(value);
  }
  return String(value);
}

/** CSV with a UTF-8 BOM so Excel opens Urdu names and "Rs" correctly. */
export function toCsv(r: Pick<ReportResult, "columns" | "rows" | "totals">): string {
  const esc = (v: string | number) => {
    const s = String(v);
    // Neutralise spreadsheet formulas (CSV injection).
    const safe = /^[=+\-@\t\r]/.test(s) && typeof v === "string" ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [r.columns.map((c) => esc(c.label)).join(",")];
  for (const row of [...r.rows, ...(r.totals ? [r.totals] : [])]) {
    lines.push(r.columns.map((c) => esc(plainCell(row[c.key] ?? null, c.type))).join(","));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}
