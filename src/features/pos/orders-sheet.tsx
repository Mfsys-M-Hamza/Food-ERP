"use client";

import { useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Loader2, Printer, Search, Wallet } from "lucide-react";
import { toast } from "sonner";
import { apiGet, newRequestId, printDocument } from "@/lib/api-client";
import { transitionOrderAction, cancelOrderAction, addPaymentAction } from "@/server/modules/orders/actions";
import type { OrderListRow } from "@/server/modules/orders/service";
import { nextStatuses, STATUS_LABEL, type OrderStatus } from "@/server/modules/orders/state-machine";
import { StatusBadge } from "@/features/orders/status-badge";
import { AssignRiderButton } from "@/features/delivery/assign-rider";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatMoney, money } from "@/lib/money";
import { timeAgo } from "@/lib/format";
import { ManagerPinDialog } from "./manager-pin-dialog";

export function OrdersSheet({ open, onClose, terminalId }: { open: boolean; onClose: () => void; terminalId: string | null }) {
  const [scope, setScope] = useState<"active" | "today">("active");
  const [q, setQ] = useState("");
  const qc = useQueryClient();
  const orders = useQuery({
    queryKey: ["pos-orders", scope, q],
    queryFn: () => apiGet<{ rows: OrderListRow[] }>(`/api/v1/pos/orders?scope=${scope}&q=${encodeURIComponent(q)}`),
    enabled: open,
    refetchInterval: open ? 10_000 : false,
  });
  const [pending, start] = useTransition();
  const [cancelFor, setCancelFor] = useState<OrderListRow | null>(null);
  const [payFor, setPayFor] = useState<OrderListRow | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["pos-orders"] });

  function advance(o: OrderListRow, to: OrderStatus) {
    start(async () => {
      const r = await transitionOrderAction(o.id, to, { source: "POS" });
      if (r.ok) toast.success(`#${o.displayNumber} → ${STATUS_LABEL[to]}`);
      else toast.error(r.error);
      refresh();
    });
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle>Orders</SheetTitle>
          <div className="flex gap-2 pt-2">
            <Tabs value={scope} onValueChange={(v) => setScope(v as "active")}>
              <TabsList>
                <TabsTrigger value="active">Active</TabsTrigger>
                <TabsTrigger value="today">Last 24 h</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8" placeholder="Number, name or phone" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto">
          {orders.isLoading && <Loader2 className="mx-auto mt-10 animate-spin text-muted-foreground" />}
          {orders.data?.rows.length === 0 && <p className="p-10 text-center text-sm text-muted-foreground">No orders.</p>}
          <ul className="divide-y">
            {orders.data?.rows.map((o) => {
              const due = money(o.grandTotal).minus(o.amountPaid);
              const next = nextStatuses(o.status, o.type as "TAKEAWAY");
              return (
                <li key={o.id} className="space-y-2 p-4" data-testid={`pos-order-${o.displayNumber}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-semibold tabular">#{o.displayNumber}</span>
                    <StatusBadge status={o.status} />
                    <Badge variant="outline">{o.type === "DELIVERY" ? "Delivery" : o.type === "DINE_IN" ? "Dine-in" : "Takeaway"}</Badge>
                    {o.source !== "POS" && <Badge variant="secondary">{o.source}</Badge>}
                    <span className="ml-auto text-xs text-muted-foreground">{timeAgo(o.createdAt)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="truncate text-muted-foreground">
                      {o.customerName ?? "Walk-in"} · {o.itemCount} item{o.itemCount === 1 ? "" : "s"}
                    </span>
                    <span className="font-medium tabular">
                      {formatMoney(o.grandTotal)}
                      {due.greaterThan(0) && <span className="ml-2 text-destructive">Due {formatMoney(due)}</span>}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {next.map((to) => (
                      <Button key={to} size="sm" disabled={pending} onClick={() => advance(o, to)}>
                        {to === "COMPLETED" ? (o.type === "DELIVERY" ? "Delivered" : "Picked up") : STATUS_LABEL[to]}
                      </Button>
                    ))}
                    {due.greaterThan(0) && !["CANCELLED", "REFUNDED"].includes(o.status) && (
                      <Button size="sm" variant="outline" onClick={() => setPayFor(o)}>
                        <Wallet /> Take payment
                      </Button>
                    )}
                    {o.type === "DELIVERY" && !["COMPLETED", "CANCELLED", "REFUNDED", "OUT_FOR_DELIVERY"].includes(o.status) && (
                      <AssignRiderButton orderId={o.id} currentRiderName={o.riderName} onDone={refresh} />
                    )}
                    <Button size="sm" variant="outline" onClick={() => printDocument(`/print/receipt/${o.id}?auto=1`)}>
                      <Printer /> Receipt
                    </Button>
                    {!["COMPLETED", "CANCELLED", "REFUNDED"].includes(o.status) && (
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setCancelFor(o)}>
                        <Ban /> Cancel
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <CancelDialog order={cancelFor} terminalId={terminalId} onClose={() => setCancelFor(null)} onDone={refresh} />
        <PayDialog order={payFor} terminalId={terminalId} onClose={() => setPayFor(null)} onDone={refresh} />
      </SheetContent>
    </Sheet>
  );
}

function CancelDialog({
  order,
  terminalId,
  onClose,
  onDone,
}: {
  order: OrderListRow | null;
  terminalId: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [pinOpen, setPinOpen] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(overridePin?: string) {
    if (!order) return;
    start(async () => {
      const r = await cancelOrderAction(order.id, { reason, terminalId, overridePin });
      if (r.ok) {
        toast.success(`Order #${order.displayNumber} cancelled${money(order.amountPaid).greaterThan(0) ? " and refunded" : ""}`);
        setPinOpen(false);
        setReason("");
        onDone();
        onClose();
      } else if (r.fieldErrors?.overridePin || (overridePin && r.code === "PERMISSION_DENIED")) {
        setPinError(overridePin ? r.error : null);
        setPinOpen(true);
      } else toast.error(r.error);
    });
  }

  return (
    <>
      <Dialog open={!!order && !pinOpen} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel order #{order?.displayNumber}?</DialogTitle>
            <DialogDescription>
              {order && money(order.amountPaid).greaterThan(0)
                ? `${formatMoney(order.amountPaid)} already paid will be refunded the same way it was paid.`
                : "Nothing has been paid yet."}
            </DialogDescription>
          </DialogHeader>
          <Input autoFocus placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button variant="destructive" className="h-11" disabled={pending || reason.trim().length < 3} onClick={() => submit()} data-testid="confirm-cancel">
            {pending && <Loader2 className="animate-spin" />}
            Cancel order
          </Button>
        </DialogContent>
      </Dialog>
      <ManagerPinDialog
        open={pinOpen}
        reason={`Cancelling order #${order?.displayNumber} needs a manager.`}
        error={pinError}
        onCancel={() => setPinOpen(false)}
        onSubmit={(pin) => submit(pin)}
      />
    </>
  );
}

function PayDialog({
  order,
  terminalId,
  onClose,
  onDone,
}: {
  order: OrderListRow | null;
  terminalId: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const due = order ? money(order.grandTotal).minus(order.amountPaid) : money(0);
  const pay = (method: "CASH" | "CARD" | "ONLINE") =>
    start(async () => {
      const r = await addPaymentAction(order!.id, {
        clientRequestId: newRequestId(),
        terminalId,
        payments: [{ method, amount: due.toFixed(2) }],
      });
      if (r.ok) {
        toast.success(r.message);
        onDone();
        onClose();
      } else toast.error(r.error);
    });
  return (
    <Dialog open={!!order} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Take payment for #{order?.displayNumber}</DialogTitle>
          <DialogDescription>Amount due {formatMoney(due)}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-2">
          {(["CASH", "CARD", "ONLINE"] as const).map((m) => (
            <Button key={m} className="h-14" variant="outline" disabled={pending} onClick={() => pay(m)}>
              {m === "CASH" ? "Cash" : m === "CARD" ? "Card" : "Online"}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
