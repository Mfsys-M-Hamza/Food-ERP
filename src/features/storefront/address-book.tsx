"use client";

import { useState, useTransition } from "react";
import { Loader2, MapPin, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { addAddressAction, deleteAddressAction } from "@/server/modules/storefront/actions";
import type { ZoneRow } from "@/server/modules/delivery/zones";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

type Address = { id: string; label: string; addressLine: string; landmark: string | null; zoneName: string | null; isDefault: boolean };

export function AddressBook({ addresses, zones }: { addresses: Address[]; zones: ZoneRow[] }) {
  const [adding, setAdding] = useState(addresses.length === 0);
  const [v, setV] = useState({ label: "Home", addressLine: "", landmark: "", zoneId: "" });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();

  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {addresses.map((a) => (
          <li key={a.id} className="flex items-start gap-3 rounded-2xl border bg-card p-4">
            <MapPin className="mt-0.5 size-5 shrink-0 text-brand" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 font-medium">
                {a.label}
                {a.isDefault && <Badge variant="secondary">Default</Badge>}
              </div>
              <p className="text-sm text-muted-foreground">
                {a.addressLine}
                {a.landmark && ` · near ${a.landmark}`}
                {a.zoneName && ` · ${a.zoneName}`}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Delete ${a.label}`}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await deleteAddressAction(a.id);
                  if (!r.ok) toast.error(r.error);
                })
              }
            >
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
      {adding ? (
        <form
          className="space-y-4 rounded-2xl border bg-card p-5"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await addAddressAction({ ...v, zoneId: v.zoneId || null, isDefault: addresses.length === 0 });
              if (r.ok) {
                toast.success(r.message);
                setAdding(false);
              } else setErrors(r.fieldErrors ?? {});
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="a-label">Label</Label>
              <Input id="a-label" value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} placeholder="Home, Office…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a-zone">Area</Label>
              <select id="a-zone" className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" value={v.zoneId} onChange={(e) => setV({ ...v, zoneId: e.target.value })}>
                <option value="">Other area</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="a-line">Address</Label>
            <Input id="a-line" value={v.addressLine} onChange={(e) => setV({ ...v, addressLine: e.target.value })} aria-invalid={!!errors.addressLine} />
            {errors.addressLine && <p className="text-sm text-destructive">{errors.addressLine[0]}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="a-lm">Landmark (optional)</Label>
            <Input id="a-lm" value={v.landmark} onChange={(e) => setV({ ...v, landmark: e.target.value })} />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={pending} className="rounded-full">
              {pending && <Loader2 className="animate-spin" />} Save address
            </Button>
            {addresses.length > 0 && (
              <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      ) : (
        <Button variant="outline" className="rounded-full" onClick={() => setAdding(true)}>
          <Plus /> Add address
        </Button>
      )}
    </div>
  );
}
