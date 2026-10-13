import Link from "next/link";
import type { Metadata } from "next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireStaffPage } from "@/server/core/page-guard";
import { can } from "@/server/core/rbac";
import { attendanceSheet, monthlySummary } from "@/server/modules/people/attendance";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { AttendanceSheet } from "@/features/people/attendance-sheet";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMinutes } from "@/lib/attendance";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Attendance" };

const shiftDay = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const shiftMonth = (m: string, n: number) => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7);
};

export default async function AttendancePage({ searchParams }: PageProps<"/admin/attendance">) {
  const ctx = await requireStaffPage("/admin/attendance");
  if (!can(ctx, "attendance.manage")) return <AccessDenied />;
  const sp = await searchParams;
  const pick = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const view = pick(sp.view) === "month" ? "month" : "day";

  const tabs = (
    <div className="mb-4 inline-flex rounded-lg border p-1 text-sm">
      {(["day", "month"] as const).map((v) => (
        <Link key={v} href={`/admin/attendance${v === "month" ? "?view=month" : ""}`} className={cn("rounded-md px-3 py-1.5", view === v ? "bg-muted font-medium" : "text-muted-foreground")}>
          {v === "day" ? "Daily sheet" : "Monthly summary"}
        </Link>
      ))}
    </div>
  );

  if (view === "month") {
    const s = await monthlySummary(ctx, pick(sp.month));
    const highlight = pick(sp.employee);
    return (
      <>
        <PageHeader title="Attendance" description="Totals for the month. Days with no entry are shown so they can be filled in before payroll." />
        {tabs}
        <div className="mb-4 flex items-center gap-2">
          <Button asChild size="icon" variant="outline" aria-label="Previous month">
            <Link href={`/admin/attendance?view=month&month=${shiftMonth(s.month, -1)}`}>
              <ChevronLeft />
            </Link>
          </Button>
          <div className="min-w-32 text-center font-medium">{new Date(`${s.month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}</div>
          <Button asChild size="icon" variant="outline" aria-label="Next month">
            <Link href={`/admin/attendance?view=month&month=${shiftMonth(s.month, 1)}`}>
              <ChevronRight />
            </Link>
          </Button>
        </div>
        <Card className="gap-0 py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead className="text-right">Present</TableHead>
                <TableHead className="text-right">Late</TableHead>
                <TableHead className="text-right">Half</TableHead>
                <TableHead className="text-right">Absent</TableHead>
                <TableHead className="text-right">Leave</TableHead>
                <TableHead className="text-right">No entry</TableHead>
                <TableHead className="hidden text-right md:table-cell">Worked</TableHead>
                <TableHead className="hidden text-right md:table-cell">Overtime</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {s.rows.map((r) => (
                <TableRow key={r.employeeId} className={cn(highlight === r.employeeId && "bg-brand/5")}>
                  <TableCell>
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-muted-foreground">{r.code}</div>
                  </TableCell>
                  <TableCell className="text-right tabular">{r.present}</TableCell>
                  <TableCell className="text-right tabular">{r.late}</TableCell>
                  <TableCell className="text-right tabular">{r.halfDays}</TableCell>
                  <TableCell className="text-right tabular">{r.absent}</TableCell>
                  <TableCell className="text-right tabular">{r.leave}</TableCell>
                  <TableCell className={cn("text-right tabular", r.unrecorded > 0 && "font-medium text-warning")}>{r.unrecorded}</TableCell>
                  <TableCell className="hidden text-right tabular md:table-cell">{formatMinutes(r.workedMinutes)}</TableCell>
                  <TableCell className="hidden text-right tabular md:table-cell">{formatMinutes(r.overtimeMinutes)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </>
    );
  }

  const sheet = await attendanceSheet(ctx, pick(sp.date));
  const t = sheet.totals;
  return (
    <>
      <PageHeader title="Attendance" description="Mark who came in, late arrivals and leave. Staff with a linked login can also check in from their own phone." />
      {tabs}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button asChild size="icon" variant="outline" aria-label="Previous day">
          <Link href={`/admin/attendance?date=${shiftDay(sheet.date, -1)}`}>
            <ChevronLeft />
          </Link>
        </Button>
        <form className="flex items-center gap-2">
          <Input type="date" name="date" defaultValue={sheet.date} max={sheet.today} className="w-auto" aria-label="Date" />
          <Button type="submit" variant="secondary">
            Go
          </Button>
        </form>
        {sheet.date < sheet.today && (
          <Button asChild size="icon" variant="outline" aria-label="Next day">
            <Link href={`/admin/attendance?date=${shiftDay(sheet.date, 1)}`}>
              <ChevronRight />
            </Link>
          </Button>
        )}
        <span className="text-sm text-muted-foreground">{formatDate(sheet.date)}</span>
      </div>
      <div className="mb-4 flex flex-wrap gap-3">
        {[
          ["Staff", t.staff],
          ["Present", t.present],
          ["Late", t.late],
          ["Absent", t.absent],
          ["On leave", t.leave],
          ["No entry", t.unrecorded],
        ].map(([k, v]) => (
          <Card key={k} className="min-w-28 py-3">
            <CardContent>
              <div className="text-xs text-muted-foreground">{k}</div>
              <div className="text-xl font-semibold tabular">{v}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      <AttendanceSheet date={sheet.date} rows={sheet.rows} editable />
    </>
  );
}
