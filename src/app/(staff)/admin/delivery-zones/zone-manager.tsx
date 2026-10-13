"use client";

import { useState, useTransition } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { ZoneRow } from "@/server/modules/delivery/zones";
import { saveZoneAction, archiveZoneAction } from "@/server/modules/delivery/actions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatMoney } from "@/lib/money";

type Draft = Omit<ZoneRow, "id" | "estimatedMinutes"> & { id: string | null; estimatedMinutes: string };

export function ZoneManager({ zones }: { zones: ZoneRow[] }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();

  const fields: [keyof Draft, string][] = [
    ["name", "Area name"],
    ["charge", "Delivery charge"],
    ["minimumOrder", "Minimum order"],
    ["freeAbove", "Free delivery above (optional)"],
    ["estimatedMinutes", "Delivery time (minutes)"],
  ];

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setDraft({ id: null, name: "", charge: "150", minimumOrder: "500", freeAbove: "", estimatedMinutes: "45", isActive: true })}>
          <Plus /> New area
        </Button>
      </div>
      <Card className="gap-0 divide-y py-0">
        {zones.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">No delivery areas yet.</p>}
        {zones.map((z) => (
          <div key={z.id} className="flex items-center gap-4 px-4 py-3" data-testid={`zone-${z.name}`}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 font-medium">
                {z.name}
                {!z.isActive && <Badge variant="outline">Off</Badge>}
              </div>
              <div className="text-xs text-muted-foreground">
                Charge {formatMoney(z.charge)} · minimum {formatMoney(z.minimumOrder)}
                {z.freeAbove && ` · free above ${formatMoney(z.freeAbove)}`} · ~{z.estimatedMinutes} min
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setDraft({ ...z, estimatedMinutes: String(z.estimatedMinutes) })} aria-label={`Edit ${z.name}`}>
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={pending}
              aria-label={`Remove ${z.name}`}
              onClick={() =>
                start(async () => {
                  const r = await archiveZoneAction(z.id);
                  if (r.ok) toast.success(r.message);
                  else toast.error(r.error);
                })
              }
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </Card>
      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit delivery area" : "New delivery area"}</DialogTitle>
          </DialogHeader>
          {draft && (
            <FieldGroup>
              {fields.map(([k, label]) => (
                <Field key={k} data-invalid={!!errors[k]}>
                  <FieldLabel htmlFor={`z-${k}`}>{label}</FieldLabel>
                  <Input
                    id={`z-${k}`}
                    inputMode={k === "name" ? undefined : "decimal"}
                    value={String(draft[k] ?? "")}
                    onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                  />
                  <FieldError>{errors[k]?.[0]}</FieldError>
                </Field>
              ))}
              <label className="flex items-center justify-between rounded-lg border p-3 text-sm">
                Active
                <Switch checked={draft.isActive} onCheckedChange={(v) => setDraft({ ...draft, isActive: v })} />
              </label>
            </FieldGroup>
          )}
          <DialogFooter>
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await saveZoneAction(draft!.id, draft);
                  if (r.ok) {
                    toast.success(r.message);
                    setDraft(null);
                    setErrors({});
                  } else setErrors(r.fieldErrors ?? { name: [r.error] });
                })
              }
            >
              {pending && <Loader2 className="animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
