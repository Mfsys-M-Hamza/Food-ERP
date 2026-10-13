"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { saveCouponAction, archiveCouponAction } from "@/server/modules/marketing/actions";
import type { CouponInput } from "@/server/modules/marketing/coupons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const blank: CouponInput = {
  code: "",
  description: "",
  type: "PERCENT",
  value: "",
  maxDiscount: "",
  minOrder: "0",
  startsAt: "",
  endsAt: "",
  usageLimit: "",
  perCustomerLimit: "",
  firstOrderOnly: false,
  channel: "ALL",
  isActive: true,
};

export function CouponDialog({ id, initial, trigger }: { id?: string; initial?: CouponInput; trigger?: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<CouponInput>(initial ?? blank);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const set = <K extends keyof CouponInput>(k: K, val: CouponInput[K]) => setV((s) => ({ ...s, [k]: val }));
  const err = (k: string) => errors[k]?.[0] && <p className="text-xs text-destructive">{errors[k]![0]}</p>;
  const str = (k: keyof CouponInput) => String(v[k] ?? "");
  const field = (k: keyof CouponInput, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`cp-${k}`}>{label}</Label>
      <Input id={`cp-${k}`} value={str(k)} onChange={(e) => set(k, e.target.value as never)} {...props} />
      {err(k)}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button data-testid="new-coupon">
            <Plus /> New coupon
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{id ? `Edit ${initial?.code}` : "New coupon"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">{field("code", "Code customers type", { placeholder: "e.g. WELCOME10", className: "uppercase placeholder:normal-case" })}</div>
          <div className="col-span-2 flex flex-wrap gap-2">
            {(
              [
                ["PERCENT", "% off"],
                ["AMOUNT", "Rs off"],
                ["FREE_DELIVERY", "Free delivery"],
              ] as const
            ).map(([t, label]) => (
              <button key={t} type="button" onClick={() => set("type", t)} className={cn("rounded-full border-2 px-3 py-1.5 text-sm", v.type === t ? "border-brand bg-brand/10" : "border-border")}>
                {label}
              </button>
            ))}
          </div>
          {v.type !== "FREE_DELIVERY" && field("value", v.type === "PERCENT" ? "Percent off" : "Rupees off", { inputMode: "decimal" })}
          {v.type === "PERCENT" && field("maxDiscount", "Maximum discount (Rs, optional)", { inputMode: "decimal" })}
          {field("minOrder", "Minimum order (Rs)", { inputMode: "decimal" })}
          <div className="space-y-1.5">
            <Label htmlFor="cp-channel">Where</Label>
            <select id="cp-channel" className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" value={v.channel} onChange={(e) => set("channel", e.target.value as CouponInput["channel"])}>
              <option value="ALL">Online and counter</option>
              <option value="ONLINE">Online only</option>
              <option value="POS">Counter only</option>
            </select>
          </div>
          {field("startsAt", "Starts (optional)", { type: "datetime-local" })}
          {field("endsAt", "Ends (optional)", { type: "datetime-local" })}
          {field("usageLimit", "Total uses (blank = unlimited)", { inputMode: "numeric" })}
          {field("perCustomerLimit", "Uses per customer (blank = unlimited)", { inputMode: "numeric" })}
          <div className="col-span-2">{field("description", "Note for staff (optional)")}</div>
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <Switch checked={!!v.firstOrderOnly} onCheckedChange={(c) => set("firstOrderOnly", c)} /> Customer&apos;s first order only
          </label>
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <Switch checked={v.isActive !== false} onCheckedChange={(c) => set("isActive", c)} /> Active
          </label>
        </div>
        <DialogFooter className="gap-2">
          {id && (
            <Button
              variant="ghost"
              className="mr-auto text-destructive"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  if (!window.confirm("Archive this coupon? It can no longer be used.")) return;
                  const r = await archiveCouponAction(id);
                  if (r.ok) {
                    toast.success(r.message);
                    setOpen(false);
                    router.refresh();
                  } else toast.error(r.error);
                })
              }
            >
              Archive
            </Button>
          )}
          <Button
            disabled={pending}
            data-testid="save-coupon"
            onClick={() =>
              start(async () => {
                const r = await saveCouponAction(id ?? null, v);
                if (r.ok) {
                  toast.success(r.message);
                  setOpen(false);
                  setErrors({});
                  if (!id) setV(blank);
                  router.refresh();
                } else {
                  setErrors(r.fieldErrors ?? {});
                  toast.error(r.error);
                }
              })
            }
          >
            {pending && <Loader2 className="animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
