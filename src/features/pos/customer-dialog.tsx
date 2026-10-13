"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, MapPin, Search, UserRound } from "lucide-react";
import { searchCustomersAction } from "@/server/modules/customers/actions";
import type { CustomerSummary } from "@/server/modules/customers/service";
import type { ZoneRow } from "@/server/modules/delivery/zones";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/money";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import type { CartCustomer, CartDelivery } from "./store";

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function CustomerDialog({
  open,
  onClose,
  isDelivery,
  zones,
  customer,
  delivery,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  isDelivery: boolean;
  zones: ZoneRow[];
  customer: CartCustomer | null;
  delivery: CartDelivery | null;
  onSave: (c: CartCustomer | null, d: CartDelivery | null) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        {open && <Body isDelivery={isDelivery} zones={zones} customer={customer} delivery={delivery} onSave={onSave} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function Body({
  isDelivery,
  zones,
  customer,
  delivery,
  onSave,
  onClose,
}: {
  isDelivery: boolean;
  zones: ZoneRow[];
  customer: CartCustomer | null;
  delivery: CartDelivery | null;
  onSave: (c: CartCustomer | null, d: CartDelivery | null) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState(customer?.phone || "");
  const [name, setName] = useState(customer?.name ?? "");
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [id, setId] = useState<string | null>(customer?.id ?? null);
  const [addr, setAddr] = useState<CartDelivery>(delivery ?? { zoneId: null, addressLine: "", area: "", landmark: "", mapUrl: "" });
  const [saved, setSaved] = useState<CustomerSummary | null>(null);
  const debounced = useDebounced(q, 250);

  const results = useQuery({
    queryKey: ["customer-search", debounced],
    enabled: debounced.trim().length >= 3,
    queryFn: async () => {
      const r = await searchCustomersAction(debounced);
      if (!r.ok) throw new Error(r.error);
      return r.data;
    },
  });

  function pick(c: CustomerSummary) {
    setId(c.id);
    setName(c.name);
    setPhone(c.phone ? formatPhone(c.phone) : "");
    setSaved(c);
    const def = c.addresses[0];
    if (def) setAddr({ zoneId: def.zoneId, addressLine: def.addressLine, area: def.area ?? "", landmark: def.landmark ?? "", mapUrl: def.mapUrl ?? "" });
  }

  const phoneOk = !phone || normalizePhone(phone) !== null;
  const canSave = phoneOk && (!isDelivery || (name.trim() && phone && addr.addressLine.trim().length >= 5));

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isDelivery ? "Customer & delivery address" : "Customer"}</DialogTitle>
      </DialogHeader>
      <div className="space-y-5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            className="h-12 pl-9 text-base"
            placeholder="Search by phone or name"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search customers"
          />
          {results.isFetching && <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
        </div>
        {results.data && results.data.length > 0 && (
          <ul className="max-h-48 divide-y overflow-y-auto rounded-xl border">
            {results.data.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => pick(c)}
                  className={cn("flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted", id === c.id && "bg-brand/10")}
                >
                  <UserRound className="size-5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 font-medium">
                      {c.name}
                      {c.isBlocked && <Badge variant="destructive">Blocked</Badge>}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {formatPhone(c.phone)} · {c.totalOrders} orders · {formatMoney(c.totalSpent)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {results.data && results.data.length === 0 && debounced.trim().length >= 3 && (
          <p className="text-sm text-muted-foreground">No match — enter the details below to add a new customer.</p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="c-name">Name</Label>
            <Input id="c-name" className="h-11" value={name} onChange={(e) => { setName(e.target.value); if (saved && e.target.value !== saved.name) setId(saved.id); }} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-phone">Phone</Label>
            <Input
              id="c-phone"
              className="h-11"
              inputMode="tel"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                if (saved && normalizePhone(e.target.value) !== saved.phone) setId(null);
              }}
              aria-invalid={!phoneOk}
            />
            {!phoneOk && <p className="text-xs text-destructive">Enter a valid phone number</p>}
          </div>
        </div>

        {isDelivery && (
          <div className="space-y-4 rounded-xl border p-4">
            <div className="flex items-center gap-2 font-medium">
              <MapPin className="size-4 text-brand" /> Delivery address
            </div>
            {saved && saved.addresses.length > 1 && (
              <div className="flex flex-wrap gap-2">
                {saved.addresses.map((a) => (
                  <Button
                    key={a.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setAddr({ zoneId: a.zoneId, addressLine: a.addressLine, area: a.area ?? "", landmark: a.landmark ?? "", mapUrl: a.mapUrl ?? "" })}
                  >
                    {a.label}
                  </Button>
                ))}
              </div>
            )}
            {zones.length > 0 && (
              <div className="space-y-1.5">
                <Label>Area</Label>
                <div className="flex flex-wrap gap-2">
                  {zones.map((z) => (
                    <button
                      key={z.id}
                      type="button"
                      onClick={() => setAddr({ ...addr, zoneId: z.id })}
                      className={cn(
                        "rounded-full border-2 px-3 py-1.5 text-sm",
                        addr.zoneId === z.id ? "border-brand bg-brand/10" : "border-border hover:bg-muted",
                      )}
                    >
                      {z.name} · {formatMoney(z.charge)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="a-line">Address</Label>
              <Input id="a-line" className="h-11" value={addr.addressLine} onChange={(e) => setAddr({ ...addr, addressLine: e.target.value })} placeholder="House, street, block" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="a-landmark">Landmark</Label>
                <Input id="a-landmark" value={addr.landmark} onChange={(e) => setAddr({ ...addr, landmark: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="a-map">Map link (optional)</Label>
                <Input id="a-map" value={addr.mapUrl} onChange={(e) => setAddr({ ...addr, mapUrl: e.target.value })} />
              </div>
            </div>
          </div>
        )}
      </div>
      <DialogFooter className="mt-2 gap-2">
        {!isDelivery && (
          <Button variant="ghost" onClick={() => { onSave(null, null); onClose(); }}>
            Walk-in (no customer)
          </Button>
        )}
        <Button
          className="h-11"
          disabled={!canSave || (!name.trim() && !phone)}
          onClick={() => {
            onSave({ id, name: name.trim(), phone: phone.trim() }, isDelivery ? addr : null);
            onClose();
          }}
          data-testid="save-customer"
        >
          Use this customer
        </Button>
      </DialogFooter>
    </>
  );
}
