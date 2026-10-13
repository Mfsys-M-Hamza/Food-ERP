import Link from "next/link";
import type { Metadata } from "next";
import { requireStaffPage } from "@/server/core/page-guard";
import { can, canAny } from "@/server/core/rbac";
import { listPayrollRuns } from "@/server/modules/people/payroll";
import { todayFor } from "@/server/core/today";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { NewPayrollRunButton } from "@/features/people/payroll-ui";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Payroll" };

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  DRAFT: { label: "Draft", variant: "outline" },
  APPROVED: { label: "Approved, to pay", variant: "default" },
  PAID: { label: "Paid", variant: "secondary" },
  CANCELLED: { label: "Cancelled", variant: "outline" },
};

export default async function PayrollPage() {
  const ctx = await requireStaffPage("/admin/payroll");
  if (!canAny(ctx, ["payroll.prepare", "payroll.approve"])) return <AccessDenied />;
  const [runs, today] = await Promise.all([listPayrollRuns(ctx), todayFor(ctx.branchId)]);
  const [y, m] = today.split("-").map(Number) as [number, number];
  const lastMonth = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  return (
    <>
      <PageHeader
        title="Payroll"
        description="Prepare salaries from attendance, review, approve, then record payment. Approved payroll cannot be changed."
        actions={can(ctx, "payroll.prepare") && <NewPayrollRunButton defaultMonth={lastMonth} />}
      />
      <Card className="gap-0 py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Payroll</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden text-right md:table-cell">Staff</TableHead>
              <TableHead className="text-right">Net pay</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                  No payroll yet.
                </TableCell>
              </TableRow>
            )}
            {runs.map((r) => (
              <TableRow key={r.id} className="relative">
                <TableCell>
                  <Link href={`/admin/payroll/${r.id}`} className="font-medium after:absolute after:inset-0">
                    {r.runNumber}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {formatDate(r.periodStart)} – {formatDate(r.periodEnd)}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS[r.status]!.variant}>{STATUS[r.status]!.label}</Badge>
                </TableCell>
                <TableCell className="hidden text-right md:table-cell">{r.employees}</TableCell>
                <TableCell className="text-right tabular">{formatMoney(r.net)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
