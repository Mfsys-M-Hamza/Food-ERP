import Link from "next/link";
import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { requireStaffPage } from "@/server/core/page-guard";
import { can, canAny } from "@/server/core/rbac";
import { listPurchases } from "@/server/modules/purchasing/service";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Purchases" };

function statusBadge(p: { status: string; paymentStatus: string; overdue: boolean }) {
  if (p.status === "DRAFT") return <Badge variant="outline">Draft</Badge>;
  if (p.status === "CANCELLED") return <Badge variant="outline">Cancelled</Badge>;
  if (p.paymentStatus === "PAID") return <Badge variant="secondary">Paid</Badge>;
  return <Badge variant={p.overdue ? "destructive" : "default"}>{p.overdue ? "Overdue" : p.paymentStatus === "PARTIALLY_PAID" ? "Part paid" : "Unpaid"}</Badge>;
}

export default async function PurchasesPage({ searchParams }: PageProps<"/admin/purchases">) {
  const ctx = await requireStaffPage("/admin/purchases");
  if (!canAny(ctx, ["purchases.manage", "purchases.pay"])) return <AccessDenied />;
  const sp = await searchParams;
  const pick = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const rows = await listPurchases(ctx, { status: pick(sp.status), payment: pick(sp.payment), q: pick(sp.q) });
  return (
    <>
      <PageHeader
        title="Purchases"
        description="Supplier invoices. Receiving a purchase adds the stock and updates food costs."
        actions={
          can(ctx, "purchases.manage") && (
            <Button asChild>
              <Link href="/admin/purchases/new">
                <Plus /> New purchase
              </Link>
            </Button>
          )
        }
      />
      <Card className="gap-0 py-0">
        <form className="flex flex-wrap items-center gap-2 border-b p-3">
          <Input name="q" defaultValue={pick(sp.q)} placeholder="Purchase or invoice no." className="max-w-xs" aria-label="Search" />
          <select name="status" defaultValue={pick(sp.status) ?? ""} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" aria-label="Status">
            <option value="">All</option>
            <option value="DRAFT">Drafts</option>
            <option value="RECEIVED">Received</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
          <select name="payment" defaultValue={pick(sp.payment) ?? ""} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" aria-label="Payment">
            <option value="">Any payment</option>
            <option value="UNPAID">Unpaid</option>
            <option value="PARTIALLY_PAID">Part paid</option>
            <option value="PAID">Paid</option>
          </select>
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </form>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Purchase</TableHead>
              <TableHead className="hidden md:table-cell">Supplier</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                  No purchases.
                </TableCell>
              </TableRow>
            )}
            {rows.map((p) => (
              <TableRow key={p.id} className="relative">
                <TableCell>
                  <Link href={`/admin/purchases/${p.id}`} className="font-medium after:absolute after:inset-0">
                    {p.purchaseNumber}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {formatDate(p.invoiceDate)}
                    {p.invoiceNo && ` · #${p.invoiceNo}`} · {p.items} items
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell">{p.supplierName}</TableCell>
                <TableCell>{statusBadge(p)}</TableCell>
                <TableCell className="text-right tabular">{formatMoney(p.total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
