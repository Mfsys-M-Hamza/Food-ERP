"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { saveEmployeeAction } from "@/server/modules/people/actions";
import type { EmployeeInput } from "@/server/modules/people/employees";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useHydrated } from "@/hooks/use-hydrated";
import { cn } from "@/lib/utils";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const select = "h-10 w-full rounded-md border border-input bg-transparent px-2 text-sm";

type Props = {
  id?: string;
  initial: EmployeeInput;
  sensitive: boolean;
  shifts: { id: string; label: string }[];
  users: { id: string; name: string; email: string }[];
  nationalIdHint?: string | null;
};

export function EmployeeForm({ id, initial, sensitive, shifts, users, nationalIdHint }: Props) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [v, setV] = useState<EmployeeInput>(initial);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const set = <K extends keyof EmployeeInput>(k: K, val: EmployeeInput[K]) => setV((s) => ({ ...s, [k]: val }));
  const err = (k: string) => errors[k]?.[0] && <p className="text-xs text-destructive">{errors[k]![0]}</p>;
  const field = (k: keyof EmployeeInput, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`emp-${k}`}>{label}</Label>
      <Input id={`emp-${k}`} value={(v[k] as string | undefined) ?? ""} onChange={(e) => set(k, e.target.value as never)} {...props} />
      {err(k)}
    </div>
  );
  const offDays = v.weeklyOffDays ?? [];
  const rateLabel = v.payType === "DAILY" ? "Daily wage (Rs)" : v.payType === "HOURLY" ? "Hourly rate (Rs)" : "Monthly salary (Rs)";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const payload = sensitive ? v : Object.fromEntries(Object.entries(v).filter(([k]) => !["payType", "baseRate", "overtimeRate", "nationalId", "bankName", "bankAccount"].includes(k)));
      const r = await saveEmployeeAction(id ?? null, payload);
      if (r.ok) {
        toast.success(r.message);
        setErrors({});
        if (!id) router.push(`/admin/employees/${r.data.id}`);
        else router.refresh();
      } else {
        setErrors(r.fieldErrors ?? {});
        toast.error(r.error);
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {field("fullName", "Full name")}
          {field("designation", "Job title", { placeholder: "e.g. Cook, Cashier, Rider" })}
          {field("phone", "Phone", { inputMode: "tel" })}
          {field("department", "Department (optional)", { placeholder: "Kitchen, Front, Delivery" })}
          <div className="space-y-1.5">
            <Label htmlFor="emp-type">Employment</Label>
            <select id="emp-type" className={select} value={v.employmentType} onChange={(e) => set("employmentType", e.target.value as EmployeeInput["employmentType"])}>
              <option value="FULL_TIME">Full time</option>
              <option value="PART_TIME">Part time</option>
              <option value="CONTRACT">Contract</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emp-status">Status</Label>
            <select id="emp-status" className={select} value={v.status} onChange={(e) => set("status", e.target.value as EmployeeInput["status"])}>
              <option value="ACTIVE">Working</option>
              <option value="ON_LEAVE">On long leave</option>
              <option value="LEFT">Left</option>
            </select>
          </div>
          {field("joiningDate", "Joining date", { type: "date" })}
          {field("leavingDate", "Last working day", { type: "date" })}
          <div className="space-y-1.5">
            <Label htmlFor="emp-user">Staff login (for self check-in)</Label>
            <select id="emp-user" className={select} value={v.userId} onChange={(e) => set("userId", e.target.value)}>
              <option value="">Not linked</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email})
                </option>
              ))}
            </select>
            {err("userId")}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Work schedule</CardTitle>
          <CardDescription>Used to work out late arrivals, overtime and days off.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="emp-shift">Shift</Label>
            <select id="emp-shift" className={select} value={v.workShiftId} onChange={(e) => set("workShiftId", e.target.value)}>
              <option value="">No fixed shift</option>
              {shifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Weekly day off</Label>
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={offDays.includes(i)}
                  onClick={() => set("weeklyOffDays", offDays.includes(i) ? offDays.filter((x) => x !== i) : [...offDays, i])}
                  className={cn("h-9 w-11 rounded-md border-2 text-sm", offDays.includes(i) ? "border-brand bg-brand/10" : "border-border")}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {sensitive ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="size-4" /> Pay and identity
            </CardTitle>
            <CardDescription>Visible only to roles with access to sensitive employee data. CNIC and bank account are stored encrypted.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="emp-paytype">Paid</Label>
              <select id="emp-paytype" className={select} value={v.payType ?? "MONTHLY"} onChange={(e) => set("payType", e.target.value as EmployeeInput["payType"])}>
                <option value="MONTHLY">Monthly salary</option>
                <option value="DAILY">Daily wage</option>
                <option value="HOURLY">By the hour</option>
              </select>
            </div>
            {field("baseRate", rateLabel, { inputMode: "decimal" })}
            {field("overtimeRate", "Overtime rate per hour (blank = automatic)", { inputMode: "decimal" })}
            {field("nationalId", "CNIC", { placeholder: "35202-1234567-1", autoComplete: "off" })}
            {field("bankName", "Bank")}
            {field("bankAccount", "Account / IBAN", { autoComplete: "off" })}
          </CardContent>
        </Card>
      ) : (
        nationalIdHint && <p className="text-sm text-muted-foreground">CNIC on file: {nationalIdHint}</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Contact</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="emp-address">Address</Label>
            <Textarea id="emp-address" rows={2} value={v.address} onChange={(e) => set("address", e.target.value)} />
          </div>
          {field("emergencyName", "Emergency contact")}
          {field("emergencyPhone", "Emergency phone", { inputMode: "tel" })}
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="emp-notes">Notes</Label>
            <Textarea id="emp-notes" rows={2} value={v.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <div className="sticky bottom-0 -mx-4 flex justify-end border-t bg-background/95 px-4 py-3 backdrop-blur">
        <Button type="submit" disabled={!hydrated || pending} data-testid="save-employee">
          {pending && <Loader2 className="animate-spin" />}
          {id ? "Save changes" : "Add employee"}
        </Button>
      </div>
    </form>
  );
}
