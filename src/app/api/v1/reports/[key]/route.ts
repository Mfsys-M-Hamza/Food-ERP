import { connection } from "next/server";
import { getContextFromHeaders } from "@/server/core/context";
import { apiError } from "@/server/core/api";
import { AppError } from "@/server/core/errors";
import { recordAudit } from "@/server/core/audit";
import { db } from "@/server/core/db";
import { buildXlsx } from "@/server/core/xlsx";
import { runReport } from "@/server/modules/reports/service";
import { isReportKey, plainCell, toCsv } from "@/lib/reports";
import { getSetting } from "@/server/modules/settings/service";

/** Report export: ?format=csv|xlsx&from=YYYY-MM-DD&to=YYYY-MM-DD */
export async function GET(req: Request, route: { params: Promise<{ key: string }> }) {
  await connection();
  try {
    const { key } = await route.params;
    if (!isReportKey(key)) throw new AppError("NOT_FOUND", "Report not found.");
    const ctx = await getContextFromHeaders(req.headers);
    if (!ctx) throw new AppError("UNAUTHENTICATED", "Please sign in.");
    const url = new URL(req.url);
    const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
    const report = await runReport(ctx, key, { from: url.searchParams.get("from") || undefined, to: url.searchParams.get("to") || undefined });
    // Exports leave the system, so they are audited.
    await recordAudit(db, ctx, { action: "report.export", module: "reports", entityType: "report", after: { key, format, from: report.from, to: report.to } });
    const name = `${key}${report.from ? `_${report.from}_${report.to}` : ""}`;
    const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
    if (format === "csv") {
      return new Response(toCsv(report), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"` } });
    }
    const profile = await getSetting("business.profile");
    const rows = [...report.rows, ...(report.totals ? [report.totals] : [])].map((r) => report.columns.map((c) => plainCell(r[c.key] ?? null, c.type)));
    const xlsx = buildXlsx({
      name: report.title,
      title: [`${profile.name} · ${report.title}`, report.from ? `${report.from} to ${report.to}` : `As of ${new Date().toISOString().slice(0, 10)}`],
      header: report.columns.map((c) => c.label || "Item"),
      formats: report.columns.map((c) => (c.type === "money" ? "money" : c.type === "text" || c.type === "date" ? "text" : "number")),
      rows,
      boldLastRow: !!report.totals && report.rows.length > 0,
    });
    return new Response(new Uint8Array(xlsx), {
      headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}.xlsx"` },
    });
  } catch (e) {
    return apiError(e);
  }
}
