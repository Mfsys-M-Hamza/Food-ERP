"use client";

import { useMemo, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { ShiftSummary } from "@/server/modules/shifts/service";
import { openShiftAction, closeShiftAction, cashMovementAction } from "@/server/modules/shifts/actions";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney, money } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PosExpenseButton } from "@/features/expenses/pos-expense";

const NOTES = [5000, 1000, 500, 100, 50, 20, 10, 5, 2, 1];

export function OpenShiftDialog({
  open,
  terminalId,
  terminalName,
  onClose,
  onOpened,
}: {
  open: boolean;
  terminalId: string;
  terminalName: string;
  onClose: () => void;
  onOpened: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Open shift on {terminalName}</DialogTitle>
          <DialogDescription>Count the cash in the drawer before the first sale.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="opening">Opening cash</Label>
          <Input id="opening" autoFocus inputMode="decimal" className="h-12 text-lg tabular" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
        </div>
        <Button
          className="h-12"
          disabled={pending || amount === ""}
          onClick={() =>
            start(async () => {
              const r = await openShiftAction({ terminalId, openingCash: amount });
              if (r.ok) {
                toast.success(r.message);
                onOpened();
                onClose();
              } else toast.error(r.error);
            })
          }
          data-testid="open-shift"
        >
          {pending && <Loader2 className="animate-spin" />}
          Open shift
        </Button>
      </DialogContent>
    </Dialog>
  );
}

export function ShiftDialog({
  open,
  shift,
  onClose,
  onChanged,
}: {
  open: boolean;
  shift: ShiftSummary;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [moveType, setMoveType] = useState<"PAY_IN" | "PAY_OUT">("PAY_OUT");
  const [moveAmount, setMoveAmount] = useState("");
  const [moveReason, setMoveReason] = useState("");
  const [closed, setClosed] = useState<ShiftSummary | null>(null);
  const [pending, start] = useTransition();

  const counted = useMemo(
    () => NOTES.reduce((s, n) => s.plus(money(n).times(Number(counts[n] || 0))), money(0)),
    [counts],
  );
  const diff = counted.minus(money(shift.expectedCash));

  const rows: [string, string][] = [
    ["Opening cash", shift.openingCash],
    ["Cash sales", shift.cashSales],
    ["Cash refunds", `-${shift.cashRefunds}`],
    ["Pay-ins", shift.payIns],
    ["Pay-outs", `-${shift.payOuts}`],
    ["Expenses paid from drawer", `-${shift.expenses}`],
    ["Rider cash settled", shift.riderSettlements],
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Shift {shift.shiftNumber} · {shift.terminalName}
          </DialogTitle>
          <DialogDescription>
            Opened by {shift.openedBy} at {formatDateTime(shift.openedAt)} · {shift.orderCount} orders
          </DialogDescription>
        </DialogHeader>

        {closed ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-muted-foreground">Shift closed</p>
            <div className={cn("text-3xl font-semibold tabular", money(closed.difference ?? 0).isZero() ? "text-success" : "text-destructive")}>
              {money(closed.difference ?? 0).isZero()
                ? "Cash matches"
                : money(closed.difference!).isNegative()
                  ? `Short ${formatMoney(money(closed.difference!).abs())}`
                  : `Excess ${formatMoney(closed.difference!)}`}
            </div>
            <p className="text-sm text-muted-foreground">
              Expected {formatMoney(closed.expectedCash)} · Counted {formatMoney(closed.countedCash ?? 0)}
            </p>
            <Button className="h-12 w-full" onClick={onClose}>
              Done
            </Button>
          </div>
        ) : (
          <Tabs defaultValue="summary">
            <TabsList className="w-full">
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="move">Pay in / out</TabsTrigger>
              <TabsTrigger value="close">Close shift</TabsTrigger>
            </TabsList>
            <TabsContent value="summary" className="mt-4">
              <dl className="divide-y rounded-xl border text-sm">
                {rows.map(([k, v]) => (
                  <div key={k} className="flex justify-between px-4 py-2">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="tabular">{formatMoney(v)}</dd>
                  </div>
                ))}
                <div className="flex justify-between bg-muted/50 px-4 py-3 font-semibold">
                  <dt>Expected cash in drawer</dt>
                  <dd className="tabular" data-testid="expected-cash">{formatMoney(shift.expectedCash)}</dd>
                </div>
                <div className="flex justify-between px-4 py-2">
                  <dt className="text-muted-foreground">Card sales</dt>
                  <dd className="tabular">{formatMoney(shift.cardSales)}</dd>
                </div>
                <div className="flex justify-between px-4 py-2">
                  <dt className="text-muted-foreground">Online sales</dt>
                  <dd className="tabular">{formatMoney(shift.onlineSales)}</dd>
                </div>
              </dl>
            </TabsContent>
            <TabsContent value="move" className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-2">
                {(["PAY_OUT", "PAY_IN"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setMoveType(t)}
                    className={cn("h-12 rounded-xl border-2 font-medium", moveType === t ? "border-brand bg-brand/10" : "border-border")}
                  >
                    {t === "PAY_OUT" ? "Take cash out" : "Put cash in"}
                  </button>
                ))}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mv-amount">Amount</Label>
                <Input id="mv-amount" inputMode="decimal" className="h-11 tabular" value={moveAmount} onChange={(e) => setMoveAmount(e.target.value.replace(/[^\d.]/g, ""))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mv-reason">Reason</Label>
                <Input id="mv-reason" className="h-11" value={moveReason} onChange={(e) => setMoveReason(e.target.value)} placeholder="e.g. bought ice, change float" />
              </div>
              <Button
                className="h-12 w-full"
                disabled={pending || !moveAmount || moveReason.trim().length < 3}
                onClick={() =>
                  start(async () => {
                    const r = await cashMovementAction({ shiftId: shift.id, type: moveType, amount: moveAmount, reason: moveReason });
                    if (r.ok) {
                      toast.success(r.message);
                      setMoveAmount("");
                      setMoveReason("");
                      onChanged();
                    } else toast.error(r.error);
                  })
                }
              >
                Record
              </Button>
              <div className="border-t pt-4">
                <PosExpenseButton terminalId={shift.terminalId} onSaved={onChanged} />
              </div>
            </TabsContent>
            <TabsContent value="close" className="mt-4 space-y-4">
              <p className="text-sm text-muted-foreground">Count the notes and coins in the drawer.</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                {NOTES.map((n) => (
                  <label key={n} className="flex items-center gap-2 text-sm">
                    <span className="w-14 text-right tabular text-muted-foreground">{n} ×</span>
                    <Input
                      inputMode="numeric"
                      className="h-10 tabular"
                      value={counts[n] ?? ""}
                      onChange={(e) => setCounts({ ...counts, [n]: e.target.value.replace(/\D/g, "") })}
                      aria-label={`Number of ${n} notes`}
                    />
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2 rounded-xl bg-muted/60 p-4 text-center">
                <div>
                  <div className="text-xs text-muted-foreground">Expected</div>
                  <div className="font-semibold tabular">{formatMoney(shift.expectedCash)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Counted</div>
                  <div className="font-semibold tabular" data-testid="counted-cash">{formatMoney(counted)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{diff.isNegative() ? "Short" : "Excess"}</div>
                  <div className={cn("font-semibold tabular", diff.isZero() ? "text-success" : "text-destructive")}>{formatMoney(diff.abs())}</div>
                </div>
              </div>
              <Input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
              <Button
                className="h-12 w-full"
                variant={diff.isZero() ? "default" : "destructive"}
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await closeShiftAction({
                      shiftId: shift.id,
                      countedCash: counted.toFixed(2),
                      denominations: Object.fromEntries(NOTES.filter((n) => counts[n]).map((n) => [String(n), Number(counts[n])])),
                      note,
                    });
                    if (r.ok) {
                      setClosed(r.data);
                      onChanged();
                    } else toast.error(r.error);
                  })
                }
                data-testid="close-shift"
              >
                {pending && <Loader2 className="animate-spin" />}
                Close shift with {formatMoney(counted)}
              </Button>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
