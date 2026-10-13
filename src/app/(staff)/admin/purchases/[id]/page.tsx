import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { requireStaffPage } from "@/server/core/page-guard";
import { can, canAny } from "@/server/core/rbac";
import { isAppError } from "@/server/core/errors";
import { getPurchase, listSuppliers } from "@/server/modules/purchasing/service";
import { ingredientOptions } from "@/server/modules/inventory/service";
import { listTerminals } from "@/server/modules/shifts/service";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { PurchaseEditor } from "@/features/purchasing/purchase-editor";
import { PaySupplierButton } from "@/features/purchasing/supplier-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatMoney, money } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Purchase" };

export default async function PurchasePage({ params }: PageProps<"/admin/purchases/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await requireStaffPage(`/admin/purchases/${id}`);
  if (!canAny(ctx, ["purchases.manage", "purchases.pay"])) return <AccessDenied />;
  const p = await getPurchase(ctx, id).catch((e) => {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const [suppliers, ingredients, terminals] = await Promise.all([listSuppliers(ctx), ingredientOptions(ctx).catch(() => []), listTerminals(ctx)]);
  const draft = p.status === "DRAFT";
  const statusText =
    p.status === "RECEIVED" ? `received ${formatDateTime(p.receivedAt)}` : p.status === "CANCELLED" ? "cancelled" : "draft, stock not added yet";
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link href="/admin/purchases">
          <ArrowLeft /> Purchases
        </Link>
      </Button>
      <PageHeader
        title={`Purchase ${p.purchaseNumber}`}
        description={`${p.supplier.name} · ${statusText}`}
        actions={
          p.status === "RECEIVED" && can(ctx, "purchases.pay") && money(p.balance).greaterThan(0) ? (
            <PaySupplierButton supplierId={p.supplier.id} purchaseId={p.id} due={p.balance} terminals={terminals} label="Pay this invoice" />
          ) : undefined
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <PurchaseEditor
          id={p.id}
          initial={{
            supplierId: p.supplier.id,
            supplierInvoiceNo: p.supplierInvoiceNo,
            invoiceDate: p.invoiceDate,
            dueDate: p.dueDate,
            discount: p.discount,
            tax: p.tax,
            notes: p.notes,
            items: p.items.map((i) => ({ ingredientId: i.ingredientId, quantity: i.quantity, unit: i.unit, unitCost: i.unitCost })),
          }}
          suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
          ingredients={
            ingredients.length
              ? ingredients
              : p.items.map((i) => ({ id: i.ingredientId, name: i.name, baseUnit: i.baseUnit, defaultSupplierId: null, lastPurchaseCost: null, units: [{ unit: i.unit, factor: "1" }] }))
          }
          editable={draft && can(ctx, "purchases.manage")}
          canReceive={draft && can(ctx, "purchases.manage")}
        />
        {p.status === "RECEIVED" && (
          <Card>
            <CardHeader>
              <CardTitle>Payment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total</span>
                <span className="tabular">{formatMoney(p.total)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Paid</span>
                <span className="tabular">{formatMoney(p.amountPaid)}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Balance</span>
                <span className="tabular" data-testid="purchase-balance">
                  {formatMoney(p.balance)}
                </span>
              </div>
              {p.dueDate && <p className="text-muted-foreground">Due {formatDate(p.dueDate)}</p>}
              <ul className="space-y-1 border-t pt-2">
                {p.payments.map((x) => (
                  <li key={x.id} className="flex justify-between text-muted-foreground">
                    <span>
                      {formatDate(x.paidAt)} · {x.method.replace("_", " ").toLowerCase()}
                    </span>
                    <span className="tabular">{formatMoney(x.amount)}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
