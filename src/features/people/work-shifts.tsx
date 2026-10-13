"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { saveWorkShiftAction } from "@/server/modules/people/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export type WorkShiftValue = { name: string; start: string; end: string; graceMinutes: number; breakMinutes: number; isActive: boolean };

export function WorkShiftDialog({ id, initial, trigger }: { id?: string; initial?: WorkShiftValue; trigger?: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<WorkShiftValue>(initial ?? { name: "", start: "11:00", end: "19:00", graceMinutes: 10, breakMinutes: 30, isActive: true });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const set = <K extends keyof WorkShiftValue>(k: K, val: WorkShiftValue[K]) => setV((s) => ({ ...s, [k]: val }));
  const err = (k: string) => errors[k]?.[0] && <p className="text-xs text-destructive">{errors[k]![0]}</p>;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button data-testid="new-work-shift">
            <Plus /> New shift
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{id ? "Edit shift" : "New shift"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="ws-name">Name</Label>
            <Input id="ws-name" value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Evening" />
            {err("name")}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ws-start">Starts</Label>
            <Input id="ws-start" type="time" value={v.start} onChange={(e) => set("start", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ws-end">Ends (after midnight is fine)</Label>
            <Input id="ws-end" type="time" value={v.end} onChange={(e) => set("end", e.target.value)} />
            {err("end")}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ws-grace">Grace minutes before late</Label>
            <Input id="ws-grace" type="number" min={0} value={v.graceMinutes} onChange={(e) => set("graceMinutes", Number(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ws-break">Unpaid break (minutes)</Label>
            <Input id="ws-break" type="number" min={0} value={v.breakMinutes} onChange={(e) => set("breakMinutes", Number(e.target.value))} />
          </div>
          {id && (
            <label className="col-span-2 flex items-center gap-2 text-sm">
              <Switch checked={v.isActive} onCheckedChange={(c) => set("isActive", c)} /> Active
            </label>
          )}
        </div>
        <DialogFooter>
          <Button
            disabled={pending}
            data-testid="save-work-shift"
            onClick={() =>
              start(async () => {
                const r = await saveWorkShiftAction(id ?? null, v);
                if (r.ok) {
                  toast.success(r.message);
                  setOpen(false);
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
