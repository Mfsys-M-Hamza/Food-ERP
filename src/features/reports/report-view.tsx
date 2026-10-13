import { formatMoney, money } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { formatMinutes } from "@/lib/attendance";
import type { ColumnType, ReportCell, ReportResult } from "@/lib/reports";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** Server-rendered report pieces, shared by the viewer and the print layout. */

export function formatCell(value: ReportCell | undefined, type: ColumnType): string {
  if (value === null || value === undefined || value === "") return "";
  switch (type) {
    case "money":
      return formatMoney(value);
    case "percent":
      return `${Number(value).toLocaleString("en-PK", { maximumFractionDigits: 1 })}%`;
    case "number":
      return Number(value).toLocaleString("en-PK", { maximumFractionDigits: 1 });
    case "minutes":
      return formatMinutes(Number(value));
    case "date":
      return /^\d{4}-\d{2}-\d{2}/.test(String(value)) ? formatDate(String(value)) : String(value);
    default:
      return String(value);
  }
}

const numeric = (t: ColumnType) => t !== "text" && t !== "date";

export function ReportTiles({ report }: { report: ReportResult }) {
  if (!report.tiles.length) return null;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {report.tiles.map((t) => (
        <Card key={t.label} className="py-4">
          <CardContent>
            <div className="text-xs text-muted-foreground">{t.label}</div>
            <div className="mt-0.5 text-xl font-semibold tabular md:text-2xl" data-testid={`tile-${t.label}`}>
              {formatCell(t.value, t.type)}
            </div>
            {t.hint && <div className="mt-0.5 text-xs text-muted-foreground">{t.hint}</div>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Horizontal bar chart (top 15) built with plain CSS: no chart library to download. */
export function ReportChart({ report, limit = 15 }: { report: ReportResult; limit?: number }) {
  const c = report.chart;
  if (!c || report.rows.length < 2) return null;
  const labelCol = report.columns.find((x) => x.key === c.label);
  const isTimeline = labelCol?.type === "date" || c.label === "hour";
  const rows = isTimeline ? report.rows.slice(-31) : report.rows.slice(0, limit);
  const max = rows.reduce((a, r) => Math.max(a, Number(r[c.value] ?? 0)), 0) || 1;

  if (isTimeline) {
    return (
      <Card className="py-4">
        <CardContent>
          <div className="flex h-44 items-end gap-1" role="img" aria-label={`${report.title} chart`}>
            {rows.map((r, i) => {
              const v = Number(r[c.value] ?? 0);
              return (
                <div key={i} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end">
                  <div className="rounded-t bg-brand/80 transition group-hover:bg-brand" style={{ height: `${Math.max(2, (v / max) * 100)}%` }} />
                  <div className="pointer-events-none absolute -top-7 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 text-[11px] text-background group-hover:block">
                    {formatCell(r[c.label] ?? "", labelCol?.type ?? "text")}: {formatCell(v, c.type)}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
            <span>{formatCell(rows[0]?.[c.label] ?? "", labelCol?.type ?? "text")}</span>
            <span>{formatCell(rows.at(-1)?.[c.label] ?? "", labelCol?.type ?? "text")}</span>
          </div>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="py-4">
      <CardContent className="space-y-1.5">
        {rows.map((r, i) => {
          const v = Number(r[c.value] ?? 0);
          return (
            <div key={i} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm">
              <span className="truncate" title={String(r[c.label] ?? "")}>
                {formatCell(r[c.label] ?? "", labelCol?.type ?? "text")}
              </span>
              <span className="h-3 overflow-hidden rounded-full bg-muted">
                <span className="block h-full rounded-full bg-brand/80" style={{ width: `${Math.max(1, (v / max) * 100)}%` }} />
              </span>
              <span className="tabular text-muted-foreground">{formatCell(v, c.type)}</span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export function ReportTable({ report, print = false }: { report: ReportResult; print?: boolean }) {
  const isProfit = report.key === "profit";
  return (
    <Table data-testid="report-table">
      <TableHeader>
        <TableRow>
          {report.columns.map((c) => (
            <TableHead key={c.key} className={cn(numeric(c.type) && "text-right", !print && c.hideOnMobile && "hidden md:table-cell")}>
              {c.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {report.rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={report.columns.length} className="py-10 text-center text-muted-foreground">
              Nothing in this period.
            </TableCell>
          </TableRow>
        )}
        {report.rows.map((r, i) => {
          const total = isProfit && r.kind === "total";
          const negative = (c: string) => numeric(report.columns.find((x) => x.key === c)!.type) && money(r[c] ?? 0).isNegative();
          return (
            <TableRow key={i} className={cn(total && "bg-muted/50 font-semibold")}>
              {report.columns.map((c) => (
                <TableCell
                  key={c.key}
                  className={cn("whitespace-normal", numeric(c.type) && "text-right tabular", !print && c.hideOnMobile && "hidden md:table-cell", isProfit && negative(c.key) && "text-muted-foreground")}
                >
                  {formatCell(r[c.key], c.type)}
                </TableCell>
              ))}
            </TableRow>
          );
        })}
      </TableBody>
      {report.totals && report.rows.length > 0 && (
        <TableFooter>
          <TableRow>
            {report.columns.map((c) => (
              <TableCell key={c.key} className={cn("font-semibold", numeric(c.type) && "text-right tabular", !print && c.hideOnMobile && "hidden md:table-cell")}>
                {formatCell(report.totals![c.key], c.type)}
              </TableCell>
            ))}
          </TableRow>
        </TableFooter>
      )}
    </Table>
  );
}
