"use client";

import { useState, useTransition } from "react";
import { Loader2, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { adjustStockAction, ingredientUnitsAction } from "@/server/modules/inventory/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** Add or remove stock with a reason (delivery not via purchase, found stock, correction …). */
export function AdjustStockButton({ ingredientId, name, onHandText }: { ingredientId: string; name: string; onHandText: string }) {
  const [open, setOpen] = useState(false);
  const [units, setUnits] = useState<{ unit: string; factor: string }[]>([]);
  const [dir, setDir] = useState<"in" | "out">("out");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  function openDialog() {
    setOpen(true);
    start(async () => {
      const r = await ingredientUnitsAction(ingredientId);
      if (r.ok) {
        setUnits(r.data);
        setUnit(r.data[0]!.unit);
      }
    });
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={openDialog} aria-label={`Adjust ${name}`}>
        <SlidersHorizontal /> Adjust
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adjust {name}</DialogTitle>
            <DialogDescription>Currently in stock: {onHandText}. Use purchases for deliveries and wastage for spoiled stock.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {(["out", "in"] as const).map((d) => (
              <button key={d} type="button" onClick={() => setDir(d)} className={cn("h-11 rounded-xl border-2 text-sm font-medium", dir === d ? "border-brand bg-brand/10" : "border-border")}>
                {d === "out" ? "Remove stock" : "Add stock"}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-[1fr_120px] gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="adj-qty">Quantity</Label>
              <Input id="adj-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ""))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adj-unit">Unit</Label>
              <select id="adj-unit" className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" value={unit} onChange={(e) => setUnit(e.target.value)}>
                {units.map((u) => (
                  <option key={u.unit} value={u.unit}>
                    {u.unit}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adj-reason">Reason</Label>
            <Input id="adj-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. correction after recount" />
          </div>
          <DialogFooter>
            <Button
              disabled={pending || !qty || !unit || reason.trim().length < 3}
              onClick={() =>
                start(async () => {
                  const r = await adjustStockAction({ ingredientId, quantity: dir === "out" ? `-${qty}` : qty, unit, reason });
                  if (r.ok) {
                    toast.success(r.message);
                    setOpen(false);
                    setQty("");
                    setReason("");
                  } else toast.error(r.fieldErrors ? Object.values(r.fieldErrors)[0]![0] : r.error);
                })
              }
            >
              {pending && <Loader2 className="animate-spin" />} Save adjustment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
