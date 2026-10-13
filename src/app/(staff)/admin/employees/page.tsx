import Link from "next/link";
import type { Metadata } from "next";
import { Clock, Plus } from "lucide-react";
import { requireStaffPage } from "@/server/core/page-guard";
import { can } from "@/server/core/rbac";
import { listEmployees } from "@/server/modules/people/employees";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, money } from "@/lib/money";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Employees" };

const PAY: Record<string, string> = { MONTHLY: "/ month", DAILY: "/ day", HOURLY: "/ hour" };

export default async function EmployeesPage({ searchParams }: PageProps<"/admin/employees">) {
  const ctx = await requireStaffPage("/admin/employees");
  if (!can(ctx, "employees.manage")) return <AccessDenied />;
  const sp = await searchParams;
  const pick = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const rows = await listEmployees(ctx, { q: pick(sp.q), status: pick(sp.status) });
  const sensitive = can(ctx, "employees.sensitive");
  return (
    <>
      <PageHeader
        title="Employees"
        description="Staff profiles, shifts and pay. A staff login can be linked so the person can check in themselves."
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/admin/employees/shifts">
                <Clock /> Shifts
              </Link>
            </Button>
            <Button asChild>
              <Link href="/admin/employees/new">
                <Plus /> Add employee
              </Link>
            </Button>
          </div>
        }
      />
      <Card className="gap-0 py-0">
        <form className="flex flex-wrap items-center gap-2 border-b p-3">
          <Input name="q" defaultValue={pick(sp.q)} placeholder="Name, code, phone or job" className="max-w-xs" aria-label="Search" />
          <select name="status" defaultValue={pick(sp.status) ?? ""} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" aria-label="Status">
            <option value="">Current staff</option>
            <option value="ACTIVE">Working</option>
            <option value="ON_LEAVE">On long leave</option>
            <option value="LEFT">Left</option>
            <option value="ALL">Everyone</option>
          </select>
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </form>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead className="hidden md:table-cell">Shift</TableHead>
              <TableHead className="hidden lg:table-cell">Login</TableHead>
              {sensitive && <TableHead className="text-right">Pay</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                  No employees yet.
                </TableCell>
              </TableRow>
            )}
            {rows.map((e) => (
              <TableRow key={e.id} className="relative" data-testid={`employee-${e.fullName}`}>
                <TableCell>
                  <Link href={`/admin/employees/${e.id}`} className="font-medium after:absolute after:inset-0">
                    {e.fullName}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {e.employeeCode} · {e.designation} · since {formatDate(e.joiningDate)}
                    {e.status !== "ACTIVE" && (
                      <Badge variant="outline" className="ml-2">
                        {e.status === "LEFT" ? "Left" : "On leave"}
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell">{e.workShift ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="hidden text-sm lg:table-cell">{e.userName ?? <span className="text-muted-foreground">Not linked</span>}</TableCell>
                {sensitive && (
                  <TableCell className="text-right tabular">
                    {formatMoney(e.baseRate!)} <span className="text-xs text-muted-foreground">{PAY[e.payType!]}</span>
                    {e.openAdvances && money(e.openAdvances).greaterThan(0) && <div className="text-xs text-warning">Advance {formatMoney(e.openAdvances)}</div>}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
