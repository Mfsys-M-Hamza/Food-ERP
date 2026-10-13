import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { requireStaffPage } from "@/server/core/page-guard";
import { can, canAny } from "@/server/core/rbac";
import { isAppError } from "@/server/core/errors";
import { getPayrollRun } from "@/server/modules/people/payroll";
import { drawerOptions } from "@/server/modules/expenses/service";
import { todayFor } from "@/server/core/today";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { PayslipCard, RunActions } from "@/features/people/payroll-ui";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Payroll" };

const STATUS: Record<string, string> = { DRAFT: "Draft: review and adjust, then approve", APPROVED: "Approved: record payments", PAID: "Paid", CANCELLED: "Cancelled" };

export default async function PayrollRunPage({ params }: PageProps<"/admin/payroll/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await requireStaffPage(`/admin/payroll/${id}`);
  if (!canAny(ctx, ["payroll.prepare", "payroll.approve"])) return <AccessDenied />;
  const run = await getPayrollRun(ctx, id).catch((e) => {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const [tills, today] = await Promise.all([drawerOptions(ctx), todayFor(ctx.branchId)]);
  const canPrepare = can(ctx, "payroll.prepare");
  const canApprove = can(ctx, "payroll.approve");
  const unpaid = run.payslips.filter((p) => !p.paidAt).length;
  const noEntry = run.payslips.reduce((s, p) => s + p.unrecordedDays, 0);
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link href="/admin/payroll">
          <ArrowLeft /> Payroll
        </Link>
      </Button>
      <PageHeader
        title={`${run.runNumber} · ${formatDate(run.periodStart)} – ${formatDate(run.periodEnd)}`}
        description={STATUS[run.status]}
        actions={<RunActions id={run.id} status={run.status} version={run.version} canPrepare={canPrepare} canApprove={canApprove} unpaid={unpaid} tills={tills} today={today} />}
      />
      <div className="mb-6 flex flex-wrap gap-3">
        {[
          ["Gross", run.gross],
          ["Deductions", run.deductions],
          ["Net pay", run.net],
        ].map(([k, v]) => (
          <Card key={k} className="min-w-40 py-4">
            <CardContent>
              <div className="text-xs text-muted-foreground">{k}</div>
              <div className="text-2xl font-semibold tabular" data-testid={`run-${k!.toLowerCase().replace(" ", "-")}`}>
                {formatMoney(v!)}
              </div>
            </CardContent>
          </Card>
        ))}
        <Card className="min-w-40 py-4">
          <CardContent className="text-sm text-muted-foreground">
            <div>Prepared by {run.preparedBy ?? "—"}</div>
            {run.approvedBy && (
              <div>
                Approved by {run.approvedBy} · {formatDateTime(run.approvedAt)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      {run.status === "DRAFT" && noEntry > 0 && (
        <div className="mb-4 rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm">
          {noEntry} working days have no attendance entry. Fill them in on the{" "}
          <Link className="underline" href={`/admin/attendance?view=month&month=${run.periodStart.slice(0, 7)}`}>
            attendance summary
          </Link>{" "}
          and recalculate, or approve as they are.
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {run.payslips.map((p) => (
          <PayslipCard key={p.id} p={p} status={run.status} canPrepare={canPrepare} canApprove={canApprove} tills={tills} today={today} />
        ))}
      </div>
    </>
  );
}
