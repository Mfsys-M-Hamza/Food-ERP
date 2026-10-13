import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { requireStaffPage } from "@/server/core/page-guard";
import { can, canAny } from "@/server/core/rbac";
import { isAppError } from "@/server/core/errors";
import { getIngredient, ingredientLedger } from "@/server/modules/inventory/service";
import { listSuppliers } from "@/server/modules/purchasing/service";
import { PageHeader } from "@/components/shared/page-header";
import { AccessDenied } from "@/components/shared/access-denied";
import { IngredientForm } from "@/features/inventory/ingredient-form";
import { AdjustStockButton } from "@/features/inventory/adjust-dialog";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatQty } from "@/lib/units";
import { formatMoney, money } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Ingredient" };

const TYPE: Record<string, string> = {
  OPENING: "Opening stock",
  PURCHASE: "Purchase",
  SALE: "Sold",
  SALE_REVERSAL: "Sale reversed",
  WASTAGE: "Wastage",
  ADJUSTMENT: "Adjustment",
  COUNT_VARIANCE: "Stock count",
  TRANSFER_IN: "Transfer in",
  TRANSFER_OUT: "Transfer out",
};

export default async function IngredientPage({ params }: PageProps<"/admin/inventory/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await requireStaffPage(`/admin/inventory/${id}`);
  if (!canAny(ctx, ["inventory.view", "inventory.manage"])) return <AccessDenied />;
  const i = await getIngredient(ctx, id).catch((e) => {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const manage = can(ctx, "inventory.manage");
  const [ledger, suppliers] = await Promise.all([ingredientLedger(ctx, id), manage ? listSuppliers(ctx) : Promise.resolve([])]);

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link href="/admin/inventory">
          <ArrowLeft /> Ingredients
        </Link>
      </Button>
      <PageHeader
        title={i.name}
        description={`In stock: ${formatQty(i.onHand, i.baseUnit)} · average cost ${formatMoney(i.averageCost)} per ${i.baseUnit}`}
        actions={manage && <AdjustStockButton ingredientId={i.id} name={i.name} onHandText={formatQty(i.onHand, i.baseUnit)} />}
      />
      <div className="grid gap-6 xl:grid-cols-[440px_1fr]">
        {manage ? (
          <IngredientForm id={i.id} initial={i} suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))} baseUnitLocked={ledger.length > 0} />
        ) : (
          <div />
        )}
        <Card className="gap-0 py-0">
          <CardHeader className="py-4">
            <CardTitle>Stock movements</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Movement</TableHead>
                <TableHead className="text-right">Change</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledger.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                    No movements yet.
                  </TableCell>
                </TableRow>
              )}
              {ledger.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="text-sm text-muted-foreground">{formatDateTime(l.createdAt)}</TableCell>
                  <TableCell>
                    <div className="text-sm font-medium">{TYPE[l.type]}</div>
                    <div className="text-xs text-muted-foreground">
                      {[l.reason, l.by].filter(Boolean).join(" · ")}
                      {l.referenceType === "order" && l.referenceId && (
                        <>
                          {" · "}
                          <Link className="underline" href={`/admin/orders/${l.referenceId}`}>
                            order
                          </Link>
                        </>
                      )}
                      {l.referenceType === "purchase" && l.referenceId && (
                        <>
                          {" · "}
                          <Link className="underline" href={`/admin/purchases/${l.referenceId}`}>
                            purchase
                          </Link>
                        </>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className={cn("text-right tabular", money(l.quantity).isNegative() ? "text-destructive" : "text-success")}>
                    {money(l.quantity).isNegative() ? "" : "+"}
                    {formatQty(l.quantity, i.baseUnit)}
                  </TableCell>
                  <TableCell className="text-right tabular">{formatQty(l.balanceAfter, i.baseUnit)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
    </>
  );
}
