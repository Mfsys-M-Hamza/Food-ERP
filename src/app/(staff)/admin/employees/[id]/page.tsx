import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { requireStaffPage } from "@/server/core/page-guard";
import { can, canAny } from "@/server/core/rbac";
import { isAppError } from "@/server/core/errors";
import { getEmployee, linkableUsers, workShiftOptions } from "@/server/modules/people/employees";
import { employeeAdvances, employeePayslips } from "@/server/modules/people/payroll";
import { drawerOptions } from "@/server/modules/expenses/service";
import { todayFor } from "@/server/core/today";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { EmployeeForm } from "@/features/people/employee-form";
import { AdvancesPanel } from "@/features/people/advances";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Employee" };

export default async function EmployeePage({ params }: PageProps<"/admin/employees/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await requireStaffPage(`/admin/employees/${id}`);
  if (!can(ctx, "employees.manage")) return <AccessDenied />;
  const e = await getEmployee(ctx, id).catch((err) => {
    if (isAppError(err) && err.code === "NOT_FOUND") notFound();
    throw err;
  });
  const payroll = canAny(ctx, ["payroll.prepare", "payroll.approve"]);
  const [users, shifts, advances, payslips, tills, today] = await Promise.all([
    linkableUsers(ctx, id),
    workShiftOptions(ctx),
    e.sensitive || can(ctx, "payroll.prepare") ? employeeAdvances(ctx, id) : Promise.resolve(null),
    payroll ? employeePayslips(ctx, id) : Promise.resolve(null),
    drawerOptions(ctx),
    todayFor(ctx.branchId),
  ]);
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link href="/admin/employees">
          <ArrowLeft /> Employees
        </Link>
      </Button>
      <PageHeader
        title={e.form.fullName}
        description={`${e.employeeCode} · ${e.form.designation}${e.workShift ? ` · ${e.workShift.name} ${e.workShift.start}–${e.workShift.end}` : ""}`}
        actions={
          can(ctx, "attendance.manage") && (
            <Button asChild variant="outline">
              <Link href={`/admin/attendance?view=month&employee=${id}`}>Attendance</Link>
            </Button>
          )
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <EmployeeForm id={id} initial={e.form} sensitive={e.sensitive} users={users} shifts={shifts} nationalIdHint={e.nationalIdHint} />
        <div className="space-y-6">
          {advances && (
            <Card>
              <CardContent>
                <AdvancesPanel employeeId={id} advances={advances} tills={tills} today={today} canIssue={can(ctx, "payroll.prepare") && e.form.status !== "LEFT"} />
              </CardContent>
            </Card>
          )}
          {payslips && (
            <Card>
              <CardContent className="space-y-3">
                <div className="text-sm font-medium">Payslips</div>
                {payslips.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No payroll yet.</p>
                ) : (
                  <ul className="divide-y rounded-lg border text-sm">
                    {payslips.map((p) => (
                      <li key={p.id} className="flex items-center justify-between px-3 py-2">
                        <Link href={`/print/payslip/${p.id}`} target="_blank" className="underline-offset-2 hover:underline">
                          {p.runNumber} <span className="text-xs text-muted-foreground">{p.period}</span>
                        </Link>
                        <span className="flex items-center gap-2 tabular">
                          {formatMoney(p.net)}
                          <Badge variant={p.paidAt ? "secondary" : "outline"}>{p.paidAt ? "Paid" : p.status === "APPROVED" ? "Approved" : "Draft"}</Badge>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
