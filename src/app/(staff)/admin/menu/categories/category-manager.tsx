"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import type { CategoryRow } from "@/server/modules/menu/service";
import {
  saveCategoryAction,
  archiveCategoryAction,
  reorderCategoriesAction,
  uploadMenuImageAction,
} from "@/server/modules/menu/actions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProductThumb } from "@/components/shared/product-thumb";
import { ImageField } from "@/components/shared/image-field";

type Draft = { id: string | null; name: string; description: string; imageUrl: string; isActive: boolean };

export function CategoryManager({ categories, canManage }: { categories: CategoryRow[]; canManage: boolean }) {
  const [order, setOrder] = useState(categories);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();

  function move(index: number, dir: -1 | 1) {
    const next = [...order];
    const [item] = next.splice(index, 1);
    next.splice(index + dir, 0, item!);
    setOrder(next);
    start(async () => {
      const res = await reorderCategoriesAction(next.map((c) => c.id));
      if (!res.ok) toast.error(res.error);
    });
  }

  function save() {
    if (!draft) return;
    start(async () => {
      const res = await saveCategoryAction(draft.id, draft);
      if (res.ok) {
        toast.success(res.message);
        setDraft(null);
        setErrors({});
      } else setErrors(res.fieldErrors ?? { _form: [res.error] });
    });
  }

  function archive(c: CategoryRow) {
    start(async () => {
      const res = await archiveCategoryAction(c.id);
      if (res.ok) toast.success(res.message);
      else toast.error(res.error);
    });
  }

  return (
    <>
      {canManage && (
        <div className="mb-4 flex justify-end">
          <Button onClick={() => setDraft({ id: null, name: "", description: "", imageUrl: "", isActive: true })}>
            <Plus /> New category
          </Button>
        </div>
      )}
      <Card className="gap-0 divide-y py-0">
        {order.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">No categories yet.</p>}
        {order.map((c, i) => (
          <div key={c.id} className="flex items-center gap-3 px-4 py-3" data-testid={`category-${c.name}`}>
            <ProductThumb name={c.name} imageUrl={c.imageUrl} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 font-medium">
                {c.name}
                {!c.isActive && <Badge variant="outline">Hidden</Badge>}
              </div>
              <div className="text-xs text-muted-foreground">
                {c.productCount} product{c.productCount === 1 ? "" : "s"}
              </div>
            </div>
            {canManage && (
              <div className="flex shrink-0 items-center">
                <Button variant="ghost" size="icon" disabled={i === 0 || pending} onClick={() => move(i, -1)} aria-label={`Move ${c.name} up`}>
                  <ArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={i === order.length - 1 || pending}
                  onClick={() => move(i, 1)}
                  aria-label={`Move ${c.name} down`}
                >
                  <ArrowDown />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setDraft({ id: c.id, name: c.name, description: c.description ?? "", imageUrl: c.imageUrl ?? "", isActive: c.isActive })}
                  aria-label={`Edit ${c.name}`}
                >
                  <Pencil />
                </Button>
                <Button variant="ghost" size="icon" disabled={pending} onClick={() => archive(c)} aria-label={`Archive ${c.name}`}>
                  <Trash2 />
                </Button>
              </div>
            )}
          </div>
        ))}
      </Card>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit category" : "New category"}</DialogTitle>
          </DialogHeader>
          {draft && (
            <FieldGroup>
              <Field data-invalid={!!errors.name}>
                <FieldLabel htmlFor="cat-name">Name</FieldLabel>
                <Input id="cat-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus />
                <FieldError>{errors.name?.[0] ?? errors._form?.[0]}</FieldError>
              </Field>
              <Field>
                <FieldLabel htmlFor="cat-desc">Description (optional)</FieldLabel>
                <Textarea id="cat-desc" rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="cat-img">Image (optional)</FieldLabel>
                <ImageField id="cat-img" value={draft.imageUrl} onChange={(v) => setDraft({ ...draft, imageUrl: v })} upload={uploadMenuImageAction} />
              </Field>
              <label className="flex items-center justify-between rounded-lg border p-3">
                <span className="text-sm">Visible on POS and website</span>
                <Switch checked={draft.isActive} onCheckedChange={(v) => setDraft({ ...draft, isActive: v })} aria-label="Visible" />
              </label>
            </FieldGroup>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={pending || !draft?.name.trim()}>
              {pending && <Loader2 className="animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
