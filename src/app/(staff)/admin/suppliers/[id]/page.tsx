import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, Pencil } from "lucide-react";
import { z } from "zod";
import { requireStaffPage } from "@/server/core/page-guard";
import { can, canAny } from "@/server/core/rbac";
import { isAppError } from "@/server/core/errors";
import { getSupplier } from "@/server/modules/purchasing/service";
import { listIngredients } from "@/server/modules/inventory/service";
import { listTerminals } from "@/server/modules/shifts/service";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { SupplierDialog, PaySupplierButton } from "@/features/purchasing/supplier-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatMoney, money } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { formatPhone, whatsappDigits } from "@/lib/phone";

export const metadata: Metadata = { title: "Supplier" };
const METHOD: Record<string, string> = { BANK_TRANSFER: "Bank transfer", CASH_DRAWER: "Cash (till)", CASH_OTHER: "Cash", CHEQUE: "Cheque", CARD: "Card" };

export default async function SupplierPage({ params }: PageProps<"/admin/suppliers/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await requireStaffPage(`/admin/suppliers/${id}`);
  if (!canAny(ctx, ["suppliers.manage", "purchases.pay"])) return <AccessDenied />;
  const d = await getSupplier(ctx, id).catch((e) => {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const [ingredients, terminals] = await Promise.all([listIngredients(ctx, {}), listTerminals(ctx)]);
  const s = d.supplier;
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link href="/admin/suppliers">
          <ArrowLeft /> Suppliers
        </Link>
      </Button>
      <PageHeader
        title={s.name}
        description={[s.contactPerson, formatPhone(s.phone), s.paymentTermsDays ? `${s.paymentTermsDays}-day terms` : null].filter(Boolean).join(" · ")}
        actions={
          <>
            {s.whatsapp && (
              <Button asChild variant="outline">
                <a href={`https://wa.me/${whatsappDigits(s.whatsapp)}`} target="_blank" rel="noopener noreferrer">
                  WhatsApp
                </a>
              </Button>
            )}
            {can(ctx, "suppliers.manage") && (
              <SupplierDialog
                id={s.id}
                initial={s}
                ingredients={ingredients.map((i) => ({ id: i.id, name: i.name }))}
                trigger={
                  <Button variant="outline">
                    <Pencil /> Edit
                  </Button>
                }
              />
            )}
            {can(ctx, "purchases.pay") && money(d.balance.outstanding).greaterThan(0) && <PaySupplierButton supplierId={s.id} due={d.balance.outstanding} terminals={terminals} />}
            {can(ctx, "purchases.manage") && (
              <Button asChild>
                <Link href={`/admin/purchases/new?supplier=${s.id}`}>New purchase</Link>
              </Button>
            )}
          </>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {[
          ["Purchased", d.balance.total],
          ["Paid", d.balance.paid],
          ["Outstanding", d.balance.outstanding],
        ].map(([k, v]) => (
          <Card key={k} className="py-4">
            <CardContent>
              <div className="text-xs text-muted-foreground">{k}</div>
              <div className="text-2xl font-semibold tabular" data-testid={`supplier-${k!.toLowerCase()}`}>{formatMoney(v!)}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card className="gap-0 py-0">
          <CardHeader className="py-4">
            <CardTitle>Purchases</CardTitle>
          </CardHeader>
          <ul className="divide-y border-t text-sm">
            {d.purchases.length === 0 && <li className="p-6 text-center text-muted-foreground">No purchases yet.</li>}
            {d.purchases.map((p) => (
              <li key={p.id}>
                <Link href={`/admin/purchases/${p.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50">
                  <span className="font-medium">{p.purchaseNumber}</span>
                  <span className="text-muted-foreground">{p.invoiceNo ? `#${p.invoiceNo}` : ""}</span>
                  <span className="text-muted-foreground">{formatDate(p.invoiceDate)}</span>
                  <Badge variant={p.status === "DRAFT" ? "outline" : p.paymentStatus === "PAID" ? "secondary" : "default"} className="ml-auto">
                    {p.status === "DRAFT" ? "Draft" : p.status === "CANCELLED" ? "Cancelled" : p.paymentStatus === "PAID" ? "Paid" : p.paymentStatus === "PARTIALLY_PAID" ? "Part paid" : "Unpaid"}
                  </Badge>
                  <span className="w-28 text-right tabular">{formatMoney(p.total)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Payments</CardTitle>
            </CardHeader>
            <CardContent>
              {d.payments.length === 0 && <p className="text-sm text-muted-foreground">No payments yet.</p>}
              <ul className="space-y-2 text-sm">
                {d.payments.map((p) => (
                  <li key={p.id} className="flex justify-between gap-2">
                    <span>
                      {METHOD[p.method]} <span className="text-muted-foreground">· {formatDate(p.paidAt)}{p.reference ? ` · ${p.reference}` : ""}</span>
                    </span>
                    <span className="tabular">{formatMoney(p.amount)}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Supplies</CardTitle>
            </CardHeader>
            <CardContent>
              {d.ingredients.length === 0 && <p className="text-sm text-muted-foreground">Nothing linked.</p>}
              <ul className="space-y-1 text-sm">
                {d.ingredients.map((i) => (
                  <li key={i.id} className="flex justify-between">
                    <Link href={`/admin/inventory/${i.id}`} className="hover:underline">
                      {i.name}
                    </Link>
                    <span className="text-muted-foreground tabular">{i.lastUnitCost ? `${formatMoney(i.lastUnitCost)}/${i.baseUnit}` : ""}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
