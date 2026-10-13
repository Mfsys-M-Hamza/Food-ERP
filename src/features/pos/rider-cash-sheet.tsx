"use client";

import { useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bike, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { listUnsettledCashAction, settleRiderCashAction } from "@/server/modules/delivery/rider-actions";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { timeAgo } from "@/lib/format";

/** Riders hand in cash collected on delivery; it goes into this till's shift. */
export function RiderCashSheet({ open, onClose, terminalId }: { open: boolean; onClose: () => void; terminalId: string | null }) {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["rider-cash"],
    queryFn: async () => {
      const r = await listUnsettledCashAction();
      if (!r.ok) throw new Error(r.error);
      return r.data;
    },
    enabled: open,
  });
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Rider cash</SheetTitle>
          <SheetDescription>Cash collected on delivery that riders have not handed in yet.</SheetDescription>
        </SheetHeader>
        {list.isError && <p className="px-4 text-sm text-destructive">{(list.error as Error).message}</p>}
        {list.data?.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">All rider cash is settled.</p>}
        <ul className="space-y-3 overflow-y-auto px-4 pb-4">
          {list.data?.map((r) => (
            <li key={r.riderId} className="space-y-2 rounded-xl border p-4" data-testid={`rider-cash-${r.riderName}`}>
              <div className="flex items-center gap-2">
                <Bike className="size-5 text-brand" />
                <span className="font-semibold">{r.riderName}</span>
                <span className="ml-auto text-lg font-semibold tabular">{formatMoney(r.total)}</span>
              </div>
              <ul className="text-sm text-muted-foreground">
                {r.deliveries.map((d) => (
                  <li key={d.orderId} className="flex justify-between">
                    <span>
                      #{d.displayNumber} · {timeAgo(d.deliveredAt)}
                    </span>
                    <span className="tabular">{formatMoney(d.amount)}</span>
                  </li>
                ))}
              </ul>
              <Button
                className="h-11 w-full"
                disabled={pending || !terminalId}
                onClick={() => {
                  setBusy(r.riderId);
                  start(async () => {
                    const res = await settleRiderCashAction({ riderId: r.riderId, orderIds: r.deliveries.map((d) => d.orderId), terminalId });
                    setBusy(null);
                    if (res.ok) {
                      toast.success(`Received ${formatMoney(res.data.total)} from ${r.riderName}`);
                      list.refetch();
                      qc.invalidateQueries({ queryKey: ["pos-shift"] });
                    } else toast.error(res.error);
                  });
                }}
              >
                {busy === r.riderId && <Loader2 className="animate-spin" />}
                Receive {formatMoney(r.total)}
              </Button>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
