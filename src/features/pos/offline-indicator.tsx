"use client";

import { useState } from "react";
import { CloudOff, RefreshCw, Trash2, Wifi } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { syncOfflineOrders, useOfflineQueue, useOnline } from "./offline-queue";

/** POS header badge: offline state and sales waiting to sync, with a list to retry or discard. */
export function OfflineIndicator() {
  const online = useOnline();
  const items = useOfflineQueue((s) => s.items);
  const syncing = useOfflineQueue((s) => s.syncing);
  const [open, setOpen] = useState(false);
  if (online && items.length === 0) return null;
  const failed = items.filter((i) => i.error).length;
  return (
    <>
      <Button variant={online ? "outline" : "destructive"} size="sm" onClick={() => setOpen(true)} data-testid="offline-indicator">
        {online ? <Wifi /> : <CloudOff />}
        {online ? "Online" : "Offline"}
        {items.length > 0 && <Badge className="ml-1 bg-warning text-warning-foreground">{items.length} to sync</Badge>}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Offline sales</SheetTitle>
            <SheetDescription>
              {online ? "Connected. Waiting sales are sent automatically." : "No connection. Cash sales are saved on this till and sent when the internet is back."}
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-3 px-4">
            {items.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Nothing waiting.</p>}
            {items.map((i) => (
              <div key={i.id} className="rounded-lg border p-3 text-sm">
                <div className="flex justify-between">
                  <span>{formatDateTime(i.queuedAt)}</span>
                  <span className="font-medium tabular">{formatMoney(i.total)}</span>
                </div>
                <div className="text-xs text-muted-foreground">{i.input.items.reduce((s, l) => s + l.quantity, 0)} items · cash</div>
                {i.error && (
                  <div className="mt-2 space-y-2">
                    <p className="text-xs text-destructive">Could not be saved: {i.error}</p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          useOfflineQueue.setState((s) => ({ items: s.items.map((x) => (x.id === i.id ? { ...x, error: null } : x)) }));
                          void syncOfflineOrders();
                        }}
                      >
                        <RefreshCw /> Retry
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => {
                          if (!window.confirm("Discard this sale? Enter it again by hand if the money was taken.")) return;
                          useOfflineQueue.getState().remove(i.id);
                          toast.success("Discarded");
                        }}
                      >
                        <Trash2 /> Discard
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {failed === 0 && items.length > 0 && online && (
              <Button className="w-full" disabled={syncing} onClick={() => void syncOfflineOrders()}>
                <RefreshCw className={syncing ? "animate-spin" : ""} /> Sync now
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
