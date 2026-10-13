"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import type { AddonGroupRow } from "@/server/modules/menu/service";
import { saveAddonGroupAction, archiveAddonGroupAction } from "@/server/modules/menu/actions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatMoney, money } from "@/lib/money";

type AddonDraft = { id: string; name: string; price: string; cost: string; isAvailable: boolean };
type Draft = { id: string | null; name: string; title: string; minSelect: string; maxSelect: string; isActive: boolean; addons: AddonDraft[] };

function ruleText(min: number, max: number) {
  if (min === 0) return max === 1 ? "Optional · pick up to 1" : `Optional · pick up to ${max}`;
  if (min === max) return `Required · pick ${min}`;
  return `Required · pick ${min}–${max}`;
}

export function AddonGroupManager({
  groups,
  canManage,
  canChangePrice,
}: {
  groups: AddonGroupRow[];
  canManage: boolean;
  canChangePrice: boolean;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();

  const open = (g?: AddonGroupRow) =>
    setDraft(
      g
        ? { id: g.id, name: g.name, title: g.title, minSelect: String(g.minSelect), maxSelect: String(g.maxSelect), isActive: g.isActive, addons: g.addons.map((a) => ({ ...a })) }
        : { id: null, name: "", title: "", minSelect: "0", maxSelect: "3", isActive: true, addons: [{ id: "", name: "", price: "0", cost: "0", isAvailable: true }] },
    );

  const updateAddon = (i: number, patch: Partial<AddonDraft>) =>
    setDraft((d) => d && { ...d, addons: d.addons.map((a, j) => (j === i ? { ...a, ...patch } : a)) });

  function save() {
    if (!draft) return;
    start(async () => {
      const res = await saveAddonGroupAction(draft.id, draft);
      if (res.ok) {
        toast.success(res.message);
        setDraft(null);
        setErrors({});
      } else setErrors(res.fieldErrors ?? { _form: [res.error] });
    });
  }

  function archive(g: AddonGroupRow) {
    start(async () => {
      const res = await archiveAddonGroupAction(g.id);
      if (res.ok) toast.success(res.message);
      else toast.error(res.error);
    });
  }

  const priceLocked = !!draft?.id && !canChangePrice;

  return (
    <>
      {canManage && (
        <div className="mb-4 flex justify-end">
          <Button onClick={() => open()}>
            <Plus /> New add-on group
          </Button>
        </div>
      )}
      {groups.length === 0 && <p className="py-12 text-center text-sm text-muted-foreground">No add-on groups yet.</p>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((g) => (
          <Card key={g.id} className={!g.isActive ? "opacity-60" : undefined} data-testid={`addon-group-${g.name}`}>
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {g.name}
                    {!g.isActive && <Badge variant="outline">Hidden</Badge>}
                  </CardTitle>
                  <CardDescription>
                    {ruleText(g.minSelect, g.maxSelect)} · used by {g.productCount} product{g.productCount === 1 ? "" : "s"}
                  </CardDescription>
                </div>
                {canManage && (
                  <div className="flex">
                    <Button variant="ghost" size="icon" onClick={() => open(g)} aria-label={`Edit ${g.name}`}>
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => archive(g)} disabled={pending} aria-label={`Archive ${g.name}`}>
                      <Trash2 />
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-sm">
                {g.addons.map((a) => (
                  <li key={a.id} className="flex justify-between gap-2">
                    <span className={!a.isAvailable ? "text-muted-foreground line-through" : undefined}>{a.name}</span>
                    <span className="tabular text-muted-foreground">{money(a.price).isZero() ? "Free" : `+${formatMoney(a.price)}`}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit add-on group" : "New add-on group"}</DialogTitle>
          </DialogHeader>
          {draft && (
            <FieldGroup>
              {errors._form && <FieldError>{errors._form[0]}</FieldError>}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field data-invalid={!!errors.name}>
                  <FieldLabel htmlFor="g-name">Name</FieldLabel>
                  <Input id="g-name" placeholder="Extra toppings" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                  <FieldError>{errors.name?.[0]}</FieldError>
                </Field>
                <Field>
                  <FieldLabel htmlFor="g-title">Question shown to customer</FieldLabel>
                  <Input id="g-title" placeholder="Add extras?" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                </Field>
                <Field data-invalid={!!errors.minSelect}>
                  <FieldLabel htmlFor="g-min">Minimum choices</FieldLabel>
                  <Input id="g-min" inputMode="numeric" value={draft.minSelect} onChange={(e) => setDraft({ ...draft, minSelect: e.target.value })} />
                  <FieldDescription>0 = optional. 1 or more = required.</FieldDescription>
                  <FieldError>{errors.minSelect?.[0]}</FieldError>
                </Field>
                <Field data-invalid={!!errors.maxSelect}>
                  <FieldLabel htmlFor="g-max">Maximum choices</FieldLabel>
                  <Input id="g-max" inputMode="numeric" value={draft.maxSelect} onChange={(e) => setDraft({ ...draft, maxSelect: e.target.value })} />
                  <FieldError>{errors.maxSelect?.[0]}</FieldError>
                </Field>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium">Options</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setDraft({ ...draft, addons: [...draft.addons, { id: "", name: "", price: "0", cost: "0", isAvailable: true }] })}
                  >
                    <Plus /> Add option
                  </Button>
                </div>
                <div className="space-y-2">
                  {draft.addons.map((a, i) => (
                    <div key={i} className="grid grid-cols-[1fr_100px_100px_auto_auto] items-center gap-2">
                      <Input aria-label={`Option ${i + 1} name`} placeholder="Extra cheese" value={a.name} onChange={(e) => updateAddon(i, { name: e.target.value })} />
                      <Input
                        aria-label={`Option ${i + 1} price`}
                        inputMode="decimal"
                        className="tabular"
                        value={a.price}
                        readOnly={priceLocked && !!a.id}
                        onChange={(e) => updateAddon(i, { price: e.target.value })}
                      />
                      <Input aria-label={`Option ${i + 1} cost`} inputMode="decimal" className="tabular" value={a.cost} onChange={(e) => updateAddon(i, { cost: e.target.value })} />
                      <Switch checked={a.isAvailable} onCheckedChange={(v) => updateAddon(i, { isAvailable: v })} aria-label={`Option ${i + 1} in stock`} />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => setDraft({ ...draft, addons: draft.addons.filter((_, j) => j !== i) })}
                        aria-label={`Remove option ${i + 1}`}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">Columns: name · price · estimated cost · in stock</p>
                  <FieldError>
                    {errors.addons?.[0] ??
                      Object.entries(errors).find(([k]) => k.startsWith("addons."))?.[1]?.[0]}
                  </FieldError>
                </div>
              </div>
              <label className="flex items-center justify-between rounded-lg border p-3">
                <span className="text-sm">Active</span>
                <Switch checked={draft.isActive} onCheckedChange={(v) => setDraft({ ...draft, isActive: v })} aria-label="Active" />
              </label>
            </FieldGroup>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Save group
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
