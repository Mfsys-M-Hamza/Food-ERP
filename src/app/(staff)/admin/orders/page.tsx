import Link from "next/link";
import type { Metadata } from "next";
import { Search } from "lucide-react";
import { requireStaffPage } from "@/server/core/page-guard";
import { can } from "@/server/core/rbac";
import { listOrders } from "@/server/modules/orders/service";
import { STATUS_LABEL } from "@/server/modules/orders/state-machine";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { Pagination } from "@/components/shared/pagination";
import { StatusBadge, PaymentBadge } from "@/features/orders/status-badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

export const metadata: Metadata = { title: "Orders" };

const pick = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);
const TYPE: Record<string, string> = { TAKEAWAY: "Takeaway", DELIVERY: "Delivery", DINE_IN: "Dine-in" };
const SELECT = "h-9 rounded-md border border-input bg-transparent px-2 text-sm";

export default async function OrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  const ctx = await requireStaffPage("/admin/orders");
  if (!can(ctx, "orders.view")) return <AccessDenied />;
  const sp = await searchParams;
  const f = {
    q: pick(sp.q),
    status: pick(sp.status),
    type: pick(sp.type),
    source: pick(sp.source),
    payment: pick(sp.payment),
    from: pick(sp.from),
    to: pick(sp.to),
  };
  const page = Number(pick(sp.page) ?? 1) || 1;
  const { rows, total, pageSize } = await listOrders(ctx, { ...f, page });
  const all = can(ctx, "orders.view_all");

  return (
    <>
      <PageHeader
        title="Orders"
        description={all ? "Every order from the POS, phone and online, in one list." : "Orders from the last 24 hours."}
      />
      <Card className="gap-0 py-0">
        <form className="flex flex-wrap items-center gap-2 border-b p-3" role="search">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input name="q" defaultValue={f.q} placeholder="Order no., customer, phone" className="pl-8" aria-label="Search orders" />
          </div>
          <select name="status" defaultValue={f.status ?? ""} className={SELECT} aria-label="Status">
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select name="type" defaultValue={f.type ?? ""} className={SELECT} aria-label="Type">
            <option value="">All types</option>
            {Object.entries(TYPE).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select name="source" defaultValue={f.source ?? ""} className={SELECT} aria-label="Source">
            <option value="">All sources</option>
            {["POS", "PHONE", "WEBSITE", "PWA", "ADMIN", "AGGREGATOR"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select name="payment" defaultValue={f.payment ?? ""} className={SELECT} aria-label="Payment">
            <option value="">Any payment</option>
            <option value="PAID">Paid</option>
            <option value="UNPAID">Unpaid</option>
            <option value="PARTIALLY_REFUNDED">Part refunded</option>
            <option value="REFUNDED">Refunded</option>
          </select>
          {all && (
            <>
              <Input type="date" name="from" defaultValue={f.from} className="w-auto" aria-label="From business date" />
              <Input type="date" name="to" defaultValue={f.to} className="w-auto" aria-label="To business date" />
            </>
          )}
          <Button type="submit" variant="secondary">
            Filter
          </Button>
          <Button asChild variant="ghost">
            <Link href="/admin/orders">Reset</Link>
          </Button>
        </form>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead className="hidden md:table-cell">Customer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden lg:table-cell">Payment</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-12 text-center text-muted-foreground">
                  No orders match.
                </TableCell>
              </TableRow>
            )}
            {rows.map((o) => (
              <TableRow key={o.id} className="relative">
                <TableCell>
                  <Link href={`/admin/orders/${o.id}`} className="font-medium after:absolute after:inset-0">
                    #{o.displayNumber} <span className="text-xs font-normal text-muted-foreground">{o.orderNumber}</span>
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {formatDateTime(o.createdAt)} · {TYPE[o.type]} · {o.source}
                  </div>
                </TableCell>
                <TableCell className="hidden text-sm md:table-cell">
                  {o.customerName ?? "Walk-in"}
                  {o.customerPhone && <div className="text-xs text-muted-foreground">{formatPhone(o.customerPhone)}</div>}
                </TableCell>
                <TableCell>
                  <StatusBadge status={o.status} />
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  <PaymentBadge status={o.paymentStatus} />
                </TableCell>
                <TableCell className="text-right tabular">{formatMoney(o.grandTotal)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Pagination page={page} pageSize={pageSize} total={total} basePath="/admin/orders" params={f} />
      </Card>
    </>
  );
}
