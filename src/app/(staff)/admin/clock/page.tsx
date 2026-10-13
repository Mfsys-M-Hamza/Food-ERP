import type { Metadata } from "next";
import { requireStaffPage } from "@/server/core/page-guard";
import { can } from "@/server/core/rbac";
import { myClock } from "@/server/modules/people/attendance";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { ClockButton } from "@/features/people/time-clock";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ATTENDANCE_LABEL, formatMinutes } from "@/lib/attendance";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "My time clock" };

export default async function ClockPage() {
  const ctx = await requireStaffPage("/admin/clock");
  if (!can(ctx, "attendance.self")) return <AccessDenied />;
  const c = await myClock(ctx);
  if (!c.linked) {
    return (
      <>
        <PageHeader title="My time clock" />
        <Card className="max-w-md">
          <CardContent className="text-sm text-muted-foreground">Your login is not linked to an employee profile yet. Ask a manager to link it on the Employees page.</CardContent>
        </Card>
      </>
    );
  }
  return (
    <>
      <PageHeader title="My time clock" description={`${c.name}${c.shift ? ` · ${c.shift}` : ""}`} />
      <div className="mx-auto max-w-md space-y-6">
        <Card>
          <CardContent className="space-y-4 text-center">
            <div className="text-sm text-muted-foreground">{formatDate(c.today)}</div>
            <div className="text-2xl font-semibold" data-testid="clock-state">
              {c.state === "OUT" ? "Not checked in" : c.state === "IN" ? `Checked in at ${c.todayRow?.checkIn}` : `Worked ${formatMinutes(c.todayRow?.workedMinutes ?? 0)}`}
            </div>
            {c.todayRow && c.todayRow.lateMinutes > 0 && <Badge variant="outline">{c.todayRow.lateMinutes} min late</Badge>}
            <ClockButton state={c.state} />
            <p className="text-xs text-muted-foreground">The time is taken from the server, not your phone.</p>
          </CardContent>
        </Card>
        <div>
          <div className="mb-2 text-sm font-medium">Last two weeks</div>
          <ul className="divide-y rounded-xl border text-sm">
            {c.recent.length === 0 && <li className="p-4 text-muted-foreground">No attendance yet.</li>}
            {c.recent.map((r) => (
              <li key={r.date} className="flex items-center justify-between px-4 py-2">
                <span>{formatDate(r.date)}</span>
                <span className="flex items-center gap-2 text-muted-foreground">
                  {r.checkIn && `${r.checkIn}–${r.checkOut || "…"}`}
                  <Badge variant={r.status === "ABSENT" ? "destructive" : "secondary"}>{ATTENDANCE_LABEL[r.status]}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
