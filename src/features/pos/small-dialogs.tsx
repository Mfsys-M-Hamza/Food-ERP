"use client";

import { useState, useTransition } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { apiGet } from "@/lib/api-client";
import { takeHeldAction, discardHeldAction } from "@/server/modules/orders/actions";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/money";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Keypad, PinDots } from "./pin-pad";
import type { CartDiscount } from "./store";

type HeldRow = { id: string; label: string; itemCount: number; total: string; createdAt: string; createdBy: string | null };

export function HeldSheet({
  open,
  onClose,
  onResume,
  cartHasItems,
}: {
  open: boolean;
  onClose: () => void;
  onResume: (payload: Record<string, unknown>) => void;
  cartHasItems: boolean;
}) {
  const held = useQuery({ queryKey: ["pos-held"], queryFn: () => apiGet<HeldRow[]>("/api/v1/pos/held"), enabled: open });
  const [pending, start] = useTransition();
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Held orders</SheetTitle>
        </SheetHeader>
        {cartHasItems && <p className="px-4 text-sm text-muted-foreground">Hold or clear the current cart before resuming another.</p>}
        <ul className="divide-y overflow-y-auto">
          {held.data?.length === 0 && <li className="p-8 text-center text-sm text-muted-foreground">Nothing on hold.</li>}
          {held.data?.map((h) => (
            <li key={h.id} className="flex items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{h.label}</div>
                <div className="text-xs text-muted-foreground">
                  {h.itemCount} items · {formatMoney(h.total)} · {timeAgo(h.createdAt)} {h.createdBy ? `· ${h.createdBy}` : ""}
                </div>
              </div>
              <Button
                disabled={pending || cartHasItems}
                onClick={() =>
                  start(async () => {
                    const r = await takeHeldAction(h.id);
                    if (r.ok) {
                      onResume(r.data);
                      onClose();
                    } else toast.error(r.error);
                    held.refetch();
                  })
                }
              >
                Resume
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={pending}
                aria-label="Discard"
                onClick={() =>
                  start(async () => {
                    await discardHeldAction(h.id);
                    held.refetch();
                  })
                }
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}

export function SwitchUserDialog({
  open,
  staff,
  currentUserId,
  onClose,
}: {
  open: boolean;
  staff: { id: string; name: string }[];
  currentUserId: string;
  onClose: () => void;
}) {
  const [userId, setUserId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/pin/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, pin }),
    });
    setBusy(false);
    if (res.ok) {
      // Full reload so no client state from the previous user survives.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/staff");
    } else {
      const body = await res.json().catch(() => null);
      setError(body?.message ?? "Incorrect PIN.");
      setPin("");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setUserId(null);
          setPin("");
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Switch user</DialogTitle>
          <DialogDescription>{userId ? "Enter your PIN" : "Who is using this till?"}</DialogDescription>
        </DialogHeader>
        {!userId ? (
          <div className="grid grid-cols-2 gap-2">
            {staff
              .filter((s) => s.id !== currentUserId)
              .map((s) => (
                <button key={s.id} type="button" onClick={() => setUserId(s.id)} className="flex h-16 items-center gap-2 rounded-xl border-2 px-3 text-left hover:bg-muted">
                  <UserRound className="size-5 text-muted-foreground" />
                  <span className="font-medium">{s.name}</span>
                </button>
              ))}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-center font-medium">{staff.find((s) => s.id === userId)?.name}</p>
            <PinDots length={Math.max(4, pin.length)} filled={pin.length} />
            {error && <p className="text-center text-sm text-destructive" role="alert">{error}</p>}
            <Keypad value={pin} onChange={setPin} />
            <div className="flex gap-2">
              <Button variant="ghost" className="h-12 flex-1" onClick={() => setUserId(null)}>
                Back
              </Button>
              <Button className="h-12 flex-1" disabled={pin.length < 4 || busy} onClick={submit}>
                {busy && <Loader2 className="animate-spin" />} Sign in
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function DiscountDialog({
  open,
  current,
  limitPercent,
  onClose,
  onSave,
}: {
  open: boolean;
  current: CartDiscount | null;
  limitPercent: number;
  onClose: () => void;
  onSave: (d: CartDiscount | null) => void;
}) {
  const [type, setType] = useState<"PERCENT" | "AMOUNT">(current?.type ?? "PERCENT");
  const [value, setValue] = useState(current?.value ?? "");
  const [reason, setReason] = useState(current?.reason ?? "");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Discount</DialogTitle>
          <DialogDescription>Up to {limitPercent}% without manager approval.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {(["PERCENT", "AMOUNT"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setType(t)} className={cn("h-11 rounded-xl border-2 font-medium", type === t ? "border-brand bg-brand/10" : "border-border")}>
              {t === "PERCENT" ? "Percent %" : "Fixed amount"}
            </button>
          ))}
        </div>
        {type === "PERCENT" && (
          <div className="flex flex-wrap gap-2">
            {[5, 10, 15, 20, 50].map((p) => (
              <Button key={p} variant="outline" onClick={() => setValue(String(p))}>
                {p}%
              </Button>
            ))}
          </div>
        )}
        <Input inputMode="decimal" className="h-12 text-lg tabular" placeholder={type === "PERCENT" ? "%" : "Amount"} value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))} aria-label="Discount value" />
        <Input placeholder="Reason (e.g. regular customer, complaint)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Discount reason" />
        <div className="flex gap-2">
          {current && (
            <Button variant="ghost" className="flex-1" onClick={() => { onSave(null); onClose(); }}>
              Remove discount
            </Button>
          )}
          <Button className="h-11 flex-1" disabled={!value || Number(value) <= 0 || (type === "PERCENT" && Number(value) > 100)} onClick={() => { onSave({ type, value, reason }); onClose(); }}>
            Apply
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
