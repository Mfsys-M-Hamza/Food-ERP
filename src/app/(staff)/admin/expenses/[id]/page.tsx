import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, FileText, Pencil } from "lucide-react";
import { z } from "zod";
import { requireStaffPage } from "@/server/core/page-guard";
import { can, canAny } from "@/server/core/rbac";
import { isAppError } from "@/server/core/errors";
import { getExpense, listExpenseCategories, drawerOptions } from "@/server/modules/expenses/service";
import { todayFor } from "@/server/core/today";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { ExpenseDialog, VoidExpenseButton, AttachReceiptButton } from "@/features/expenses/expense-dialog";
import { METHOD_LABEL } from "@/lib/expenses";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Expense" };

export default async function ExpensePage({ params }: PageProps<"/admin/expenses/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await requireStaffPage(`/admin/expenses/${id}`);
  if (!canAny(ctx, ["expenses.create", "expenses.manage"])) return <AccessDenied />;
  const e = await getExpense(ctx, id).catch((err) => {
    if (isAppError(err) && err.code === "NOT_FOUND") notFound();
    throw err;
  });
  const manage = can(ctx, "expenses.manage");
  const active = e.status === "ACTIVE";
  const editable = manage && active && !e.sourceType;
  const [categories, tills, today] = editable ? await Promise.all([listExpenseCategories(ctx), drawerOptions(ctx), todayFor(ctx.branchId)]) : [[], [], ""];
  const source =
    e.sourceType === "payslip" ? "Paid salary (from payroll)" : e.sourceType === "employee_advance" ? "Salary advance (from the employee's page)" : null;

  const rows: [string, React.ReactNode][] = [
    ["Category", e.category],
    ["Date", formatDate(e.expenseDate)],
    ["Paid by", METHOD_LABEL[e.paymentMethod]],
    ...(e.shift ? ([["Till shift", <Link key="s" className="underline" href={`/admin/cash-shifts/${e.shift.id}`}>{`${e.shift.shiftNumber} · ${e.shift.terminal}`}</Link>]] as [string, React.ReactNode][]) : []),
    ["Paid to", e.payee || "—"],
    ["Reference", e.reference || "—"],
    ["Recorded by", `${e.createdBy ?? "—"} · ${formatDateTime(e.createdAt)}`],
    ...(source ? ([["Created by", source]] as [string, React.ReactNode][]) : []),
  ];

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link href="/admin/expenses">
          <ArrowLeft /> Expenses
        </Link>
      </Button>
      <PageHeader
        title={`${e.expenseNumber} · ${formatMoney(e.amount)}`}
        description={e.description}
        actions={
          <div className="flex flex-wrap gap-2">
            {active && !e.receipt && (manage || !e.sourceType) && <AttachReceiptButton id={e.id} />}
            {editable && (
              <ExpenseDialog
                id={e.id}
                categories={categories}
                tills={e.terminalId && !tills.some((t) => t.terminalId === e.terminalId) ? [...tills, { terminalId: e.terminalId, label: e.shift?.terminal ?? "Till" }] : tills}
                canManage
                today={today}
                initial={{ categoryId: e.categoryId, amount: e.amount, expenseDate: e.expenseDate, paymentMethod: e.paymentMethod, terminalId: e.terminalId ?? "", payee: e.payee, description: e.description, reference: e.reference }}
                trigger={
                  <Button variant="outline">
                    <Pencil /> Edit
                  </Button>
                }
              />
            )}
            {editable && (!e.shift || e.shift.open) && <VoidExpenseButton id={e.id} />}
          </div>
        }
      />
      {!active && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <Badge variant="destructive" className="mr-2">
            Void
          </Badge>
          {e.voidReason} · {e.voidedBy} · {formatDateTime(e.voidedAt)}
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card className="py-0">
          <CardContent className="p-0">
            <dl className="divide-y text-sm">
              {rows.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 px-4 py-3">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="text-right">{v}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="mb-2 text-sm font-medium">Receipt</div>
            {e.receipt ? (
              e.receipt.mimeType === "application/pdf" ? (
                <Button asChild variant="outline">
                  <a href={`/api/v1/files/${e.receipt.id}`} target="_blank" rel="noreferrer">
                    <FileText /> Open PDF
                  </a>
                </Button>
              ) : (
                <a href={`/api/v1/files/${e.receipt.id}`} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- private, authorised file */}
                  <img src={`/api/v1/files/${e.receipt.id}`} alt="Receipt" className="max-h-96 w-full rounded-md border object-contain" data-testid="receipt-image" />
                </a>
              )
            ) : (
              <p className="text-sm text-muted-foreground">No receipt attached.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
