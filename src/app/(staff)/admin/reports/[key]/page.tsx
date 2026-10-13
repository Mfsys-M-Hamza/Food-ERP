import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, FileSpreadsheet, FileText, Printer } from "lucide-react";
import { requireStaffPage } from "@/server/core/page-guard";
import { can } from "@/server/core/rbac";
import { isAppError } from "@/server/core/errors";
import { runReport } from "@/server/modules/reports/service";
import { todayFor } from "@/server/core/today";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { ReportChart, ReportTable, ReportTiles } from "@/features/reports/report-view";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { REPORTS, SNAPSHOT_REPORTS, isReportKey } from "@/lib/reports";
import { datePresets } from "@/lib/date-presets";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export async function generateMetadata({ params }: PageProps<"/admin/reports/[key]">): Promise<Metadata> {
  const { key } = await params;
  return { title: isReportKey(key) ? REPORTS[key].title : "Report" };
}

export default async function ReportPage({ params, searchParams }: PageProps<"/admin/reports/[key]">) {
  const { key } = await params;
  if (!isReportKey(key)) notFound();
  const ctx = await requireStaffPage(`/admin/reports/${key}`);
  if (!can(ctx, REPORTS[key].permission)) return <AccessDenied />;
  const sp = await searchParams;
  const pick = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const range = { from: pick(sp.from), to: pick(sp.to) };
  const today = await todayFor(ctx.branchId);
  let report;
  let error: string | null = null;
  try {
    report = await runReport(ctx, key, range);
  } catch (e) {
    if (!isAppError(e) || e.code !== "VALIDATION_FAILED") throw e;
    error = Object.values(e.fieldErrors ?? {})[0]?.[0] ?? e.message;
    report = await runReport(ctx, key, {});
  }
  const snapshot = SNAPSHOT_REPORTS.includes(key);
  const qs = new URLSearchParams(report.from ? { from: report.from, to: report.to! } : {}).toString();
  const presets = datePresets(today);

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link href="/admin/reports">
          <ArrowLeft /> Reports
        </Link>
      </Button>
      <PageHeader
        title={report.title}
        description={snapshot ? "As of now." : `${formatDate(report.from)} – ${formatDate(report.to)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={`/api/v1/reports/${key}?${qs}${qs ? "&" : ""}format=xlsx`} download data-testid="export-xlsx">
                <FileSpreadsheet /> Excel
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={`/api/v1/reports/${key}?${qs}${qs ? "&" : ""}format=csv`} download data-testid="export-csv">
                <FileText /> CSV
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={`/print/report/${key}?${qs}${qs ? "&" : ""}auto=1`} target="_blank" rel="noreferrer">
                <Printer /> Print / PDF
              </a>
            </Button>
          </div>
        }
      />
      {!snapshot && (
        <div className="mb-6 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => {
              const active = p.from === report.from && p.to === report.to;
              return (
                <Link
                  key={p.label}
                  href={`/admin/reports/${key}?from=${p.from}&to=${p.to}`}
                  className={cn("rounded-full border px-3 py-1 text-sm", active ? "border-brand bg-brand/10 font-medium" : "text-muted-foreground hover:bg-muted")}
                >
                  {p.label}
                </Link>
              );
            })}
          </div>
          <form className="flex flex-wrap items-center gap-2">
            <Input type="date" name="from" defaultValue={report.from ?? ""} max={today} className="w-auto" aria-label="From" />
            <span className="text-sm text-muted-foreground">to</span>
            <Input type="date" name="to" defaultValue={report.to ?? ""} max={today} className="w-auto" aria-label="To" />
            <Button type="submit" variant="secondary">
              Show
            </Button>
          </form>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      )}
      <div className="space-y-6">
        <ReportTiles report={report} />
        <ReportChart report={report} />
        <Card className="gap-0 overflow-hidden py-0">
          <ReportTable report={report} />
        </Card>
        {report.notes && (
          <ul className="space-y-1 text-sm text-muted-foreground">
            {report.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
