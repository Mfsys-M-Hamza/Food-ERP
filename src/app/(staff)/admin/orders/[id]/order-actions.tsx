"use client";

import { useState, useTransition } from "react";
import { Ban, Loader2, Printer, RotateCcw, Wallet } from "lucide-react";
import { toast } from "sonner";
import {
  transitionOrderAction,
  cancelOrderAction,
  refundOrderAction,
  addPaymentAction,
} from "@/server/modules/orders/actions";
import { STATUS_LABEL, type OrderStatus } from "@/server/modules/orders/state-machine";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ManagerPinDialog } from "@/features/pos/manager-pin-dialog";
import { newRequestId, printDocument } from "@/lib/api-client";
import { formatMoney, money } from "@/lib/money";
import { cn } from "@/lib/utils";

type O = {
  id: string;
  displayNumber: number;
  status: OrderStatus;
  type: "TAKEAWAY" | "DELIVERY" | "DINE_IN";
  balanceDue: string;
  refundable: string;
  version: number;
  terminalId: string | null;
};

export function OrderActions({
  order,
  next,
  canRefund,
  canCancel,
  canTakePayment,
}: {
  order: O;
  next: OrderStatus[];
  canRefund: boolean;
  canCancel: boolean;
  canTakePayment: boolean;
}) {
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"refund" | "cancel" | "pay" | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"CASH" | "CARD" | "ONLINE">("CASH");
  const [reason, setReason] = useState("");
  const [pinOpen, setPinOpen] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const open = !["COMPLETED", "CANCELLED", "REFUNDED"].includes(order.status);

  function advance(to: OrderStatus) {
    start(async () => {
      const r = await transitionOrderAction(order.id, to, { expectedVersion: order.version, source: "ADMIN" });
      if (r.ok) toast.success(`Marked ${STATUS_LABEL[to]}`);
      else toast.error(r.error);
    });
  }

  function submit(overridePin?: string) {
    const terminalId = readTerminal() ?? order.terminalId;
    start(async () => {
      const r =
        mode === "refund"
          ? await refundOrderAction(order.id, { amount, method, reason, terminalId, overridePin })
          : mode === "cancel"
            ? await cancelOrderAction(order.id, { reason, terminalId, overridePin })
            : await addPaymentAction(order.id, { clientRequestId: newRequestId(), terminalId, payments: [{ method, amount: order.balanceDue }] });
      if (r.ok) {
        toast.success(r.message);
        setMode(null);
        setPinOpen(false);
        setReason("");
        setAmount("");
      } else if (r.fieldErrors?.overridePin || (overridePin && r.code === "PERMISSION_DENIED")) {
        setPinError(overridePin ? r.error : null);
        setPinOpen(true);
      } else toast.error(r.error);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Actions</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        {next.map((to) => (
          <Button key={to} disabled={pending} onClick={() => advance(to)} data-testid={`advance-${to}`}>
            {pending && <Loader2 className="animate-spin" />}
            Mark {STATUS_LABEL[to].toLowerCase()}
          </Button>
        ))}
        {canTakePayment && open && money(order.balanceDue).greaterThan(0) && (
          <Button variant="outline" onClick={() => setMode("pay")}>
            <Wallet /> Take payment ({formatMoney(order.balanceDue)})
          </Button>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => printDocument(`/print/receipt/${order.id}?auto=1`)}>
            <Printer /> Receipt
          </Button>
          <Button variant="outline" onClick={() => printDocument(`/print/kot/${order.id}?auto=1`)}>
            <Printer /> Kitchen ticket
          </Button>
        </div>
        {money(order.refundable).greaterThan(0) && order.status !== "CANCELLED" && (
          <Button
            variant="outline"
            onClick={() => {
              setAmount(order.refundable);
              setMode("refund");
            }}
            data-testid="refund-button"
          >
            <RotateCcw /> Refund{!canRefund && " (manager PIN)"}
          </Button>
        )}
        {open && (
          <Button variant="outline" className="text-destructive" onClick={() => setMode("cancel")} data-testid="cancel-button">
            <Ban /> Cancel order{!canCancel && " (manager PIN)"}
          </Button>
        )}
      </CardContent>

      <Dialog open={!!mode && !pinOpen} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{mode === "refund" ? "Refund" : mode === "cancel" ? "Cancel order" : "Take payment"} #{order.displayNumber}</DialogTitle>
            <DialogDescription>
              {mode === "refund" && `Up to ${formatMoney(order.refundable)} can be refunded.`}
              {mode === "cancel" && (money(order.refundable).greaterThan(0) ? `${formatMoney(order.refundable)} will be refunded the way it was paid.` : "Nothing has been paid.")}
              {mode === "pay" && `Amount due ${formatMoney(order.balanceDue)}`}
            </DialogDescription>
          </DialogHeader>
          {(mode === "refund" || mode === "pay") && (
            <div className="grid grid-cols-3 gap-2">
              {(["CASH", "CARD", "ONLINE"] as const).map((m) => (
                <button key={m} type="button" onClick={() => setMethod(m)} className={cn("h-11 rounded-xl border-2 text-sm font-medium", method === m ? "border-brand bg-brand/10" : "border-border")}>
                  {m === "CASH" ? "Cash" : m === "CARD" ? "Card" : "Online"}
                </button>
              ))}
            </div>
          )}
          {mode === "refund" && (
            <div className="space-y-1.5">
              <Label htmlFor="refund-amount">Amount</Label>
              <Input id="refund-amount" inputMode="decimal" className="tabular" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
            </div>
          )}
          {mode !== "pay" && (
            <div className="space-y-1.5">
              <Label htmlFor="reason">Reason</Label>
              <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Required" />
            </div>
          )}
          {method === "CASH" && mode !== "cancel" && <p className="text-xs text-muted-foreground">Cash is taken from the open shift on this device’s till.</p>}
          <Button
            variant={mode === "pay" ? "default" : "destructive"}
            className="h-11"
            disabled={pending || (mode !== "pay" && reason.trim().length < 3) || (mode === "refund" && !amount)}
            onClick={() => submit()}
            data-testid="confirm-action"
          >
            {pending && <Loader2 className="animate-spin" />}
            {mode === "refund" ? `Refund ${amount ? formatMoney(amount) : ""}` : mode === "cancel" ? "Cancel order" : "Record payment"}
          </Button>
        </DialogContent>
      </Dialog>
      <ManagerPinDialog open={pinOpen} reason="This needs a manager's approval." error={pinError} onCancel={() => setPinOpen(false)} onSubmit={(pin) => submit(pin)} />
    </Card>
  );
}

/** The till chosen on this device in the POS (stored with the cart). */
function readTerminal(): string | null {
  try {
    const raw = localStorage.getItem("ferp-pos-cart");
    return raw ? (JSON.parse(raw).state?.terminalId ?? null) : null;
  } catch {
    return null;
  }
}
