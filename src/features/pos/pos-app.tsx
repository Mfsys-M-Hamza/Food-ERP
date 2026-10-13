"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bike,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Hand,
  LayoutDashboard,
  Loader2,
  Lock,
  Minus,
  Pause,
  Pencil,
  Percent,
  Phone,
  Plus,
  Printer,
  Search,
  ShoppingBag,
  Trash2,
  UserRound,
  UtensilsCrossed,
  Wallet,
  X,
  Ticket,
} from "lucide-react";
import { toast } from "sonner";
import { apiGet, printDocument } from "@/lib/api-client";
import { placeOrderAction, holdCartAction } from "@/server/modules/orders/actions";
import type { PosBootstrap } from "@/server/modules/pos/bootstrap";
import type { CatalogProduct } from "@/server/modules/menu/catalog";
import type { ShiftSummary } from "@/server/modules/shifts/service";
import type { OrderDetail } from "@/server/modules/orders/service";
import type { CreateOrderInput } from "@/server/modules/orders/schemas";
import { priceOrder, deliveryChargeFor } from "@/lib/orders/pricing";
import { formatMoney, money } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";
import { ProductThumb } from "@/components/shared/product-thumb";
import { useCart, cartSnapshot, type CartLine } from "./store";
import { ItemDialog, isQuickAdd } from "./item-dialog";
import { PaymentDialog } from "./payment-dialog";
import { CustomerDialog } from "./customer-dialog";
import { OpenShiftDialog, ShiftDialog } from "./shift-dialog";
import { OrdersSheet } from "./orders-sheet";
import { HeldSheet, SwitchUserDialog, DiscountDialog } from "./small-dialogs";
import { PromoDialog, usePromoQuote } from "./promo-dialog";
import { OfflineIndicator } from "./offline-indicator";
import { useOfflineQueue, useOfflineSync } from "./offline-queue";
import { RiderCashSheet } from "./rider-cash-sheet";
import { useLiveEvents, playChime } from "@/features/realtime/use-live-events";
import { setOnlinePauseAction } from "@/server/modules/storefront/actions";

export function PosApp() {
  const qc = useQueryClient();
  const boot = useQuery({
    queryKey: ["pos-bootstrap"],
    queryFn: () => apiGet<PosBootstrap>("/api/v1/pos/bootstrap"),
    refetchInterval: 60_000,
  });
  const cart = useCart();
  const audioRef = useRef<AudioContext | null>(null);
  useLiveEvents(
    useCallback(
      (e: { type: string; data: Record<string, unknown> }) => {
        if (e.type.startsWith("order.") || e.type.startsWith("delivery.")) qc.invalidateQueries({ queryKey: ["pos-orders"] });
        if (e.type === "order.created" && (e.data.source === "WEBSITE" || e.data.source === "PWA")) {
          try {
            audioRef.current ??= new AudioContext();
            playChime(audioRef.current);
          } catch {}
          toast.info(e.data.status === "NEW" ? "New online order — open Orders to accept it" : "New online order received", { duration: 8000 });
        }
        if (e.type === "menu.availability_changed") qc.invalidateQueries({ queryKey: ["pos-bootstrap"] });
      },
      [qc],
    ),
  );
  const terminals = useMemo(() => boot.data?.terminals ?? [], [boot.data]);
  const terminalId = cart.terminalId && terminals.some((t) => t.id === cart.terminalId) ? cart.terminalId : null;
  const terminalName = terminals.find((t) => t.id === terminalId)?.name ?? "";

  // Auto-select the only till.
  useEffect(() => {
    if (!terminalId && terminals.length === 1) useCart.getState().setTerminal(terminals[0]!.id);
  }, [terminalId, terminals]);

  const shift = useQuery({
    queryKey: ["pos-shift", terminalId],
    queryFn: () => apiGet<ShiftSummary | null>(`/api/v1/pos/shift?terminalId=${terminalId}`),
    enabled: !!terminalId,
    refetchInterval: 60_000,
  });
  const activeOrders = useQuery({
    queryKey: ["pos-orders", "active-count"],
    queryFn: () => apiGet<{ total: number }>("/api/v1/pos/orders?scope=active"),
    refetchInterval: 15_000,
  });

  const [category, setCategory] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [dialogProduct, setDialogProduct] = useState<CatalogProduct | null>(null);
  const [editing, setEditing] = useState<CartLine | undefined>();
  const [payOpen, setPayOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [promoOpen, setPromoOpen] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const [riderCashOpen, setRiderCashOpen] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [locked, setLocked] = useState(false);
  const [shiftOpen, setShiftOpen] = useState(false);
  // Keep the dialog mounted after closing the shift so the result stays on screen.
  const [dialogShift, setDialogShift] = useState<ShiftSummary | null>(null);
  const [openShiftOpen, setOpenShiftOpen] = useState(false);
  const [terminalPick, setTerminalPick] = useState(false);
  const [done, setDone] = useState<{ order: OrderDetail; change: string } | null>(null);
  const [queued, setQueued] = useState<{ total: string; change: string } | null>(null);
  const [pending, start] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);

  // Keyboard: "/" focuses search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Lock the till after inactivity.
  const idleMinutes = boot.data?.settings.pos.lockAfterIdleMinutes ?? 0;
  useEffect(() => {
    if (!idleMinutes) return;
    let timer = setTimeout(() => setLocked(true), idleMinutes * 60_000);
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setLocked(true), idleMinutes * 60_000);
    };
    const events = ["pointerdown", "keydown"] as const;
    events.forEach((ev) => window.addEventListener(ev, reset));
    return () => {
      clearTimeout(timer);
      events.forEach((ev) => window.removeEventListener(ev, reset));
    };
  }, [idleMinutes]);

  const products = useMemo(() => {
    const all = boot.data?.catalog.products ?? [];
    const q = search.trim().toLowerCase();
    if (q) return all.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
    return category === "all" ? all : all.filter((p) => p.categoryId === category);
  }, [boot.data, category, search]);

  const settings = boot.data?.settings;
  const zones = useMemo(() => boot.data?.zones ?? [], [boot.data]);
  const totals = useMemo(() => {
    if (!settings) return null;
    const pre = priceOrder({
      lines: cart.lines.map((l) => ({ unitPrice: l.unitPrice, addonsUnitTotal: l.addons.reduce((s, a) => s.plus(a.price), money(0)), quantity: l.quantity })),
      discount: cart.discount,
    });
    const zone = zones.find((z) => z.id === cart.delivery?.zoneId) ?? null;
    const delivery =
      cart.type === "DELIVERY"
        ? deliveryChargeFor(money(pre.subtotal).minus(pre.discount), zone ? { charge: zone.charge, freeAbove: zone.freeAbove || null } : null, settings.delivery)
        : "0";
    return priceOrder({
      lines: cart.lines.map((l) => ({ unitPrice: l.unitPrice, addonsUnitTotal: l.addons.reduce((s, a) => s.plus(a.price), money(0)), quantity: l.quantity })),
      discount: cart.discount,
      serviceChargePercent: cart.type === "DINE_IN" && settings.finance.serviceChargeEnabled ? settings.finance.serviceChargePercent : 0,
      deliveryCharge: delivery,
      tax: { enabled: settings.finance.taxEnabled, rate: settings.finance.taxRateCash, inclusive: settings.finance.pricesIncludeTax },
    });
  }, [cart.lines, cart.discount, cart.type, cart.delivery, settings, zones]);

  // Cash total with cash rounding, for sales taken while offline.
  const offlineTotal = useMemo(() => {
    if (!settings || !totals) return null;
    return priceOrder({
      lines: cart.lines.map((l) => ({ unitPrice: l.unitPrice, addonsUnitTotal: l.addons.reduce((s, a) => s.plus(a.price), money(0)), quantity: l.quantity })),
      discount: cart.discount,
      serviceChargePercent: cart.type === "DINE_IN" && settings.finance.serviceChargeEnabled ? settings.finance.serviceChargePercent : 0,
      deliveryCharge: totals.deliveryCharge,
      tax: { enabled: settings.finance.taxEnabled, rate: settings.finance.taxRateCash, inclusive: settings.finance.pricesIncludeTax },
      cashRoundingStep: settings.finance.cashRoundingStep,
    }).grandTotal;
  }, [cart.lines, cart.discount, cart.type, settings, totals]);
  const refreshAfterSync = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["pos-shift"] });
    qc.invalidateQueries({ queryKey: ["pos-orders"] });
  }, [qc]);
  useOfflineSync(refreshAfterSync);

  // With a coupon or points, the server prices the cart (it knows the rules); otherwise totals are local.
  const promo = usePromoQuote(cart.couponCode || cart.redeemPoints ? buildInput : null, [cart.lines, cart.couponCode, cart.redeemPoints, cart.customer?.id, cart.type, cart.delivery?.zoneId, cart.discount]);
  const shown = promo.data ?? totals;
  const itemCount = cart.lines.reduce((s, l) => s + l.quantity, 0);
  const needsCustomer = cart.type === "DELIVERY" && (!cart.customer?.phone || !cart.delivery?.addressLine);

  function onProduct(p: CatalogProduct) {
    if (!p.isAvailable) return toast.error(`${p.name} is out of stock`);
    if (isQuickAdd(p)) {
      cart.addLine({ productId: p.id, variantId: null, name: p.name, variantName: null, unitPrice: p.price, addons: [], removables: [], quantity: 1, note: "" });
    } else {
      setEditing(undefined);
      setDialogProduct(p);
    }
  }

  function buildInput(payments: { method: "CASH" | "CARD" | "ONLINE"; amount: string; tendered?: string; reference?: string }[], overridePin?: string): CreateOrderInput {
    const s = useCart.getState();
    return {
      clientRequestId: s.requestId,
      source: s.source,
      type: s.type,
      tableLabel: s.tableLabel,
      customerId: s.customer?.id ?? null,
      customer: s.customer ? { name: s.customer.name, phone: s.customer.phone } : undefined,
      delivery: s.type === "DELIVERY" && s.delivery ? { ...s.delivery, saveAddress: true } : undefined,
      items: s.lines.map((l) => ({
        productId: l.productId,
        variantId: l.variantId,
        quantity: l.quantity,
        addonIds: l.addons.map((a) => a.id),
        removableIds: l.removables.map((r) => r.id),
        note: l.note,
      })),
      discount: s.discount ? { type: s.discount.type, value: s.discount.value, reason: s.discount.reason } : null,
      couponCode: s.couponCode,
      redeemPoints: s.redeemPoints,
      kitchenNote: s.kitchenNote,
      payments,
      terminalId,
      overridePin,
    };
  }

  function afterPlaced(order: OrderDetail, change: string) {
    setPayOpen(false);
    setDone({ order, change });
    cart.clear();
    qc.invalidateQueries({ queryKey: ["pos-shift"] });
    qc.invalidateQueries({ queryKey: ["pos-orders"] });
    if (settings?.pos.autoPrintReceipt && order.payments.length) printDocument(`/print/receipt/${order.id}?auto=1`);
    if (settings?.pos.autoPrintKitchenTicket) setTimeout(() => printDocument(`/print/kot/${order.id}?auto=1`), 800);
  }

  function afterQueued(input: CreateOrderInput, total: string, change: string) {
    useOfflineQueue.getState().add(input, total);
    setPayOpen(false);
    setQueued({ total, change });
    cart.clear();
  }

  function payLater() {
    start(async () => {
      const r = await placeOrderAction(buildInput([]));
      if (r.ok) afterPlaced(r.data, "0");
      else toast.error(r.error);
    });
  }

  function hold() {
    const s = useCart.getState();
    start(async () => {
      const label = s.customer?.name || `Hold ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      const r = await holdCartAction({ terminalId, label, itemCount, total: totals?.grandTotal ?? "0", payload: cartSnapshot(s) });
      if (r.ok) {
        toast.success(`Held as “${label}”`);
        cart.clear();
      } else toast.error(r.error);
    });
  }

  if (boot.isLoading) {
    return (
      <div className="grid h-svh place-items-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (boot.isError || !boot.data) {
    return (
      <div className="grid h-svh place-items-center p-6 text-center">
        <div>
          <p className="font-medium">The POS could not load.</p>
          <p className="text-sm text-muted-foreground">{(boot.error as Error)?.message}</p>
          <Button className="mt-4" onClick={() => boot.refetch()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const { catalog, me, staff } = boot.data;
  const openShift = shift.data;
  const canCharge = cart.lines.length > 0 && !needsCustomer;

  return (
    <div className="flex h-svh flex-col bg-muted/30">
      {/* ── Top bar ─────────────────────────────────────────── */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-3">
        <span className="grid size-8 place-items-center rounded-lg bg-brand text-brand-foreground">
          <UtensilsCrossed className="size-4" />
        </span>
        <span className="hidden font-semibold md:inline">{settings!.businessName}</span>
        <Button variant="ghost" size="sm" onClick={() => setTerminalPick(true)} data-testid="terminal-select">
          {terminalName || "Choose till"} <ChevronDown />
        </Button>
        {terminalId &&
          (openShift ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDialogShift(openShift);
                setShiftOpen(true);
              }}
              data-testid="shift-button"
            >
              <Wallet /> {openShift.shiftNumber}
            </Button>
          ) : (
            <Button size="sm" variant="secondary" className="border border-warning/60 bg-warning/20" onClick={() => setOpenShiftOpen(true)}>
              <Wallet /> Open shift
            </Button>
          ))}
        <div className="ml-auto flex items-center gap-1">
          <OfflineIndicator />
          <Button variant="ghost" size="sm" onClick={() => setOrdersOpen(true)} data-testid="orders-button">
            <ClipboardList /> Orders
            {!!activeOrders.data?.total && <Badge className="ml-1 bg-brand text-brand-foreground">{activeOrders.data.total}</Badge>}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setHeldOpen(true)}>
            <Pause /> Held
          </Button>
          {(me.isOwner || me.permissions.includes("delivery.settle")) && (
            <Button variant="ghost" size="sm" onClick={() => setRiderCashOpen(true)} data-testid="rider-cash-button">
              <Bike /> <span className="hidden lg:inline">Rider cash</span>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" data-testid="pos-user-menu">
                <UserRound /> <span className="hidden sm:inline">{me.user.name}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setSwitchOpen(true)}>
                <UserRound /> Switch user
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setLocked(true)}>
                <Lock /> Lock till
              </DropdownMenuItem>
              {(me.isOwner || me.permissions.includes("orders.accept")) && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={async () => {
                      const r = await setOnlinePauseAction(30);
                      if (r.ok) toast.success("Online orders paused for 30 minutes");
                      else toast.error(r.error);
                    }}
                  >
                    <Pause /> Pause online orders (30 min)
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={async () => {
                      const r = await setOnlinePauseAction(0);
                      if (r.ok) toast.success("Online orders resumed");
                      else toast.error(r.error);
                    }}
                  >
                    Resume online orders
                  </DropdownMenuItem>
                </>
              )}
              {(me.isOwner || me.permissions.includes("dashboard.view")) && (
                <DropdownMenuItem asChild>
                  <Link href="/admin">
                    <LayoutDashboard /> Admin
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={async () => {
                  await authClient.signOut();
                  // Full reload: discard every bit of the previous user's client state.
                  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                  window.location.assign("/staff/login");
                }}
              >
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* ── Products ───────────────────────────────────────── */}
        <section className="flex min-h-0 flex-1 flex-col">
          <div className="space-y-2 border-b bg-background p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                className="h-11 pl-9 text-base"
                placeholder="Search menu  ( / )"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search menu"
              />
              {search && (
                <button className="absolute right-3 top-1/2 -translate-y-1/2" onClick={() => setSearch("")} aria-label="Clear search">
                  <X className="size-4" />
                </button>
              )}
            </div>
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Categories">
              {[{ id: "all", name: "All" }, ...catalog.categories].map((c) => (
                <button
                  key={c.id}
                  role="tab"
                  aria-selected={category === c.id && !search}
                  onClick={() => {
                    setCategory(c.id);
                    setSearch("");
                  }}
                  className={cn(
                    "h-10 shrink-0 rounded-full px-4 text-sm font-medium transition-colors",
                    category === c.id && !search ? "bg-foreground text-background" : "bg-muted hover:bg-accent",
                  )}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {products.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onProduct(p)}
                  disabled={!p.isAvailable}
                  data-testid={`product-${p.name}`}
                  className="group relative flex min-h-28 flex-col items-start gap-2 rounded-xl border bg-card p-3 text-left shadow-xs transition active:scale-[0.98] enabled:hover:border-brand/60 disabled:opacity-45"
                >
                  <div className="flex w-full items-start gap-2">
                    <ProductThumb name={p.name} imageUrl={p.imageUrl} className="size-11" />
                    {p.type === "DEAL" && <Badge variant="secondary" className="ml-auto">Deal</Badge>}
                  </div>
                  <span className="line-clamp-2 font-medium leading-snug">{p.name}</span>
                  <span className="mt-auto text-sm tabular text-muted-foreground">
                    {!p.isAvailable ? "Out of stock" : p.variants.length ? `from ${formatMoney(p.variants.reduce((m, v) => (money(v.price).lessThan(m) ? v.price : m), p.variants[0]!.price))}` : formatMoney(p.price)}
                  </span>
                </button>
              ))}
              {products.length === 0 && <p className="col-span-full py-12 text-center text-muted-foreground">No items found.</p>}
            </div>
          </div>
        </section>

        {/* ── Cart ───────────────────────────────────────────── */}
        <aside className="flex max-h-[55svh] min-h-0 w-full flex-col border-t bg-background lg:max-h-none lg:w-[400px] lg:border-l lg:border-t-0 xl:w-[440px]">
          <div className="space-y-2 border-b p-3">
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1" role="radiogroup" aria-label="Order type">
              {(
                [
                  ["TAKEAWAY", "Takeaway", ShoppingBag, settings!.ordering.takeawayEnabled],
                  ["DELIVERY", "Delivery", Bike, settings!.ordering.deliveryEnabled],
                  ["DINE_IN", "Dine-in", UtensilsCrossed, settings!.ordering.dineInEnabled],
                ] as const
              )
                .filter(([, , , on]) => on)
                .map(([t, label, Icon]) => (
                  <button
                    key={t}
                    role="radio"
                    aria-checked={cart.type === t}
                    onClick={() => cart.setType(t)}
                    className={cn("flex h-10 items-center justify-center gap-1.5 rounded-lg text-sm font-medium", cart.type === t ? "bg-background shadow-sm" : "text-muted-foreground")}
                  >
                    <Icon className="size-4" /> {label}
                  </button>
                ))}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="h-10 min-w-0 flex-1 justify-start" onClick={() => setCustomerOpen(true)} data-testid="customer-button">
                <UserRound />
                <span className="truncate">
                  {cart.customer ? `${cart.customer.name || "Customer"}${cart.customer.phone ? ` · ${formatPhone(cart.customer.phone) || cart.customer.phone}` : ""}` : cart.type === "DELIVERY" ? "Add customer & address" : "Walk-in customer"}
                </span>
              </Button>
              <Button
                variant={cart.source === "PHONE" ? "default" : "outline"}
                className="h-10"
                onClick={() => cart.setSource(cart.source === "PHONE" ? "POS" : "PHONE")}
                aria-pressed={cart.source === "PHONE"}
                title="Phone order"
              >
                <Phone />
              </Button>
            </div>
            {cart.type === "DELIVERY" && cart.delivery?.addressLine && (
              <p className="truncate text-xs text-muted-foreground">
                {zones.find((z) => z.id === cart.delivery?.zoneId)?.name ?? "No area"} · {cart.delivery.addressLine}
              </p>
            )}
            {cart.type === "DINE_IN" && (
              <Input placeholder="Table (e.g. T4)" value={cart.tableLabel} onChange={(e) => cart.setTableLabel(e.target.value)} className="h-9" />
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {cart.lines.length === 0 ? (
              <div className="flex h-full min-h-32 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
                <Hand className="size-8 opacity-40" />
                <p className="text-sm">Tap items to start an order.</p>
              </div>
            ) : (
              <ul className="divide-y" data-testid="cart-lines">
                {cart.lines.map((l) => {
                  const lineTotal = money(l.unitPrice).plus(l.addons.reduce((s, a) => s.plus(a.price), money(0))).times(l.quantity);
                  return (
                    <li key={l.key} className="flex gap-2 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium leading-snug">
                          {l.name}
                          {l.variantName && <span className="text-muted-foreground"> · {l.variantName}</span>}
                        </div>
                        {(l.addons.length > 0 || l.removables.length > 0 || l.note) && (
                          <div className="text-xs text-muted-foreground">
                            {[...l.addons.map((a) => `+ ${a.name}`), ...l.removables.map((r) => r.label), l.note && `“${l.note}”`].filter(Boolean).join(" · ")}
                          </div>
                        )}
                        <div className="mt-1.5 flex items-center gap-1">
                          <Button variant="outline" size="icon" className="size-9" onClick={() => cart.setQuantity(l.key, l.quantity - 1)} aria-label={`Less ${l.name}`}>
                            {l.quantity === 1 ? <Trash2 /> : <Minus />}
                          </Button>
                          <span className="w-8 text-center font-semibold tabular">{l.quantity}</span>
                          <Button variant="outline" size="icon" className="size-9" onClick={() => cart.setQuantity(l.key, l.quantity + 1)} aria-label={`More ${l.name}`}>
                            <Plus />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-9"
                            aria-label={`Edit ${l.name}`}
                            onClick={() => {
                              const p = catalog.products.find((x) => x.id === l.productId);
                              if (p) {
                                setEditing(l);
                                setDialogProduct(p);
                              }
                            }}
                          >
                            <Pencil />
                          </Button>
                        </div>
                      </div>
                      <div className="shrink-0 text-right font-medium tabular">{formatMoney(lineTotal)}</div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="space-y-2 border-t p-3">
            {shown && cart.lines.length > 0 && (
              <dl className="space-y-1 text-sm">
                <Row label="Subtotal" value={shown.subtotal} />
                {money(shown.discount).greaterThan(0) && (
                  <Row
                    label={[cart.discount ? `Discount${cart.discount.type === "PERCENT" ? ` ${cart.discount.value}%` : ""}` : null, cart.couponCode ? `Coupon ${cart.couponCode}` : null, cart.redeemPoints ? `${promo.data?.loyalty.used ?? cart.redeemPoints} points` : null].filter(Boolean).join(" + ") || "Discount"}
                    value={`-${shown.discount}`}
                  />
                )}
                {money(shown.serviceCharge).greaterThan(0) && <Row label="Service charge" value={shown.serviceCharge} />}
                {money(shown.tax).greaterThan(0) && <Row label={`${settings!.finance.taxLabel} (${shown.taxRate}%)`} value={shown.tax} />}
                {cart.type === "DELIVERY" && <Row label={promo.data?.coupon?.freeDelivery ? "Delivery (coupon)" : "Delivery"} value={shown.deliveryCharge} />}
                <div className="flex justify-between pt-1 text-lg font-semibold">
                  <dt>Total</dt>
                  <dd className="tabular" data-testid="cart-total">{formatMoney(shown.grandTotal)}</dd>
                </div>
                {promo.error && <p className="text-xs text-destructive" data-testid="promo-error">{promo.error}</p>}
              </dl>
            )}
            <div className="grid grid-cols-4 gap-2">
              <Button variant="outline" className="h-11 px-2" disabled={!cart.lines.length} onClick={() => setDiscountOpen(true)}>
                <Percent /> {cart.discount ? "Edit" : "Discount"}
              </Button>
              <Button variant="outline" className="h-11 px-2" disabled={!cart.lines.length} onClick={() => setPromoOpen(true)} data-testid="promo-button">
                <Ticket /> {cart.couponCode || cart.redeemPoints ? "Offer ✓" : "Offer"}
              </Button>
              <Button variant="outline" className="h-11" disabled={!cart.lines.length || pending} onClick={hold}>
                <Pause /> Hold
              </Button>
              <Button variant="outline" className="h-11 text-destructive" disabled={!cart.lines.length} onClick={() => cart.clear()}>
                <X /> Clear
              </Button>
            </div>
            {needsCustomer && cart.lines.length > 0 && <p className="text-center text-xs text-destructive">Add the customer’s phone and address for delivery.</p>}
            <div className="flex gap-2">
              {(cart.source === "PHONE" || cart.type === "DELIVERY") && (
                <Button variant="secondary" className="h-14 flex-1" disabled={!canCharge || pending} onClick={payLater} data-testid="pay-later">
                  {pending && <Loader2 className="animate-spin" />} Pay later
                </Button>
              )}
              <Button className="h-14 flex-[2] text-lg" disabled={!canCharge} onClick={() => setPayOpen(true)} data-testid="charge">
                Charge {shown && cart.lines.length > 0 ? formatMoney(shown.grandTotal) : ""}
              </Button>
            </div>
            {itemCount > 0 && <p className="text-center text-xs text-muted-foreground">{itemCount} item{itemCount === 1 ? "" : "s"}</p>}
          </div>
        </aside>
      </div>

      {/* ── Dialogs ───────────────────────────────────────────── */}
      <ItemDialog
        product={dialogProduct}
        initial={editing}
        onClose={() => setDialogProduct(null)}
        onConfirm={(line) => {
          if (editing) {
            cart.removeLine(editing.key);
          }
          cart.addLine(line);
          setDialogProduct(null);
          setEditing(undefined);
        }}
      />
      <PaymentDialog open={payOpen} onClose={() => setPayOpen(false)} buildInput={buildInput} splitEnabled={settings!.ordering.splitPaymentEnabled} onPlaced={afterPlaced} offlineTotal={offlineTotal} onQueued={afterQueued} />
      <CustomerDialog
        open={customerOpen}
        onClose={() => setCustomerOpen(false)}
        isDelivery={cart.type === "DELIVERY"}
        zones={zones}
        customer={cart.customer}
        delivery={cart.delivery}
        onSave={(c, d) => {
          cart.setCustomer(c);
          if (cart.type === "DELIVERY") cart.setDelivery(d);
        }}
      />
      <PromoDialog open={promoOpen} onClose={() => setPromoOpen(false)} buildInput={buildInput} customerName={cart.customer?.id ? cart.customer.name : null} />
      <DiscountDialog open={discountOpen} current={cart.discount} limitPercent={settings!.pos.cashierMaxDiscountPercent} onClose={() => setDiscountOpen(false)} onSave={cart.setDiscount} />
      <OrdersSheet open={ordersOpen} onClose={() => setOrdersOpen(false)} terminalId={terminalId} />
      <RiderCashSheet open={riderCashOpen} onClose={() => setRiderCashOpen(false)} terminalId={terminalId} />
      <HeldSheet open={heldOpen} onClose={() => setHeldOpen(false)} cartHasItems={cart.lines.length > 0} onResume={(p) => cart.restore(p as never)} />
      <SwitchUserDialog open={switchOpen} staff={staff} currentUserId={me.user.id} onClose={() => setSwitchOpen(false)} />
      {locked && <LockScreen staff={staff} />}
      {terminalId && (
        <OpenShiftDialog
          open={openShiftOpen}
          terminalId={terminalId}
          terminalName={terminalName}
          onClose={() => setOpenShiftOpen(false)}
          onOpened={() => shift.refetch()}
        />
      )}
      {(openShift ?? dialogShift) && (
        <ShiftDialog
          key={(openShift ?? dialogShift)!.id}
          open={shiftOpen}
          shift={openShift ?? dialogShift!}
          onClose={() => {
            setShiftOpen(false);
            setDialogShift(null);
          }}
          onChanged={() => shift.refetch()}
        />
      )}
      <Dialog open={terminalPick || (!terminalId && terminals.length > 1)} onOpenChange={(o) => !o && setTerminalPick(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Which till is this?</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            {terminals.map((t) => (
              <Button
                key={t.id}
                variant={t.id === terminalId ? "default" : "outline"}
                className="h-12"
                onClick={() => {
                  cart.setTerminal(t.id);
                  setTerminalPick(false);
                }}
              >
                {t.name}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!queued} onOpenChange={(o) => !o && setQueued(null)}>
        <DialogContent className="sm:max-w-md">
          {queued && (
            <div className="space-y-5 py-2 text-center" data-testid="order-queued">
              <CheckCircle2 className="mx-auto size-14 text-warning" />
              <div>
                <div className="text-lg font-semibold">Saved offline</div>
                <p className="text-sm text-muted-foreground">No connection. This cash sale ({formatMoney(queued.total)}) is saved on this till and will be sent automatically when the internet is back. Keep this screen open.</p>
              </div>
              {money(queued.change).greaterThan(0) && (
                <div className="rounded-2xl bg-success/10 p-4">
                  <div className="text-sm text-muted-foreground">Change to give</div>
                  <div className="text-3xl font-semibold text-success tabular">{formatMoney(queued.change)}</div>
                </div>
              )}
              <Button className="h-14 w-full text-lg" onClick={() => setQueued(null)} autoFocus>
                New order
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={!!done} onOpenChange={(o) => !o && setDone(null)}>
        <DialogContent className="sm:max-w-md">
          {done && (
            <div className="space-y-5 py-2 text-center" data-testid="order-success">
              <CheckCircle2 className="mx-auto size-14 text-success" />
              <div>
                <div className="text-sm text-muted-foreground">Order</div>
                <div className="text-5xl font-semibold tabular" data-testid="success-number">#{done.order.displayNumber}</div>
                <div className="mt-1 text-xs text-muted-foreground">{done.order.orderNumber}</div>
              </div>
              {money(done.change).greaterThan(0) && (
                <div className="rounded-2xl bg-success/10 p-4">
                  <div className="text-sm text-muted-foreground">Change to give</div>
                  <div className="text-3xl font-semibold text-success tabular">{formatMoney(done.change)}</div>
                </div>
              )}
              {done.order.paymentStatus === "UNPAID" && <p className="text-sm text-muted-foreground">Not paid yet — collect {formatMoney(done.order.grandTotal)} later.</p>}
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className="h-12" onClick={() => printDocument(`/print/receipt/${done.order.id}?auto=1`)}>
                  <Printer /> Receipt
                </Button>
                <Button variant="outline" className="h-12" onClick={() => printDocument(`/print/kot/${done.order.id}?auto=1`)}>
                  <Printer /> Kitchen ticket
                </Button>
              </div>
              <Button className="h-14 w-full text-lg" onClick={() => setDone(null)} autoFocus>
                New order
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted-foreground">
      <dt>{label}</dt>
      <dd className="tabular">{formatMoney(value)}</dd>
    </div>
  );
}

function LockScreen({ staff }: { staff: { id: string; name: string }[] }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/95 backdrop-blur">
      <div className="text-center">
        <Lock className="mx-auto size-10 text-muted-foreground" />
        <p className="mt-3 text-lg font-medium">Till locked</p>
        <SwitchUserDialog open staff={staff} currentUserId="" onClose={() => {}} />
      </div>
    </div>
  );
}
