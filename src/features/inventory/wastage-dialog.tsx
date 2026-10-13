"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { recordWastageAction } from "@/server/modules/inventory/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const REASONS: [string, string][] = [
  ["EXPIRED", "Expired"],
  ["BURNED", "Burned"],
  ["DAMAGED", "Damaged"],
  ["SPOILED", "Spoiled"],
  ["WRONG_PREPARATION", "Wrong preparation"],
  ["STAFF_MEAL", "Staff meal"],
  ["OTHER", "Other"],
];

type Ing = { id: string; name: string; baseUnit: "g" | "ml" | "piece" };
type Prod = { id: string; name: string; variants: { id: string; name: string }[] };

export function RecordWastageButton({ ingredients, products }: { ingredients: Ing[]; products: Prod[] }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"INGREDIENT" | "PRODUCT">("INGREDIENT");
  const [itemId, setItemId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("");
  const [reason, setReason] = useState("EXPIRED");
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();
  const ing = ingredients.find((i) => i.id === itemId);
  const prod = products.find((p) => p.id === itemId);
  const unitChoices = ing ? (ing.baseUnit === "g" ? ["g", "kg"] : ing.baseUnit === "ml" ? ["ml", "l"] : ["piece", "dozen"]) : [];

  function reset() {
    setItemId("");
    setVariantId("");
    setQty("");
    setUnit("");
    setNotes("");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button data-testid="record-wastage">
          <Plus /> Record wastage
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record wastage</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["INGREDIENT", "Ingredient"],
              ["PRODUCT", "Finished item"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setKind(k);
                reset();
              }}
              className={cn("h-11 rounded-xl border-2 text-sm font-medium", kind === k ? "border-brand bg-brand/10" : "border-border")}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="w-item">{kind === "INGREDIENT" ? "Ingredient" : "Menu item"}</Label>
          <select
            id="w-item"
            className="h-10 w-full rounded-md border border-input bg-transparent px-2 text-sm"
            value={itemId}
            onChange={(e) => {
              setItemId(e.target.value);
              setVariantId("");
              const i = ingredients.find((x) => x.id === e.target.value);
              setUnit(i ? (i.baseUnit === "g" ? "kg" : i.baseUnit === "ml" ? "l" : "piece") : "");
            }}
          >
            <option value="">Choose…</option>
            {(kind === "INGREDIENT" ? ingredients : products).map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </div>
        {prod && prod.variants.length > 0 && (
          <div className="space-y-1.5">
            <Label htmlFor="w-variant">Size</Label>
            <select id="w-variant" className="h-10 w-full rounded-md border border-input bg-transparent px-2 text-sm" value={variantId} onChange={(e) => setVariantId(e.target.value)}>
              <option value="">Base recipe</option>
              {prod.variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="grid grid-cols-[1fr_110px] gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="w-qty">Quantity</Label>
            <Input id="w-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ""))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="w-unit">Unit</Label>
            {kind === "INGREDIENT" ? (
              <select id="w-unit" className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" value={unit} onChange={(e) => setUnit(e.target.value)}>
                {unitChoices.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            ) : (
              <Input id="w-unit" value="pieces" disabled />
            )}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Reason</Label>
          <div className="flex flex-wrap gap-2">
            {REASONS.map(([k, label]) => (
              <button key={k} type="button" onClick={() => setReason(k)} className={cn("rounded-full border-2 px-3 py-1.5 text-sm", reason === k ? "border-brand bg-brand/10" : "border-border")}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <Input placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <DialogFooter>
          <Button
            disabled={pending || !itemId || !qty}
            onClick={() =>
              start(async () => {
                const r = await recordWastageAction({
                  kind,
                  ...(kind === "INGREDIENT" ? { ingredientId: itemId, unit } : { productId: itemId, variantId: variantId || null }),
                  quantity: qty,
                  reason,
                  notes,
                });
                if (r.ok) {
                  toast.success(`${r.data.wastageNumber} recorded (≈ Rs ${Number(r.data.estimatedCost).toLocaleString()})`);
                  setOpen(false);
                  reset();
                } else toast.error(r.fieldErrors ? Object.values(r.fieldErrors)[0]![0] : r.error);
              })
            }
            data-testid="save-wastage"
          >
            {pending && <Loader2 className="animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
