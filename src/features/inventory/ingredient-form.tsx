"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { saveIngredientAction, archiveIngredientAction } from "@/server/modules/inventory/actions";
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { BASE_UNIT_LABEL, type BaseUnit } from "@/lib/units";

type Values = {
  name: string;
  sku: string;
  category: string;
  baseUnit: BaseUnit;
  minStock: string;
  reorderQty: string;
  defaultSupplierId: string;
  trackStock: boolean;
  isActive: boolean;
  units: { unit: string; factor: string }[];
  openingQty?: string;
  openingUnitCost?: string;
};

export function IngredientForm({
  id,
  initial,
  suppliers,
  baseUnitLocked,
}: {
  id?: string;
  initial?: Values;
  suppliers: { id: string; name: string }[];
  baseUnitLocked?: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState<Values>(
    initial ?? { name: "", sku: "", category: "", baseUnit: "g", minStock: "0", reorderQty: "0", defaultSupplierId: "", trackStock: true, isActive: true, units: [], openingQty: "", openingUnitCost: "" },
  );
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const set = (patch: Partial<Values>) => setV({ ...v, ...patch });
  const err = (k: string) => errors[k]?.[0];
  const unitWord = v.baseUnit === "piece" ? "pieces" : v.baseUnit;

  function save() {
    setErrors({});
    start(async () => {
      const r = await saveIngredientAction(id ?? null, { ...v, openingQty: v.openingQty || undefined, openingUnitCost: v.openingUnitCost || undefined });
      if (r.ok) {
        toast.success(r.message);
        if (!id) router.push(`/admin/inventory/${r.data.id}`);
      } else {
        setErrors(r.fieldErrors ?? {});
        toast.error(r.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{id ? "Details" : "New ingredient"}</CardTitle>
        <CardDescription>Stock is kept in {BASE_UNIT_LABEL[v.baseUnit]}. Recipes use the same unit.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 md:grid-cols-2">
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="i-name">Name</Label>
          <Input id="i-name" value={v.name} onChange={(e) => set({ name: e.target.value })} aria-invalid={!!err("name")} />
          {err("name") && <p className="text-sm text-destructive">{err("name")}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="i-cat">Category</Label>
          <Input id="i-cat" value={v.category} onChange={(e) => set({ category: e.target.value })} placeholder="Meat, Bakery, Dairy, Packaging…" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="i-sku">Code (optional)</Label>
          <Input id="i-sku" value={v.sku} onChange={(e) => set({ sku: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="i-base">Stock unit</Label>
          <select
            id="i-base"
            className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm disabled:opacity-60"
            value={v.baseUnit}
            disabled={baseUnitLocked}
            onChange={(e) => set({ baseUnit: e.target.value as BaseUnit })}
          >
            <option value="g">Grams (buy in kg)</option>
            <option value="ml">Millilitres (buy in litres)</option>
            <option value="piece">Pieces</option>
          </select>
          {err("baseUnit") && <p className="text-sm text-destructive">{err("baseUnit")}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="i-sup">Main supplier</Label>
          <select id="i-sup" className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" value={v.defaultSupplierId} onChange={(e) => set({ defaultSupplierId: e.target.value })}>
            <option value="">—</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="i-min">Minimum stock ({unitWord})</Label>
          <Input id="i-min" inputMode="decimal" className="tabular" value={v.minStock} onChange={(e) => set({ minStock: e.target.value })} aria-invalid={!!err("minStock")} />
          <p className="text-xs text-muted-foreground">You are alerted when stock falls below this.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="i-reorder">Usual reorder quantity ({unitWord})</Label>
          <Input id="i-reorder" inputMode="decimal" className="tabular" value={v.reorderQty} onChange={(e) => set({ reorderQty: e.target.value })} />
        </div>

        <div className="space-y-2 md:col-span-2">
          <div className="flex items-center justify-between">
            <Label>Purchase units</Label>
            <Button type="button" variant="outline" size="sm" onClick={() => set({ units: [...v.units, { unit: "", factor: "" }] })}>
              <Plus /> Add unit
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            For example “box” = 24 {unitWord}, “tray” = 30 {unitWord}. {v.baseUnit === "g" ? "kg" : v.baseUnit === "ml" ? "litre" : "dozen"} is always available.
          </p>
          {v.units.map((u, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto_1fr_auto_auto] items-center gap-2">
              <Input aria-label={`Unit ${i + 1} name`} placeholder="box" value={u.unit} onChange={(e) => set({ units: v.units.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)) })} />
              <span className="text-sm text-muted-foreground">=</span>
              <Input aria-label={`Unit ${i + 1} size`} inputMode="decimal" className="tabular" value={u.factor} onChange={(e) => set({ units: v.units.map((x, j) => (j === i ? { ...x, factor: e.target.value } : x)) })} />
              <span className="text-sm text-muted-foreground">{unitWord}</span>
              <Button type="button" variant="ghost" size="icon" aria-label="Remove unit" onClick={() => set({ units: v.units.filter((_, j) => j !== i) })}>
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>

        {!id && (
          <div className="grid gap-4 rounded-xl border bg-muted/30 p-4 md:col-span-2 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="i-open">Opening stock ({unitWord})</Label>
              <Input id="i-open" inputMode="decimal" className="tabular" value={v.openingQty} onChange={(e) => set({ openingQty: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="i-open-cost">Cost per {v.baseUnit === "piece" ? "piece" : v.baseUnit}</Label>
              <Input id="i-open-cost" inputMode="decimal" className="tabular" value={v.openingUnitCost} onChange={(e) => set({ openingUnitCost: e.target.value })} />
              <p className="text-xs text-muted-foreground">{v.baseUnit === "g" ? "Rs 800/kg = 0.8 per g" : v.baseUnit === "ml" ? "Rs 500/l = 0.5 per ml" : "Price of one piece"}</p>
            </div>
          </div>
        )}
        <label className="flex items-center justify-between rounded-lg border p-3 text-sm">
          Track stock (turn off for water, salt …)
          <Switch checked={v.trackStock} onCheckedChange={(c) => set({ trackStock: c })} />
        </label>
        <label className="flex items-center justify-between rounded-lg border p-3 text-sm">
          Active
          <Switch checked={v.isActive} onCheckedChange={(c) => set({ isActive: c })} />
        </label>
      </CardContent>
      <CardFooter className="justify-between gap-2 border-t">
        {id ? (
          <Button
            type="button"
            variant="ghost"
            className="text-destructive"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await archiveIngredientAction(id);
                if (r.ok) {
                  toast.success(r.message);
                  router.push("/admin/inventory");
                } else toast.error(r.error);
              })
            }
          >
            Archive
          </Button>
        ) : (
          <span />
        )}
        <Button onClick={save} disabled={pending} data-testid="save-ingredient">
          {pending && <Loader2 className="animate-spin" />} Save
        </Button>
      </CardFooter>
    </Card>
  );
}
