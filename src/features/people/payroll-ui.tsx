"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Printer, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import {
  createPayrollRunAction,
  recalculateRunAction,
  addManualLineAction,
  removeManualLineAction,
  cancelRunAction,
  approveRunAction,
  payPayslipAction,
  payAllAction,
} from "@/server/modules/people/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { METHOD_LABEL } from "@/lib/expenses";
import { formatMoney } from "@/lib/money";
import { formatMinutes } from "@/lib/attendance";
import { cn } from "@/lib/utils";

function monthRange(m: string) {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return { start: `${m}-01`, end: new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10) };
}

export function NewPayrollRunButton({ defaultMonth }: { defaultMonth: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [month, setMonth] = useState(defaultMonth);
  const [range, setRange] = useState(monthRange(defaultMonth));
  const [pending, start] = useTransition();
  const period = custom ? range : monthRange(month);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="new-payroll">
          <Plus /> Prepare payroll
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Prepare payroll</DialogTitle>
          <DialogDescription>Payslips are calculated from attendance, salaries and open advances. You can review and adjust before approval.</DialogDescription>
        </DialogHeader>
        {custom ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pr-start">From</Label>
              <Input id="pr-start" type="date" value={range.start} onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pr-end">To</Label>
              <Input id="pr-end" type="date" value={range.end} onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))} />
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="pr-month">Month</Label>
            <Input id="pr-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
        )}
        <button type="button" className="text-left text-sm text-muted-foreground underline" onClick={() => setCustom((c) => !c)}>
          {custom ? "Use a whole month" : "Use custom dates instead"}
        </button>
        <DialogFooter>
          <Button
            disabled={pending}
            data-testid="create-payroll"
            onClick={() =>
              start(async () => {
                const r = await createPayrollRunAction({ periodStart: period.start, periodEnd: period.end });
                if (r.ok) {
                  toast.success(r.message);
                  router.push(`/admin/payroll/${r.data.id}`);
                } else toast.error(Object.values(r.fieldErrors ?? {})[0]?.[0] ?? r.error);
              })
            }
          >
            {pending && <Loader2 className="animate-spin" />}
            Calculate payslips
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Line = { id: string; kind: "EARNING" | "DEDUCTION"; code: string; label: string; amount: string; isManual: boolean };
export type PayslipView = {
  id: string;
  employeeName: string;
  employeeCode: string;
  designation: string;
  payType: string;
  baseRate: string;
  payableDays: string;
  presentDays: string;
  absentDays: string;
  leaveDays: string;
  offDays: number;
  unrecordedDays: number;
  lateCount: number;
  overtimeMinutes: number;
  gross: string;
  deductions: string;
  net: string;
  paidAt: Date | null;
  paymentMethod: string | null;
  lines: Line[];
};

type Till = { terminalId: string; label: string };

export function RunActions({ id, status, version, canPrepare, canApprove, unpaid, tills, today }: { id: string; status: string; version: number; canPrepare: boolean; canApprove: boolean; unpaid: number; tills: Till[]; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(r.message);
        router.refresh();
      } else toast.error(r.error);
    });
  return (
    <div className="flex flex-wrap gap-2">
      {status === "DRAFT" && canPrepare && (
        <>
          <Button variant="outline" disabled={pending} onClick={() => run(() => recalculateRunAction(id))} data-testid="recalculate">
            <RefreshCw /> Recalculate
          </Button>
          <Button
            variant="outline"
            className="text-destructive"
            disabled={pending}
            onClick={() => {
              if (window.confirm("Cancel this draft payroll?")) run(() => cancelRunAction(id));
            }}
          >
            Cancel draft
          </Button>
        </>
      )}
      {status === "DRAFT" && canApprove && (
        <Button
          disabled={pending}
          data-testid="approve-payroll"
          onClick={() => {
            if (window.confirm("Approve this payroll? Payslips and the attendance they cover will be locked.")) run(() => approveRunAction(id, version));
          }}
        >
          {pending && <Loader2 className="animate-spin" />}
          Approve
        </Button>
      )}
      {status === "APPROVED" && canApprove && unpaid > 0 && <PayDialog label={`Pay all (${unpaid})`} tills={tills} today={today} onPay={(d) => payAllAction(id, d)} testId="pay-all" />}
    </div>
  );
}

function PayDialog({
  label,
  tills,
  today,
  onPay,
  testId,
  size,
}: {
  label: string;
  tills: Till[];
  today: string;
  onPay: (d: { paymentMethod: string; terminalId: string | null; paidOn: string; reference: string }) => Promise<{ ok: boolean; message?: string; error?: string }>;
  testId?: string;
  size?: "sm";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [terminalId, setTerminalId] = useState(tills[0]?.terminalId ?? "");
  const [paidOn, setPaidOn] = useState(today);
  const [reference, setReference] = useState("");
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size={size} data-testid={testId}>
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>Each payslip is recorded as a salary expense. Advance deductions are marked as recovered.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          {["BANK_TRANSFER", "CASH_OTHER", "CASH_DRAWER", "CHEQUE"].map((m) => (
            <button key={m} type="button" onClick={() => setMethod(m)} className={cn("rounded-full border-2 px-3 py-1.5 text-sm", method === m ? "border-brand bg-brand/10" : "border-border")}>
              {METHOD_LABEL[m]}
            </button>
          ))}
        </div>
        {method === "CASH_DRAWER" && (
          <select aria-label="Till" className="h-10 rounded-md border border-input bg-transparent px-2 text-sm" value={terminalId} onChange={(e) => setTerminalId(e.target.value)}>
            {tills.length === 0 && <option value="">No till has an open shift</option>}
            {tills.map((t) => (
              <option key={t.terminalId} value={t.terminalId}>
                {t.label}
              </option>
            ))}
          </select>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="pay-date">Paid on</Label>
            <Input id="pay-date" type="date" max={today} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-ref">Reference</Label>
            <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Transfer ID" />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={pending}
            data-testid="confirm-pay"
            onClick={() =>
              start(async () => {
                const r = await onPay({ paymentMethod: method, terminalId: method === "CASH_DRAWER" ? terminalId : null, paidOn, reference });
                if (r.ok) {
                  toast.success(r.message);
                  setOpen(false);
                  router.refresh();
                } else toast.error(r.error);
              })
            }
          >
            {pending && <Loader2 className="animate-spin" />}
            Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PayslipCard({ p, status, canPrepare, canApprove, tills, today }: { p: PayslipView; status: string; canPrepare: boolean; canApprove: boolean; tills: Till[]; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const earnings = p.lines.filter((l) => l.kind === "EARNING");
  const deductions = p.lines.filter((l) => l.kind === "DEDUCTION");
  const draft = status === "DRAFT";
  const lineRow = (l: Line) => (
    <li key={l.id} className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">
        {l.label}
        {l.isManual && draft && canPrepare && (
          <button
            type="button"
            aria-label={`Remove ${l.label}`}
            className="ml-1 align-middle text-destructive"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await removeManualLineAction(l.id);
                if (r.ok) router.refresh();
                else toast.error(r.error);
              })
            }
          >
            <X className="inline size-3.5" />
          </button>
        )}
      </span>
      <span className="tabular">{formatMoney(l.amount)}</span>
    </li>
  );
  return (
    <Card data-testid={`payslip-${p.employeeName}`}>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base">{p.employeeName}</CardTitle>
          <div className="text-xs text-muted-foreground">
            {p.employeeCode} · {p.designation}
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold tabular" data-testid="payslip-net">
            {formatMoney(p.net)}
          </div>
          {p.paidAt ? <Badge variant="secondary">Paid · {METHOD_LABEL[p.paymentMethod ?? ""] ?? ""}</Badge> : status === "APPROVED" ? <Badge variant="outline">Unpaid</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap gap-1.5 text-xs">
          <Badge variant="secondary">Present {Number(p.presentDays)}</Badge>
          {Number(p.absentDays) > 0 && <Badge variant="destructive">Absent {Number(p.absentDays)}</Badge>}
          {Number(p.leaveDays) > 0 && <Badge variant="outline">Leave {Number(p.leaveDays)}</Badge>}
          {p.lateCount > 0 && <Badge variant="outline">Late {p.lateCount}</Badge>}
          {p.overtimeMinutes > 0 && <Badge variant="outline">OT {formatMinutes(p.overtimeMinutes)}</Badge>}
          {p.unrecordedDays > 0 && <Badge className="bg-warning text-warning-foreground">No entry {p.unrecordedDays}</Badge>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <ul className="space-y-1">
            <li className="text-xs font-medium uppercase text-muted-foreground">Earnings</li>
            {earnings.map(lineRow)}
            <li className="flex justify-between border-t pt-1 font-medium">
              <span>Gross</span>
              <span className="tabular">{formatMoney(p.gross)}</span>
            </li>
          </ul>
          <ul className="space-y-1">
            <li className="text-xs font-medium uppercase text-muted-foreground">Deductions</li>
            {deductions.length === 0 && <li className="text-muted-foreground">None</li>}
            {deductions.map(lineRow)}
            <li className="flex justify-between border-t pt-1 font-medium">
              <span>Total</span>
              <span className="tabular">{formatMoney(p.deductions)}</span>
            </li>
          </ul>
        </div>
        <div className="flex flex-wrap gap-2 border-t pt-3">
          {draft && canPrepare && <AddLineDialog payslipId={p.id} name={p.employeeName} />}
          <Button asChild size="sm" variant="outline">
            <a href={`/print/payslip/${p.id}?auto=1`} target="_blank" rel="noreferrer">
              <Printer /> Salary slip
            </a>
          </Button>
          {status === "APPROVED" && canApprove && !p.paidAt && (
            <PayDialog size="sm" label={`Pay ${p.employeeName}`} tills={tills} today={today} onPay={(d) => payPayslipAction(p.id, d)} testId={`pay-${p.employeeName}`} />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function AddLineDialog({ payslipId, name }: { payslipId: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"EARNING" | "DEDUCTION">("EARNING");
  const [code, setCode] = useState("BONUS");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [pending, start] = useTransition();
  const codes = kind === "EARNING" ? [["BONUS", "Bonus"], ["ALLOWANCE", "Allowance"], ["OTHER", "Other"]] : [["FINE", "Fine"], ["OTHER", "Other deduction"]];
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" data-testid={`add-line-${name}`}>
          <Plus /> Bonus or deduction
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adjust {name}&apos;s pay</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {(["EARNING", "DEDUCTION"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setKind(k);
                setCode(k === "EARNING" ? "BONUS" : "FINE");
              }}
              className={cn("h-11 rounded-xl border-2 text-sm font-medium", kind === k ? "border-brand bg-brand/10" : "border-border")}
            >
              {k === "EARNING" ? "Add to pay" : "Deduct"}
            </button>
          ))}
        </div>
        <select aria-label="Type" className="h-10 rounded-md border border-input bg-transparent px-2 text-sm" value={code} onChange={(e) => setCode(e.target.value)}>
          {codes.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <Input aria-label="Description" placeholder="e.g. Eid bonus" value={label} onChange={(e) => setLabel(e.target.value)} />
        <Input aria-label="Amount" inputMode="decimal" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
        <DialogFooter>
          <Button
            disabled={pending || !amount || label.trim().length < 2}
            data-testid="save-line"
            onClick={() =>
              start(async () => {
                const r = await addManualLineAction(payslipId, { kind, code, label, amount });
                if (r.ok) {
                  toast.success(r.message);
                  setOpen(false);
                  setLabel("");
                  setAmount("");
                  router.refresh();
                } else toast.error(Object.values(r.fieldErrors ?? {})[0]?.[0] ?? r.error);
              })
            }
          >
            {pending && <Loader2 className="animate-spin" />}
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
