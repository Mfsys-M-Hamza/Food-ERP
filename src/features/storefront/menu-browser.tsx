"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import type { Catalog, CatalogProduct } from "@/server/modules/menu/catalog";
import { toggleFavoriteAction } from "@/server/modules/storefront/actions";
import { ItemDialog, isQuickAdd } from "@/features/pos/item-dialog";
import { ProductThumb } from "@/components/shared/product-thumb";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { apiGet } from "@/lib/api-client";
import { formatMoney, money } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useShopCart } from "./cart-store";

type Me = { favorites: string[] };

function fromPrice(p: CatalogProduct) {
  return p.variants.length ? p.variants.reduce((m, v) => (money(v.price).lessThan(m) ? v.price : m), p.variants[0]!.price) : p.price;
}

export function MenuBrowser({ catalog }: { catalog: Catalog }) {
  const params = useSearchParams();
  const add = useShopCart((s) => s.add);
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(catalog.categories[0]?.slug ?? "");
  const [open, setOpen] = useState<CatalogProduct | null>(() => {
    const slug = params.get("item");
    return slug ? (catalog.products.find((p) => p.slug === slug) ?? null) : null;
  });
  const me = useQuery({ queryKey: ["me"], queryFn: () => apiGet<Me>("/api/v1/me").catch(() => null), staleTime: 60_000 });
  const favs = new Set(me.data?.favorites ?? []);

  // Highlight the category in view.
  useEffect(() => {
    if (q) return;
    const sections = catalog.categories.map((c) => document.getElementById(c.slug)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: "-140px 0px -60% 0px" },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [catalog.categories, q]);

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? catalog.products.filter((p) => p.name.toLowerCase().includes(t) || p.description.toLowerCase().includes(t)) : null;
  }, [q, catalog.products]);

  function onPick(p: CatalogProduct) {
    if (!p.isAvailable) return;
    if (isQuickAdd(p) && p.addonGroups.length === 0 && p.removables.length === 0) {
      add({ productId: p.id, variantId: null, name: p.name, variantName: null, unitPrice: p.price, addons: [], removables: [], quantity: 1, note: "" });
      toast.success(`${p.name} added`);
    } else setOpen(p);
  }

  async function fav(p: CatalogProduct) {
    if (!me.data) return toast("Sign in to save favourites");
    const on = !favs.has(p.id);
    qc.setQueryData<Me | null>(["me"], (old) => (old ? { ...old, favorites: on ? [...old.favorites, p.id] : old.favorites.filter((x) => x !== p.id) } : old));
    const r = await toggleFavoriteAction(p.id, on);
    if (!r.ok) toast.error(r.error);
  }

  const card = (p: CatalogProduct) => (
    <div key={p.id} className={cn("group relative flex gap-4 rounded-2xl border bg-card p-3 transition", p.isAvailable ? "hover:shadow-md" : "opacity-55")}>
      <button type="button" className="flex min-w-0 flex-1 gap-4 text-left" onClick={() => onPick(p)} disabled={!p.isAvailable} data-testid={`menu-item-${p.name}`}>
        <div className="min-w-0 flex-1 py-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold leading-snug">{p.name}</h3>
            {p.type === "DEAL" && <Badge variant="secondary">Deal</Badge>}
          </div>
          {p.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{p.description}</p>}
          <div className="mt-2 text-sm font-semibold tabular">
            {p.isAvailable ? (
              <>
                {p.variants.length > 0 && <span className="font-normal text-muted-foreground">from </span>}
                {formatMoney(fromPrice(p))}
              </>
            ) : (
              <span className="text-muted-foreground">Sold out today</span>
            )}
          </div>
        </div>
        <div className="relative shrink-0">
          {p.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- menu photo
            <img src={p.imageUrl} alt="" loading="lazy" className="size-24 rounded-xl object-cover sm:size-28" />
          ) : (
            <ProductThumb name={p.name} className="size-24 rounded-xl text-2xl sm:size-28" />
          )}
          {p.isAvailable && (
            <span className="absolute -bottom-2 -right-2 grid size-9 place-items-center rounded-full bg-brand text-brand-foreground shadow-lg transition group-hover:scale-110">
              <Plus className="size-5" />
            </span>
          )}
        </div>
      </button>
      {me.data && (
        <button
          type="button"
          onClick={() => fav(p)}
          className="absolute left-2 top-2 grid size-8 place-items-center rounded-full bg-background/80 opacity-80 hover:opacity-100"
          aria-label={favs.has(p.id) ? `Remove ${p.name} from favourites` : `Save ${p.name} to favourites`}
          aria-pressed={favs.has(p.id)}
        >
          <Heart className={cn("size-4", favs.has(p.id) && "fill-brand text-brand")} />
        </button>
      )}
    </div>
  );

  return (
    <>
      <div className="sticky top-16 z-20 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto max-w-6xl space-y-2 px-4 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-11 rounded-full pl-9" placeholder="Search the menu" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the menu" />
          </div>
          {!q && (
            <nav className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label="Menu sections">
              {catalog.categories.map((c) => (
                <a
                  key={c.id}
                  href={`#${c.slug}`}
                  className={cn("shrink-0 rounded-full px-4 py-2 text-sm font-medium transition", active === c.slug ? "bg-foreground text-background" : "bg-muted hover:bg-accent")}
                >
                  {c.name}
                </a>
              ))}
            </nav>
          )}
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-4 py-6">
        {favs.size > 0 && !q && (
          <section className="mb-10">
            <h2 className="mb-3 flex items-center gap-2 text-xl font-semibold">
              <Heart className="size-5 fill-brand text-brand" /> Your favourites
            </h2>
            <div className="grid gap-3 md:grid-cols-2">{catalog.products.filter((p) => favs.has(p.id)).map(card)}</div>
          </section>
        )}
        {matches ? (
          <div className="grid gap-3 md:grid-cols-2">
            {matches.length === 0 && <p className="py-10 text-center text-muted-foreground md:col-span-2">Nothing matches “{q}”.</p>}
            {matches.map(card)}
          </div>
        ) : (
          catalog.categories.map((c) => (
            <section key={c.id} id={c.slug} className="mb-10 scroll-mt-40">
              <h2 className="text-xl font-semibold tracking-tight">{c.name}</h2>
              {c.description && <p className="text-sm text-muted-foreground">{c.description}</p>}
              <div className="mt-4 grid gap-3 md:grid-cols-2">{catalog.products.filter((p) => p.categoryId === c.id).map(card)}</div>
            </section>
          ))
        )}
      </div>
      <ItemDialog
        product={open}
        onClose={() => setOpen(null)}
        onConfirm={(line) => {
          add(line);
          toast.success(`${line.name} added`);
          setOpen(null);
        }}
      />
    </>
  );
}
