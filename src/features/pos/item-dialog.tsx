"use client";

import { useMemo, useState } from "react";
import { Minus, Plus } from "lucide-react";
import type { CatalogProduct } from "@/server/modules/menu/catalog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatMoney, money } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { CartLine } from "./store";

/** Product option picker. Shared by POS and (styled differently) the customer site. */
export function ItemDialog({
  product,
  initial,
  onClose,
  onConfirm,
}: {
  product: CatalogProduct | null;
  initial?: CartLine;
  onClose: () => void;
  onConfirm: (line: Omit<CartLine, "key">) => void;
}) {
  return (
    <Dialog open={!!product} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-xl">
        {product && <ItemForm key={product.id + (initial?.key ?? "")} product={product} initial={initial} onConfirm={onConfirm} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function ItemForm({
  product,
  initial,
  onConfirm,
  onClose,
}: {
  product: CatalogProduct;
  initial?: CartLine;
  onConfirm: (line: Omit<CartLine, "key">) => void;
  onClose: () => void;
}) {
  const defaultVariant = product.variants.find((v) => v.isDefault && v.isAvailable) ?? product.variants.find((v) => v.isAvailable) ?? null;
  const [variantId, setVariantId] = useState<string | null>(initial?.variantId ?? defaultVariant?.id ?? null);
  const [addonIds, setAddonIds] = useState<string[]>(initial?.addons.map((a) => a.id) ?? []);
  const [removableIds, setRemovableIds] = useState<string[]>(initial?.removables.map((r) => r.id) ?? []);
  const [quantity, setQuantity] = useState(initial?.quantity ?? 1);
  const [note, setNote] = useState(initial?.note ?? "");

  const variant = product.variants.find((v) => v.id === variantId) ?? null;
  const unitPrice = variant ? variant.price : product.price;
  const allAddons = product.addonGroups.flatMap((g) => g.addons);
  const chosen = allAddons.filter((a) => addonIds.includes(a.id));
  const each = money(unitPrice).plus(chosen.reduce((s, a) => s.plus(a.price), money(0)));

  const problems = useMemo(
    () =>
      product.addonGroups
        .map((g) => ({ g, n: g.addons.filter((a) => addonIds.includes(a.id)).length }))
        .filter(({ g, n }) => n < g.minSelect)
        .map(({ g }) => g.id),
    [product.addonGroups, addonIds],
  );
  const needsVariant = product.variants.length > 0 && !variant;

  function toggleAddon(groupId: string, addonId: string) {
    const g = product.addonGroups.find((x) => x.id === groupId)!;
    const inGroup = addonIds.filter((id) => g.addons.some((a) => a.id === id));
    if (addonIds.includes(addonId)) return setAddonIds(addonIds.filter((id) => id !== addonId));
    if (g.maxSelect === 1) return setAddonIds([...addonIds.filter((id) => !inGroup.includes(id)), addonId]);
    if (inGroup.length >= g.maxSelect) return;
    setAddonIds([...addonIds, addonId]);
  }

  function confirm() {
    onConfirm({
      productId: product.id,
      variantId,
      name: product.name,
      variantName: variant?.name ?? null,
      unitPrice,
      addons: chosen.map((a) => ({ id: a.id, name: a.name, price: a.price })),
      removables: product.removables.filter((r) => removableIds.includes(r.id)),
      quantity,
      note: note.trim(),
    });
  }

  return (
    <>
      <DialogHeader className="border-b p-5">
        <DialogTitle className="text-xl">{product.name}</DialogTitle>
        {product.description && <DialogDescription>{product.description}</DialogDescription>}
      </DialogHeader>
      <div className="max-h-[60vh] space-y-6 overflow-y-auto p-5">
        {product.variants.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-semibold">Size</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {product.variants.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  disabled={!v.isAvailable}
                  onClick={() => setVariantId(v.id)}
                  className={cn(
                    "flex min-h-14 flex-col items-start justify-center rounded-xl border-2 px-3 py-2 text-left transition-colors disabled:opacity-40",
                    variantId === v.id ? "border-brand bg-brand/10" : "border-border hover:bg-muted",
                  )}
                  aria-pressed={variantId === v.id}
                >
                  <span className="font-medium">{v.name}</span>
                  <span className="text-sm tabular text-muted-foreground">{v.isAvailable ? formatMoney(v.price) : "Out of stock"}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {product.addonGroups.map((g) => {
          const count = g.addons.filter((a) => addonIds.includes(a.id)).length;
          return (
            <section key={g.id}>
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-sm font-semibold">{g.title}</h3>
                {g.minSelect > 0 ? (
                  <Badge variant={problems.includes(g.id) ? "destructive" : "secondary"}>Required</Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">Optional{g.maxSelect > 1 ? ` · up to ${g.maxSelect}` : ""}</span>
                )}
                {g.maxSelect > 1 && <span className="ml-auto text-xs tabular text-muted-foreground">{count}/{g.maxSelect}</span>}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {g.addons.map((a) => {
                  const on = addonIds.includes(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      disabled={!a.isAvailable}
                      onClick={() => toggleAddon(g.id, a.id)}
                      className={cn(
                        "flex min-h-12 items-center justify-between gap-2 rounded-xl border-2 px-3 py-2 text-left transition-colors disabled:opacity-40",
                        on ? "border-brand bg-brand/10" : "border-border hover:bg-muted",
                      )}
                      aria-pressed={on}
                    >
                      <span className="font-medium">{a.name}</span>
                      <span className="shrink-0 text-sm tabular text-muted-foreground">
                        {!a.isAvailable ? "Out" : money(a.price).isZero() ? "" : `+${formatMoney(a.price)}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}

        {product.removables.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-semibold">Remove</h3>
            <div className="flex flex-wrap gap-2">
              {product.removables.map((r) => {
                const on = removableIds.includes(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setRemovableIds(on ? removableIds.filter((x) => x !== r.id) : [...removableIds, r.id])}
                    className={cn(
                      "min-h-11 rounded-full border-2 px-4 text-sm font-medium transition-colors",
                      on ? "border-destructive bg-destructive/10 text-destructive" : "border-border hover:bg-muted",
                    )}
                    aria-pressed={on}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <section>
          <h3 className="mb-2 text-sm font-semibold">Note for the kitchen</h3>
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} placeholder="e.g. extra spicy, cut in half" />
        </section>
      </div>
      <DialogFooter className="flex-row items-center gap-3 border-t p-4 sm:justify-between">
        <div className="flex items-center gap-1 rounded-xl border p-1">
          <Button variant="ghost" size="icon" className="size-11" onClick={() => setQuantity(Math.max(1, quantity - 1))} aria-label="Less">
            <Minus />
          </Button>
          <span className="w-8 text-center text-lg font-semibold tabular" aria-live="polite">
            {quantity}
          </span>
          <Button variant="ghost" size="icon" className="size-11" onClick={() => setQuantity(Math.min(99, quantity + 1))} aria-label="More">
            <Plus />
          </Button>
        </div>
        <Button variant="ghost" className="hidden h-12 sm:inline-flex" onClick={onClose}>
          Cancel
        </Button>
        <Button className="h-12 flex-1 text-base sm:flex-none sm:px-8" disabled={problems.length > 0 || needsVariant} onClick={confirm} data-testid="add-to-order">
          {initial ? "Update" : "Add"} · {formatMoney(each.times(quantity))}
        </Button>
      </DialogFooter>
    </>
  );
}

/** True when a product can be added with one tap: no size and no required choice. Extras can be added by editing the line. */
export function isQuickAdd(p: CatalogProduct) {
  return p.variants.length === 0 && p.addonGroups.every((g) => g.minSelect === 0);
}
