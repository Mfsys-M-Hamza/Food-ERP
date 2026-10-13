import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { requireStaffPage } from "@/server/core/page-guard";
import { can } from "@/server/core/rbac";
import { isAppError } from "@/server/core/errors";
import { getShiftSummary, listShiftTransactions } from "@/server/modules/shifts/service";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatMoney, money } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ApproveShiftButton } from "./approve-button";

export const metadata: Metadata = { title: "Cash shift" };

const TX_LABEL: Record<string, string> = {
  SALE: "Cash sale",
  REFUND: "Cash refund",
  EXPENSE: "Expense",
  PAY_IN: "Pay-in",
  PAY_OUT: "Pay-out",
  RIDER_SETTLEMENT: "Rider settlement",
  SUPPLIER_PAYMENT: "Supplier payment",
  ADJUSTMENT: "Adjustment",
};

export default async function ShiftPage({ params }: PageProps<"/admin/cash-shifts/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await requireStaffPage(`/admin/cash-shifts/${id}`);
  let s, txs;
  try {
    [s, txs] = await Promise.all([getShiftSummary(ctx, id), listShiftTransactions(ctx, id)]);
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    if (isAppError(e) && e.code === "PERMISSION_DENIED") return <AccessDenied />;
    throw e;
  }
  const rows: [string, string, string?][] = [
    ["Opening cash", s.openingCash],
    ["Cash sales", s.cashSales],
    ["Cash refunds", `-${s.cashRefunds}`],
    ["Pay-ins", s.payIns],
    ["Pay-outs", `-${s.payOuts}`],
    ["Expenses from drawer", `-${s.expenses}`],
    ["Supplier payments", `-${s.supplierPayments}`],
    ["Rider cash settled", s.riderSettlements],
  ];
  const diff = s.difference ? money(s.difference) : null;

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link href="/admin/cash-shifts">
          <ArrowLeft /> Cash shifts
        </Link>
      </Button>
      <PageHeader
        title={`Shift ${s.shiftNumber}`}
        description={`${s.terminalName} · opened by ${s.openedBy} ${formatDateTime(s.openedAt)}${s.closedAt ? ` · closed ${formatDateTime(s.closedAt)} by ${s.closedBy}` : ""}`}
        actions={s.status === "CLOSED" && can(ctx, "shifts.approve") ? <ApproveShiftButton shiftId={s.id} /> : undefined}
      />
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Cash reconciliation</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y text-sm">
                {rows.map(([k, v]) => (
                  <div key={k} className="flex justify-between py-1.5">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="tabular">{formatMoney(v)}</dd>
                  </div>
                ))}
                <div className="flex justify-between py-2 font-semibold">
                  <dt>Expected cash</dt>
                  <dd className="tabular">{formatMoney(s.expectedCash)}</dd>
                </div>
                {s.countedCash && (
                  <>
                    <div className="flex justify-between py-1.5">
                      <dt className="text-muted-foreground">Counted cash</dt>
                      <dd className="tabular">{formatMoney(s.countedCash)}</dd>
                    </div>
                    <div className={cn("flex justify-between py-2 font-semibold", diff && !diff.isZero() ? "text-destructive" : "text-success")}>
                      <dt>{diff && diff.isNegative() ? "Shortage" : diff && !diff.isZero() ? "Excess" : "Difference"}</dt>
                      <dd className="tabular">{formatMoney(diff?.abs() ?? 0)}</dd>
                    </div>
                  </>
                )}
              </dl>
              {s.closingNote && <p className="mt-3 rounded-lg bg-muted/50 p-3 text-sm">Note: {s.closingNote}</p>}
              {s.approvedBy && <p className="mt-3 text-sm text-muted-foreground">Approved by {s.approvedBy}</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Non-cash sales</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Card</span>
                <span className="tabular">{formatMoney(s.cardSales)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Online / wallet</span>
                <span className="tabular">{formatMoney(s.onlineSales)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Orders in shift</span>
                <span className="tabular">{s.orderCount}</span>
              </div>
            </CardContent>
          </Card>
          {s.denominations && (
            <Card>
              <CardHeader>
                <CardTitle>Notes counted</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-1 text-sm tabular">
                {Object.entries(s.denominations)
                  .sort((a, b) => Number(b[0]) - Number(a[0]))
                  .map(([d, n]) => (
                    <span key={d}>
                      {d} × {n}
                    </span>
                  ))}
              </CardContent>
            </Card>
          )}
        </div>
        <Card className="gap-0 py-0">
          <CardHeader className="py-4">
            <CardTitle>Cash movements</CardTitle>
          </CardHeader>
          <ul className="divide-y border-t text-sm">
            {txs.length === 0 && <li className="p-6 text-center text-muted-foreground">No cash movements.</li>}
            {txs.map((t) => (
              <li key={t.id} className="flex justify-between gap-4 px-4 py-2.5">
                <span>
                  {TX_LABEL[t.type] ?? t.type}
                  {t.reason && <span className="text-muted-foreground"> · {t.reason}</span>}
                  <span className="block text-xs text-muted-foreground">
                    {formatDateTime(t.createdAt)} · {t.createdBy}
                  </span>
                </span>
                <span className={cn("tabular", money(t.amount).isNegative() && "text-destructive")}>{formatMoney(t.amount)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
