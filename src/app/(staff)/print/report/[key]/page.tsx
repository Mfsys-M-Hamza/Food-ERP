import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireStaffPage } from "@/server/core/page-guard";
import { can } from "@/server/core/rbac";
import { runReport } from "@/server/modules/reports/service";
import { getSetting } from "@/server/modules/settings/service";
import { AccessDenied } from "@/components/shared/access-denied";
import { ReportTable, formatCell } from "@/features/reports/report-view";
import { REPORTS, isReportKey } from "@/lib/reports";
import { formatDate, formatDateTime } from "@/lib/format";
import { AutoPrint } from "../../print-styles";

export const instant = false;
export const metadata: Metadata = { title: "Report", robots: { index: false } };

/** Print-friendly report (A4). "Save as PDF" in the print dialog produces the PDF. */
export default async function PrintReportPage({ params, searchParams }: PageProps<"/print/report/[key]">) {
  const { key } = await params;
  if (!isReportKey(key)) notFound();
  const ctx = await requireStaffPage(`/print/report/${key}`);
  if (!can(ctx, REPORTS[key].permission)) return <AccessDenied />;
  const sp = await searchParams;
  const pick = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const [report, profile] = await Promise.all([runReport(ctx, key, { from: pick(sp.from), to: pick(sp.to) }), getSetting("business.profile")]);
  return (
    <>
      <style>{`
        @page { size: A4; margin: 12mm; }
        html, body { background: #fff !important; color: #000 !important; }
        .rpt { max-width: 190mm; margin: 0 auto; font: 11px/1.4 system-ui, sans-serif; }
        .rpt h1 { font-size: 18px; margin: 0; }
        .rpt .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 10px 0; }
        .rpt .tile { border: 1px solid #bbb; border-radius: 4px; padding: 6px; }
        .rpt .tile b { display: block; font-size: 14px; }
        .rpt table { width: 100%; border-collapse: collapse; }
        .rpt th, .rpt td { border-bottom: 1px solid #ddd; padding: 3px 4px !important; height: auto !important; }
        .rpt tfoot td { border-top: 2px solid #000; }
        @media screen { body { background: #e5e5e5 !important; } .rpt { background: #fff; padding: 12mm; margin: 16px auto; box-shadow: 0 1px 6px rgba(0,0,0,.2); } }
      `}</style>
      <AutoPrint />
      <main className="rpt" data-testid="report-print">
        <h1>
          {profile.name} · {report.title}
        </h1>
        <div>
          {report.from ? `${formatDate(report.from)} – ${formatDate(report.to)}` : "As of now"} · printed {formatDateTime(new Date())} by {ctx.user.name}
        </div>
        {report.tiles.length > 0 && (
          <div className="tiles">
            {report.tiles.map((t) => (
              <div key={t.label} className="tile">
                {t.label}
                <b>{formatCell(t.value, t.type)}</b>
              </div>
            ))}
          </div>
        )}
        <ReportTable report={report} print />
        {report.notes?.map((n) => (
          <p key={n}>{n}</p>
        ))}
      </main>
    </>
  );
}
