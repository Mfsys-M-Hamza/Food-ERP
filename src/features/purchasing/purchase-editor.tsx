"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PackageCheck, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { savePurchaseAction, receivePurchaseAction, cancelPurchaseAction } from "@/server/modules/purchasing/actions";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { formatMoney, money } from "@/lib/money";

type IngOpt = { id: string; name: string; baseUnit: string; defaultSupplierId: string | null; lastPurchaseCost: string | null; units: { unit: string; factor: string }[] };
type Line = { ingredientId: string; quantity: string; unit: string; unitCost: string };
type Values = { supplierId: string; supplierInvoiceNo: string; invoiceDate: string; dueDate: string; discount: string; tax: string; notes: string; items: Line[] };

const NUM = /^\d+(\.\d+)?$/;

export function PurchaseEditor({
  id,
  initial,
  suppliers,
  ingredients,
  editable,
  canReceive,
}: {
  id?: string;
  initial: Values;
  suppliers: { id: string; name: string }[];
  ingredients: IngOpt[];
  editable: boolean;
  canReceive: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState<Values>(initial);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const subtotal = useMemo(() => v.items.reduce((s, l) => (NUM.test(l.quantity) && NUM.test(l.unitCost) ? s.plus(money(l.quantity).times(l.unitCost)) : s), money(0)), [v.items]);
  const total = subtotal.minus(NUM.test(v.discount) ? v.discount : 0).plus(NUM.test(v.tax) ? v.tax : 0);
  const setLine = (i: number, patch: Partial<Line>) => setV({ ...v, items: v.items.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const suggested = ingredients.filter((i) => !v.supplierId || i.defaultSupplierId === v.supplierId);

  function save(thenReceive: boolean) {
    setErrors({});
    start(async () => {
      const r = await savePurchaseAction(id ?? null, v);
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        return void toast.error(r.fieldErrors ? Object.values(r.fieldErrors)[0]![0] : r.error);
      }
      if (thenReceive) {
        const rec = await receivePurchaseAction(r.data.id);
        if (!rec.ok) return void toast.error(rec.error);
        toast.success(rec.message);
      } else toast.success(r.message);
      router.push(`/admin/purchases/${r.data.id}`);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{editable ? (id ? "Edit draft" : "New purchase") : "Invoice"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <fieldset disabled={!editable || pending} className="grid gap-4 md:grid-cols-4">
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="pu-supplier">Supplier</Label>
            <select id="pu-supplier" className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" value={v.supplierId} onChange={(e) => setV({ ...v, supplierId: e.target.value })} aria-invalid={!!errors.supplierId}>
              <option value="">Choose…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pu-inv">Supplier invoice no.</Label>
            <Input id="pu-inv" value={v.supplierInvoiceNo} onChange={(e) => setV({ ...v, supplierInvoiceNo: e.target.value })} aria-invalid={!!errors.supplierInvoiceNo} />
            {errors.supplierInvoiceNo && <p className="text-xs text-destructive">{errors.supplierInvoiceNo[0]}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pu-date">Invoice date</Label>
            <Input id="pu-date" type="date" value={v.invoiceDate} onChange={(e) => setV({ ...v, invoiceDate: e.target.value })} />
          </div>
        </fieldset>

        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Ingredient</th>
                <th className="px-3 py-2 font-medium">Qty</th>
                <th className="px-3 py-2 font-medium">Unit</th>
                <th className="px-3 py-2 font-medium">Price per unit</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="w-0" />
              </tr>
            </thead>
            <tbody>
              {v.items.map((l, i) => {
                const ing = ingredients.find((x) => x.id === l.ingredientId);
                const lineTotal = NUM.test(l.quantity) && NUM.test(l.unitCost) ? money(l.quantity).times(l.unitCost) : null;
                return (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-2">
                      <select
                        aria-label={`Line ${i + 1} ingredient`}
                        disabled={!editable}
                        className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                        value={l.ingredientId}
                        onChange={(e) => {
                          const next = ingredients.find((x) => x.id === e.target.value);
                          const unit = next?.units.find((u) => u.unit === "kg" || u.unit === "l")?.unit ?? next?.units[0]?.unit ?? "";
                          const factor = next?.units.find((u) => u.unit === unit)?.factor ?? "1";
                          setLine(i, { ingredientId: e.target.value, unit, unitCost: next?.lastPurchaseCost ? money(next.lastPurchaseCost).times(factor).toDecimalPlaces(2).toString() : "" });
                        }}
                      >
                        <option value="">Choose…</option>
                        {(suggested.length ? [...suggested, ...ingredients.filter((x) => !suggested.includes(x))] : ingredients).map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <Input aria-label={`Line ${i + 1} quantity`} disabled={!editable} inputMode="decimal" className="h-9 w-24 tabular" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value.replace(/[^\d.]/g, "") })} />
                    </td>
                    <td className="px-3 py-2">
                      <select aria-label={`Line ${i + 1} unit`} disabled={!editable} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })}>
                        {(ing?.units ?? []).map((u) => (
                          <option key={u.unit} value={u.unit}>
                            {u.unit}
                            {u.factor !== "1" ? ` (${Number(u.factor)} ${ing!.baseUnit})` : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <Input aria-label={`Line ${i + 1} price`} disabled={!editable} inputMode="decimal" className="h-9 w-28 tabular" value={l.unitCost} onChange={(e) => setLine(i, { unitCost: e.target.value.replace(/[^\d.]/g, "") })} />
                    </td>
                    <td className="px-3 py-2 text-right tabular">{lineTotal ? formatMoney(lineTotal) : "—"}</td>
                    <td className="px-2">
                      {editable && (
                        <Button variant="ghost" size="icon" aria-label="Remove line" onClick={() => setV({ ...v, items: v.items.filter((_, j) => j !== i) })}>
                          <Trash2 />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {editable && (
          <Button variant="outline" size="sm" onClick={() => setV({ ...v, items: [...v.items, { ingredientId: "", quantity: "", unit: "", unitCost: "" }] })}>
            <Plus /> Add line
          </Button>
        )}
        {errors.items && <p className="text-sm text-destructive">{errors.items[0]}</p>}

        <div className="grid gap-6 md:grid-cols-[1fr_300px]">
          <fieldset disabled={!editable || pending} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pu-due">Payment due (optional)</Label>
              <Input id="pu-due" type="date" className="w-auto" value={v.dueDate} onChange={(e) => setV({ ...v, dueDate: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pu-notes">Notes</Label>
              <Textarea id="pu-notes" rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
            </div>
          </fieldset>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="tabular">{formatMoney(subtotal)}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Discount</dt>
              <Input aria-label="Discount" disabled={!editable} inputMode="decimal" className="h-8 w-28 text-right tabular" value={v.discount} onChange={(e) => setV({ ...v, discount: e.target.value.replace(/[^\d.]/g, "") })} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Tax</dt>
              <Input aria-label="Tax" disabled={!editable} inputMode="decimal" className="h-8 w-28 text-right tabular" value={v.tax} onChange={(e) => setV({ ...v, tax: e.target.value.replace(/[^\d.]/g, "") })} />
            </div>
            <div className="flex justify-between border-t pt-2 text-base font-semibold">
              <dt>Total</dt>
              <dd className="tabular" data-testid="purchase-total">{formatMoney(total)}</dd>
            </div>
          </dl>
        </div>
      </CardContent>
      {editable && (
        <CardFooter className="flex-wrap justify-end gap-2 border-t">
          {id && (
            <Button
              variant="ghost"
              className="mr-auto text-destructive"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await cancelPurchaseAction(id, "Cancelled draft");
                  if (r.ok) router.push("/admin/purchases");
                  else toast.error(r.error);
                })
              }
            >
              Cancel draft
            </Button>
          )}
          <Button variant="outline" disabled={pending} onClick={() => save(false)} data-testid="save-purchase">
            Save draft
          </Button>
          {canReceive && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button disabled={pending} data-testid="receive-purchase">
                  {pending ? <Loader2 className="animate-spin" /> : <PackageCheck />} Save & receive goods
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Receive these goods?</AlertDialogTitle>
                  <AlertDialogDescription>Stock increases now and the invoice can no longer be edited.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Not yet</AlertDialogCancel>
                  <AlertDialogAction onClick={() => save(true)} data-testid="confirm-receive">
                    Receive
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </CardFooter>
      )}
    </Card>
  );
}
