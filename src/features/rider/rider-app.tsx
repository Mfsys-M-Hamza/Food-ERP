"use client";

import { useCallback, useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Bike, CheckCircle2, Clock, Loader2, MapPin, MessageCircle, Navigation, Phone, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { apiGet } from "@/lib/api-client";
import { riderUpdateAction } from "@/server/modules/delivery/rider-actions";
import type { RiderDelivery } from "@/server/modules/delivery/service";
import { useLiveEvents } from "@/features/realtime/use-live-events";
import { SignOutButton } from "@/components/shared/sign-out-button";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { formatMoney, money } from "@/lib/money";
import { formatPhone, whatsappDigits } from "@/lib/phone";
import { timeAgo } from "@/lib/format";

function mapsLink(d: RiderDelivery) {
  if (d.mapUrl) return d.mapUrl;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(d.addressText)}`;
}

export function RiderApp({ userName }: { userName: string }) {
  const qc = useQueryClient();
  const [scope, setScope] = useState<"active" | "today">("active");
  const live = useLiveEvents(
    useCallback((e) => (e.type.startsWith("order.") || e.type === "delivery.assigned") && qc.invalidateQueries({ queryKey: ["rider"] }), [qc]),
  );
  const list = useQuery({
    queryKey: ["rider", scope],
    queryFn: () => apiGet<RiderDelivery[]>(`/api/v1/rider/deliveries?scope=${scope}`),
    refetchInterval: live ? 60_000 : 10_000,
  });
  const [failFor, setFailFor] = useState<RiderDelivery | null>(null);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  const act = (d: RiderDelivery, action: "PICKED_UP" | "DELIVERED" | "FAILED", n = "") =>
    start(async () => {
      const r = await riderUpdateAction(d.orderId, { action, note: n });
      if (r.ok) {
        toast.success(action === "PICKED_UP" ? `#${d.displayNumber} on the way` : action === "DELIVERED" ? `#${d.displayNumber} delivered` : "Reported");
        setFailFor(null);
        setNote("");
      } else toast.error(r.error);
      qc.invalidateQueries({ queryKey: ["rider"] });
    });

  return (
    <div className="mx-auto flex min-h-svh max-w-lg flex-col bg-muted/30">
      <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b bg-background px-4">
        <Bike className="size-5 text-brand" />
        <span className="font-semibold">My deliveries</span>
        <span className="ml-auto truncate text-sm text-muted-foreground">{userName}</span>
        <Button asChild variant="ghost" size="icon" aria-label="My time clock">
          <Link href="/admin/clock">
            <Clock />
          </Link>
        </Button>
        <SignOutButton />
      </header>
      <div className="p-3">
        <Tabs value={scope} onValueChange={(v) => setScope(v as "active")}>
          <TabsList className="w-full">
            <TabsTrigger value="active">To deliver</TabsTrigger>
            <TabsTrigger value="today">Today</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <main className="flex-1 space-y-3 px-3 pb-6">
        {list.isLoading && <Loader2 className="mx-auto mt-10 animate-spin text-muted-foreground" />}
        {list.data?.length === 0 && (
          <div className="py-16 text-center text-muted-foreground">
            <CheckCircle2 className="mx-auto mb-2 size-10 opacity-40" />
            {scope === "active" ? "No deliveries assigned to you right now." : "No deliveries today."}
          </div>
        )}
        {list.data?.map((d) => (
          <article key={d.orderId} className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm" data-testid={`delivery-${d.displayNumber}`}>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold tabular">#{d.displayNumber}</span>
              <Badge variant={d.orderStatus === "READY" ? "default" : "secondary"}>
                {d.deliveryStatus === "DELIVERED"
                  ? "Delivered"
                  : d.deliveryStatus === "FAILED"
                    ? "Failed"
                    : d.orderStatus === "OUT_FOR_DELIVERY"
                      ? "On the way"
                      : d.orderStatus === "READY"
                        ? "Ready to pick up"
                        : "Being prepared"}
              </Badge>
              <span className="ml-auto text-xs text-muted-foreground">{timeAgo(d.createdAt)}</span>
            </div>
            <div>
              <div className="font-semibold">{d.recipientName}</div>
              <div className="flex gap-2 text-sm">
                <MapPin className="mt-0.5 size-4 shrink-0 text-brand" />
                <span>
                  {d.addressText}
                  {d.landmark && <span className="block text-muted-foreground">Near {d.landmark}</span>}
                  {d.zoneName && <span className="block text-muted-foreground">{d.zoneName}</span>}
                </span>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">{d.itemSummary}</p>
            <div className="flex items-center justify-between rounded-xl bg-muted/60 px-3 py-2">
              <span className="text-sm">{money(d.codAmount).greaterThan(0) ? "Collect cash" : "Already paid"}</span>
              <span className="text-xl font-bold tabular" data-testid={`collect-${d.displayNumber}`}>
                {money(d.codAmount).greaterThan(0) ? formatMoney(d.codAmount) : "—"}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Button asChild variant="outline" className="h-12">
                <a href={`tel:${d.phone}`} aria-label={`Call ${formatPhone(d.phone)}`}>
                  <Phone /> Call
                </a>
              </Button>
              <Button asChild variant="outline" className="h-12">
                <a href={`https://wa.me/${whatsappDigits(d.phone)}`} target="_blank" rel="noopener noreferrer">
                  <MessageCircle /> Chat
                </a>
              </Button>
              <Button asChild variant="outline" className="h-12">
                <a href={mapsLink(d)} target="_blank" rel="noopener noreferrer">
                  <Navigation /> Map
                </a>
              </Button>
            </div>
            {scope === "active" && (
              <div className="grid grid-cols-[1fr_auto] gap-2">
                {d.orderStatus === "OUT_FOR_DELIVERY" ? (
                  <Button className="h-14 bg-emerald-600 text-lg text-white hover:bg-emerald-700" disabled={pending} onClick={() => act(d, "DELIVERED")} data-testid={`delivered-${d.displayNumber}`}>
                    <CheckCircle2 /> Delivered
                  </Button>
                ) : (
                  <Button className="h-14 text-lg" disabled={pending || d.orderStatus !== "READY"} onClick={() => act(d, "PICKED_UP")} data-testid={`pickup-${d.displayNumber}`}>
                    <Bike /> {d.orderStatus === "READY" ? "Picked up" : "Waiting for kitchen"}
                  </Button>
                )}
                <Button variant="outline" className="h-14" onClick={() => setFailFor(d)} aria-label="Report a problem">
                  <TriangleAlert />
                </Button>
              </div>
            )}
          </article>
        ))}
      </main>
      <Dialog open={!!failFor} onOpenChange={(o) => !o && setFailFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Problem with #{failFor?.displayNumber}?</DialogTitle>
            <DialogDescription>The restaurant will be told straight away.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            {["Customer not answering", "Wrong address", "Customer refused", "Bike problem"].map((r) => (
              <Button key={r} variant="outline" size="sm" onClick={() => setNote(r)}>
                {r}
              </Button>
            ))}
          </div>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened?" />
          <Button variant="destructive" className="h-12" disabled={pending || note.trim().length < 3} onClick={() => failFor && act(failFor, "FAILED", note)}>
            Report
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
