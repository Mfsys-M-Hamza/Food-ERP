import Link from "next/link";
import type { Metadata } from "next";
import { Paperclip, Plus, Tags } from "lucide-react";
import { requireStaffPage } from "@/server/core/page-guard";
import { can, canAny } from "@/server/core/rbac";
import { listExpenses, listExpenseCategories, drawerOptions, EXPENSE_METHODS } from "@/server/modules/expenses/service";
import { todayFor } from "@/server/core/today";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { ExpenseDialog } from "@/features/expenses/expense-dialog";
import { METHOD_LABEL } from "@/lib/expenses";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Expenses" };

export default async function ExpensesPage({ searchParams }: PageProps<"/admin/expenses">) {
  const ctx = await requireStaffPage("/admin/expenses");
  if (!canAny(ctx, ["expenses.create", "expenses.manage"])) return <AccessDenied />;
  const sp = await searchParams;
  const pick = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const manage = can(ctx, "expenses.manage");
  const f = { from: pick(sp.from), to: pick(sp.to), categoryId: pick(sp.category), method: pick(sp.method), status: pick(sp.status), q: pick(sp.q) };
  const [data, categories, allCategories, tills, today] = await Promise.all([
    listExpenses(ctx, f),
    listExpenseCategories(ctx),
    listExpenseCategories(ctx, { includeSystem: true, includeInactive: true }),
    drawerOptions(ctx),
    todayFor(ctx.branchId),
  ]);

  return (
    <>
      <PageHeader
        title="Expenses"
        description={manage ? "Bills, petty cash, salary advances and paid salaries." : "Cash you have paid from your till."}
        actions={
          <div className="flex gap-2">
            {manage && (
              <Button asChild variant="outline">
                <Link href="/admin/expenses/categories">
                  <Tags /> Categories
                </Link>
              </Button>
            )}
            <ExpenseDialog
              categories={categories}
              tills={tills}
              canManage={manage}
              today={today}
              trigger={
                <Button data-testid="new-expense">
                  <Plus /> Record expense
                </Button>
              }
            />
          </div>
        }
      />
      <div className="mb-6 flex flex-wrap gap-3">
        <Card className="min-w-44 py-4">
          <CardContent>
            <div className="text-xs text-muted-foreground">
              {formatDate(data.from)} – {formatDate(data.to)}
            </div>
            <div className="text-2xl font-semibold tabular" data-testid="expense-total">
              {formatMoney(data.total)}
            </div>
          </CardContent>
        </Card>
        {data.byCategory.slice(0, 6).map((c) => (
          <Card key={c.name} className="min-w-36 py-4">
            <CardContent>
              <div className="text-xs text-muted-foreground">{c.name}</div>
              <div className="text-lg font-semibold tabular">{formatMoney(c.total)}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="gap-0 py-0">
        <form className="flex flex-wrap items-center gap-2 border-b p-3">
          <Input name="q" defaultValue={f.q} placeholder="Number, description or payee" className="max-w-xs" aria-label="Search" />
          <Input type="date" name="from" defaultValue={data.from} className="w-auto" aria-label="From" />
          <Input type="date" name="to" defaultValue={data.to} className="w-auto" aria-label="To" />
          <select name="category" defaultValue={f.categoryId ?? ""} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" aria-label="Category">
            <option value="">All categories</option>
            {allCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select name="method" defaultValue={f.method ?? ""} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" aria-label="Paid by">
            <option value="">Any method</option>
            {EXPENSE_METHODS.map((m) => (
              <option key={m} value={m}>
                {METHOD_LABEL[m]}
              </option>
            ))}
          </select>
          <select name="status" defaultValue={f.status ?? ""} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" aria-label="Status">
            <option value="">Active and void</option>
            <option value="ACTIVE">Active</option>
            <option value="VOIDED">Void</option>
          </select>
          <Button type="submit" variant="secondary">
            Filter
          </Button>
          <Button asChild variant="ghost">
            <Link href="/admin/expenses">Reset</Link>
          </Button>
        </form>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Expense</TableHead>
              <TableHead className="hidden md:table-cell">Category</TableHead>
              <TableHead className="hidden lg:table-cell">Paid by</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                  No expenses in this period.
                </TableCell>
              </TableRow>
            )}
            {data.rows.map((e) => (
              <TableRow key={e.id} className="relative" data-testid={`expense-${e.expenseNumber}`}>
                <TableCell>
                  <Link href={`/admin/expenses/${e.id}`} className="font-medium after:absolute after:inset-0">
                    {e.description}
                  </Link>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    {e.expenseNumber} · {formatDate(e.expenseDate)}
                    {e.payee && ` · ${e.payee}`}
                    {e.hasReceipt && <Paperclip className="size-3" aria-label="Receipt attached" />}
                    {e.status === "VOIDED" && (
                      <Badge variant="outline" className="ml-1">
                        Void
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell">{e.category}</TableCell>
                <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                  {METHOD_LABEL[e.paymentMethod]}
                  {e.createdBy && ` · ${e.createdBy}`}
                </TableCell>
                <TableCell className={`text-right tabular ${e.status === "VOIDED" ? "text-muted-foreground line-through" : ""}`}>{formatMoney(e.amount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
