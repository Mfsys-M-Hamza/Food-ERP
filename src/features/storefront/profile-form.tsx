"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updateProfileAction } from "@/server/modules/storefront/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function ProfileForm({ name, phone, marketingOptIn }: { name: string; phone: string; marketingOptIn: boolean }) {
  const [v, setV] = useState({ name, marketingOptIn });
  const [pending, start] = useTransition();
  return (
    <form
      className="max-w-md space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await updateProfileAction(v);
          if (r.ok) toast.success(r.message);
          else toast.error(r.error);
        });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="p-name">Name</Label>
        <Input id="p-name" className="h-11" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="p-phone">Mobile number</Label>
        <Input id="p-phone" className="h-11" value={phone} disabled />
        <p className="text-xs text-muted-foreground">To change your number, please contact the restaurant.</p>
      </div>
      <label className="flex items-center justify-between rounded-xl border p-3 text-sm">
        Send me deals and offers
        <Switch checked={v.marketingOptIn} onCheckedChange={(c) => setV({ ...v, marketingOptIn: c })} />
      </label>
      <Button type="submit" disabled={pending} className="rounded-full">
        {pending && <Loader2 className="animate-spin" />} Save
      </Button>
    </form>
  );
}
