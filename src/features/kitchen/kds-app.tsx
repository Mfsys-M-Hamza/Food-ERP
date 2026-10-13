"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, ChefHat, CircleCheck, Clock, Flame, LayoutDashboard, Maximize, PackageX, Wifi, WifiOff } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { apiGet } from "@/lib/api-client";
import { transitionOrderAction } from "@/server/modules/orders/actions";
import { setAvailabilityAction } from "@/server/modules/menu/actions";
import type { KitchenTicket } from "@/server/modules/kitchen/service";
import type { Catalog } from "@/server/modules/menu/catalog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SignOutButton } from "@/components/shared/sign-out-button";
import { cn } from "@/lib/utils";
import { useLiveEvents, playChime } from "@/features/realtime/use-live-events";

const TYPE: Record<string, string> = { TAKEAWAY: "Takeaway", DELIVERY: "Delivery", DINE_IN: "Dine-in" };

function useNow(intervalMs = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function minutes(fromIso: string, now: number) {
  return Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 60_000));
}

export function KdsApp({ canUpdate, canToggleStock, userName, showAdmin }: { canUpdate: boolean; canToggleStock: boolean; userName: string; showAdmin: boolean }) {
  const qc = useQueryClient();
  const [soundOn, setSoundOn] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const [stockOpen, setStockOpen] = useState(false);
  const now = useNow();

  const live = useLiveEvents(
    useCallback(
      (e) => {
        if (e.type.startsWith("order.")) qc.invalidateQueries({ queryKey: ["kds"] });
        if (e.type === "menu.availability_changed") qc.invalidateQueries({ queryKey: ["kds-menu"] });
      },
      [qc],
    ),
  );

  const tickets = useQuery({
    queryKey: ["kds"],
    queryFn: () => apiGet<KitchenTicket[]>("/api/v1/kitchen/orders"),
    refetchInterval: live ? 30_000 : 5_000,
  });

  // Chime for orders we have not seen before (not on first load).
  useEffect(() => {
    if (!tickets.data) return;
    const ids = new Set(tickets.data.map((t) => t.id));
    if (seen.current) {
      const fresh = tickets.data.filter((t) => !seen.current!.has(t.id));
      if (fresh.length) {
        if (soundOn) playChime(audio.current);
        toast(`New order #${fresh.map((f) => f.displayNumber).join(", #")}`);
      }
    }
    seen.current = ids;
  }, [tickets.data, soundOn]);

  const columns = useMemo(() => {
    const t = tickets.data ?? [];
    return {
      incoming: t.filter((x) => x.status === "NEW" || x.status === "ACCEPTED"),
      preparing: t.filter((x) => x.status === "PREPARING"),
      ready: t.filter((x) => x.status === "READY"),
    };
  }, [tickets.data]);

  function enableSound() {
    audio.current ??= new AudioContext();
    void audio.current.resume();
    setSoundOn((s) => !s);
    if (!soundOn) playChime(audio.current);
  }

  return (
    <div className="flex h-svh flex-col bg-neutral-100 text-neutral-950 dark:bg-neutral-950 dark:text-neutral-50">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4">
        <ChefHat className="size-6 text-brand" />
        <span className="text-lg font-semibold">Kitchen</span>
        <Badge variant="outline" className="gap-1" title={live ? "Live updates connected" : "Reconnecting — refreshing every 5 s"}>
          {live ? <Wifi className="size-3.5 text-success" /> : <WifiOff className="size-3.5 text-destructive" />}
          {live ? "Live" : "Offline"}
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          {canToggleStock && (
            <Button variant="outline" size="sm" onClick={() => setStockOpen(true)}>
              <PackageX /> Out of stock
            </Button>
          )}
          <Button variant={soundOn ? "default" : "outline"} size="sm" onClick={enableSound} data-testid="sound-toggle">
            {soundOn ? <Bell /> : <BellOff />} Sound {soundOn ? "on" : "off"}
          </Button>
          <Button variant="ghost" size="icon" aria-label="Full screen" onClick={() => document.documentElement.requestFullscreen?.()}>
            <Maximize />
          </Button>
          {showAdmin && (
            <Button asChild variant="ghost" size="icon" aria-label="Admin">
              <Link href="/admin">
                <LayoutDashboard />
              </Link>
            </Button>
          )}
          <span className="hidden text-sm text-muted-foreground md:inline">{userName}</span>
          <Button asChild variant="ghost" size="icon" aria-label="My time clock">
            <Link href="/admin/clock">
              <Clock />
            </Link>
          </Button>
          <SignOutButton />
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 md:grid-cols-3 md:overflow-hidden">
        <Column title="New" count={columns.incoming.length} tone="sky">
          {columns.incoming.map((t) => (
            <Ticket key={t.id} t={t} now={now} canUpdate={canUpdate} />
          ))}
        </Column>
        <Column title="Preparing" count={columns.preparing.length} tone="amber">
          {columns.preparing.map((t) => (
            <Ticket key={t.id} t={t} now={now} canUpdate={canUpdate} />
          ))}
        </Column>
        <Column title="Ready" count={columns.ready.length} tone="emerald">
          {columns.ready.map((t) => (
            <Ticket key={t.id} t={t} now={now} canUpdate={canUpdate} />
          ))}
        </Column>
      </main>
      {canToggleStock && <StockSheet open={stockOpen} onClose={() => setStockOpen(false)} />}
    </div>
  );
}

function Column({ title, count, tone, children }: { title: string; count: number; tone: "sky" | "amber" | "emerald"; children: React.ReactNode }) {
  const bar = { sky: "bg-sky-500", amber: "bg-amber-500", emerald: "bg-emerald-500" }[tone];
  return (
    <section className="flex min-h-0 flex-col rounded-2xl bg-background/60" aria-label={title}>
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <span className={cn("size-2.5 rounded-full", bar)} />
        <h2 className="text-sm font-semibold uppercase tracking-wide">{title}</h2>
        <span className="ml-auto rounded-full bg-muted px-2 text-sm font-semibold tabular">{count}</span>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-3">
        {count === 0 && <p className="py-10 text-center text-sm text-muted-foreground">Nothing here.</p>}
        {children}
      </div>
    </section>
  );
}

function Ticket({ t, now, canUpdate }: { t: KitchenTicket; now: number; canUpdate: boolean }) {
  const [pending, start] = useTransition();
  const waited = minutes(t.createdAt, now);
  const expected = t.estimatedReadyAt ? Math.max(1, Math.round((new Date(t.estimatedReadyAt).getTime() - new Date(t.createdAt).getTime()) / 60_000)) : 20;
  const late = t.status !== "READY" && waited > expected;
  const warn = t.status !== "READY" && !late && waited >= expected * 0.75;

  const next = t.status === "NEW" ? "ACCEPTED" : t.status === "ACCEPTED" ? "PREPARING" : t.status === "PREPARING" ? "READY" : null;
  const label = { ACCEPTED: "Accept", PREPARING: "Start", READY: "Ready" } as Record<string, string>;

  function go() {
    if (!next) return;
    start(async () => {
      const r = await transitionOrderAction(t.id, next, { expectedVersion: t.version, source: "KDS" });
      if (!r.ok) toast.error(r.error);
    });
  }

  return (
    <article
      className={cn(
        "rounded-xl border-2 bg-card shadow-sm transition-colors",
        late ? "animate-pulse border-red-500" : warn ? "border-amber-400" : "border-transparent",
      )}
      data-testid={`kds-ticket-${t.displayNumber}`}
      aria-label={`Order ${t.displayNumber}`}
    >
      <header className={cn("flex items-center gap-2 rounded-t-[10px] px-3 py-2", late ? "bg-red-500 text-white" : "bg-muted")}>
        <span className="text-2xl font-bold tabular">#{t.displayNumber}</span>
        <span className="text-sm font-medium">{TYPE[t.type]}</span>
        {t.tableLabel && <Badge variant="secondary">{t.tableLabel}</Badge>}
        {t.source !== "POS" && <Badge variant="outline" className={late ? "border-white/60 text-white" : ""}>{t.source}</Badge>}
        <span className="ml-auto flex items-center gap-1 text-sm font-semibold tabular">
          {late && <Flame className="size-4" />}
          {waited} min
        </span>
      </header>
      <ul className="space-y-1.5 px-3 py-2.5">
        {t.items.map((i) => (
          <li key={i.id}>
            <div className="text-lg font-semibold leading-tight">
              <span className="tabular">{i.quantity}×</span> {i.name}
              {i.variant && <span className="font-medium text-muted-foreground"> · {i.variant}</span>}
            </div>
            {i.addons.map((a) => (
              <div key={a} className="pl-6 text-sm">+ {a}</div>
            ))}
            {i.removals.map((r) => (
              <div key={r} className="pl-6 text-sm font-bold uppercase text-red-600 dark:text-red-400">{r}</div>
            ))}
            {i.note && <div className="pl-6 text-sm italic text-amber-700 dark:text-amber-300">“{i.note}”</div>}
          </li>
        ))}
      </ul>
      {t.kitchenNote && <p className="mx-3 mb-2 rounded-md bg-amber-100 px-2 py-1 text-sm font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">Note: {t.kitchenNote}</p>}
      {t.customerFirstName && <p className="px-3 pb-2 text-xs text-muted-foreground">For {t.customerFirstName}</p>}
      {canUpdate && next && (
        <div className="px-3 pb-3">
          <Button
            className={cn("h-14 w-full text-lg", next === "READY" && "bg-emerald-600 text-white hover:bg-emerald-700")}
            disabled={pending}
            onClick={go}
            data-testid={`kds-${label[next]!.toLowerCase()}-${t.displayNumber}`}
          >
            {next === "READY" && <CircleCheck />}
            {label[next]}
          </Button>
        </div>
      )}
      {t.status === "READY" && <p className="px-3 pb-3 text-center text-sm font-medium text-emerald-700 dark:text-emerald-400">Waiting for pickup</p>}
    </article>
  );
}

function StockSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const menu = useQuery({
    queryKey: ["kds-menu"],
    queryFn: () => apiGet<Catalog>("/api/v1/kitchen/menu").catch(() => null),
    enabled: open,
  });
  const [pending, start] = useTransition();
  const products = menu.data?.products ?? [];
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Mark items out of stock</SheetTitle>
        </SheetHeader>
        {menu.data === null && <p className="px-4 text-sm text-muted-foreground">Menu could not be loaded for this account.</p>}
        <ul className="divide-y overflow-y-auto">
          {products.map((p) => (
            <li key={p.id} className="flex items-center justify-between px-4 py-3">
              <span className={cn("font-medium", !p.isAvailable && "text-muted-foreground line-through")}>{p.name}</span>
              <Switch
                checked={p.isAvailable}
                disabled={pending}
                aria-label={`${p.name} in stock`}
                onCheckedChange={(v) =>
                  start(async () => {
                    const r = await setAvailabilityAction({ productId: p.id, available: v });
                    if (!r.ok) toast.error(r.error);
                    qc.invalidateQueries({ queryKey: ["kds-menu"] });
                  })
                }
              />
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
