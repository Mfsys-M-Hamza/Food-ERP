import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight, Banknote, Bike, ChefHat, Flame, ShoppingBag, Star } from "lucide-react";
import { getPublicCatalog, getPublicProfile } from "@/server/modules/storefront/store";
import type { CatalogProduct } from "@/server/modules/menu/catalog";
import { StoreStatusPill } from "@/features/storefront/store-status";
import { ProductThumb } from "@/components/shared/product-thumb";
import { Button } from "@/components/ui/button";
import { formatMoney, money } from "@/lib/money";

const priceOf = (p: CatalogProduct) =>
  p.variants.length ? p.variants.reduce((m, v) => (money(v.price).lessThan(m) ? v.price : m), p.variants[0]!.price) : p.price;

function Photo({ p, className }: { p: CatalogProduct; className: string }) {
  return p.imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- menu photo from storage
    <img src={p.imageUrl} alt={p.name} loading="lazy" className={`object-cover ${className}`} />
  ) : (
    <ProductThumb name={p.name} className={`${className} text-3xl`} />
  );
}

function SectionTitle({ eyebrow, title, href, link }: { eyebrow: string; title: string; href?: string; link?: string }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <div className="text-xs font-bold uppercase tracking-[0.2em] text-brand">{eyebrow}</div>
        <h2 className="mt-1 text-2xl font-extrabold uppercase tracking-tight sm:text-3xl">{title}</h2>
      </div>
      {href && (
        <Link href={href} className="shrink-0 text-sm font-semibold uppercase tracking-wide text-brand hover:underline">
          {link} →
        </Link>
      )}
    </div>
  );
}

export default async function HomePage() {
  const [{ profile, ordering, delivery, website }, catalog] = await Promise.all([getPublicProfile(), getPublicCatalog()]);
  const available = catalog.products.filter((p) => p.isAvailable);
  const deals = available.filter((p) => p.type === "DEAL");
  const favourites = available.filter((p) => p.isFeatured && p.type !== "DEAL").slice(0, 6);
  const hero = deals.find((d) => d.isFeatured) ?? available.find((p) => p.isFeatured) ?? available[0];
  const headline = website.heroTitle || profile.name;
  const subline = website.heroSubtitle || profile.tagline || "Freshly made food, delivered hot.";

  return (
    <main>
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative isolate overflow-hidden bg-[#141210] text-white">
        {hero?.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- decorative backdrop
          <img src={hero.imageUrl} alt="" aria-hidden className="absolute inset-0 -z-20 size-full scale-110 object-cover opacity-35 blur-2xl" />
        )}
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-r from-[#141210] via-[#141210]/85 to-[#141210]/30" />
        <div aria-hidden className="absolute -right-24 -top-24 -z-10 size-96 rounded-full bg-brand/25 blur-3xl" />
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 md:grid-cols-[1.15fr_1fr] md:py-20">
          <div className="animate-in fade-in slide-in-from-bottom-3 duration-700">
            <Suspense fallback={<span className="inline-block h-7 w-48 rounded-full bg-white/10" />}>
              <StoreStatusPill className="bg-white/10 text-white" />
            </Suspense>
            <h1 className="mt-5 text-4xl font-black uppercase leading-[0.95] tracking-tight sm:text-6xl lg:text-7xl">{headline}</h1>
            <p className="mt-5 max-w-lg text-lg text-white/75">{subline}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg" className="h-13 rounded-full bg-brand px-8 text-base font-bold uppercase tracking-wide text-brand-foreground shadow-lg shadow-brand/30 hover:bg-brand/90">
                <Link href="/menu" data-testid="order-now">
                  Order now <ArrowRight />
                </Link>
              </Button>
              {deals.length > 0 && (
                <Button asChild size="lg" variant="outline" className="h-13 rounded-full border-white/30 bg-transparent px-7 text-base font-semibold uppercase tracking-wide text-white hover:bg-white/10 hover:text-white">
                  <Link href="#deals">See deals</Link>
                </Button>
              )}
            </div>
            <dl className="mt-10 grid max-w-lg grid-cols-3 gap-3 text-sm">
              {ordering.deliveryEnabled && (
                <div className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
                  <Bike className="size-5 text-brand" />
                  <dt className="mt-2 text-white/60">Delivery</dt>
                  <dd className="font-semibold">~{delivery.estimatedMinutes} min</dd>
                </div>
              )}
              {ordering.takeawayEnabled && (
                <div className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
                  <ShoppingBag className="size-5 text-brand" />
                  <dt className="mt-2 text-white/60">Pick up</dt>
                  <dd className="font-semibold">~{ordering.defaultPrepMinutes} min</dd>
                </div>
              )}
              <div className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
                <Banknote className="size-5 text-brand" />
                <dt className="mt-2 text-white/60">Payment</dt>
                <dd className="font-semibold">Cash on delivery</dd>
              </div>
            </dl>
          </div>

          {hero && (
            <Link href={`/menu?item=${hero.slug}`} className="group relative hidden md:block" aria-label={`${hero.name}, ${formatMoney(priceOf(hero))}`}>
              <div className="absolute -inset-3 rotate-2 rounded-[2.25rem] bg-brand/30" />
              <div className="relative overflow-hidden rounded-[2rem] bg-[#1f1b18] shadow-2xl ring-1 ring-white/10">
                <div className="overflow-hidden">
                  <Photo p={hero} className="aspect-square w-full transition duration-500 group-hover:scale-105" />
                </div>
                <div className="flex items-center justify-between gap-4 px-6 py-4">
                  <div className="min-w-0">
                    <div className="truncate text-xl font-extrabold uppercase">{hero.name}</div>
                    <div className="truncate text-sm text-white/60">{hero.description}</div>
                  </div>
                  <span className="shrink-0 rounded-full bg-brand px-4 py-2 text-sm font-bold uppercase text-brand-foreground">Order</span>
                </div>
              </div>
              <div className="absolute -right-4 -top-4 grid size-24 rotate-6 place-items-center rounded-full bg-brand text-center text-brand-foreground shadow-xl">
                <div className="leading-tight">
                  <div className="text-[10px] font-bold uppercase">Only</div>
                  <div className="text-lg font-black tabular">{formatMoney(priceOf(hero), { decimals: 0 }).replace("Rs ", "")}</div>
                  <div className="text-[10px] font-bold uppercase">Rupees</div>
                </div>
              </div>
            </Link>
          )}
        </div>
      </section>

      {/* ── Categories ───────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-4 pt-14">
        <SectionTitle eyebrow="What are you craving?" title="Explore the menu" href="/menu" link="Full menu" />
        <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0 lg:grid-cols-7">
          {catalog.categories.map((c) => (
            <Link
              key={c.id}
              href={`/menu#${c.slug}`}
              className="group w-32 shrink-0 snap-start overflow-hidden rounded-2xl border bg-card text-center transition hover:-translate-y-1 hover:border-brand hover:shadow-xl sm:w-auto"
            >
              <div className="aspect-square overflow-hidden bg-muted">
                {c.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- category photo
                  <img src={c.imageUrl} alt="" loading="lazy" className="size-full object-cover transition duration-500 group-hover:scale-110" />
                ) : (
                  <ProductThumb name={c.name} className="size-full rounded-none text-2xl" />
                )}
              </div>
              <div className="px-2 py-3 text-xs font-bold uppercase tracking-wide group-hover:text-brand sm:text-sm">{c.name}</div>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Deals ────────────────────────────────────────────── */}
      {deals.length > 0 && (
        <section id="deals" className="mx-auto max-w-6xl scroll-mt-24 px-4 pt-16">
          <SectionTitle eyebrow="Best value" title="Hot deals" href="/menu#deals" link="All deals" />
          <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-3 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-4">
            {deals.slice(0, 8).map((d) => (
              <Link key={d.id} href={`/menu?item=${d.slug}`} className="group flex w-64 shrink-0 snap-start flex-col overflow-hidden rounded-2xl border bg-card transition hover:-translate-y-1 hover:border-brand hover:shadow-xl sm:w-auto">
                <div className="relative aspect-square overflow-hidden">
                  <Photo p={d} className="size-full transition duration-500 group-hover:scale-105" />
                  <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/75 px-2.5 py-1 text-[11px] font-bold uppercase text-white">
                    <Flame className="size-3 text-brand" /> Deal
                  </span>
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <div className="font-extrabold uppercase leading-tight">{d.name}</div>
                  <p className="mt-1 line-clamp-2 flex-1 text-sm text-muted-foreground">{d.description}</p>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-lg font-black tabular">{formatMoney(priceOf(d))}</span>
                    <span className="rounded-full bg-brand px-4 py-1.5 text-xs font-bold uppercase text-brand-foreground">Add</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── Favourites ───────────────────────────────────────── */}
      {favourites.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 pt-16">
          <SectionTitle eyebrow="Most ordered" title="Customer favourites" href="/menu" link="Order now" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {favourites.map((p) => (
              <Link key={p.id} href={`/menu?item=${p.slug}`} className="group flex items-center gap-4 rounded-2xl border bg-card p-3 transition hover:border-brand hover:shadow-lg">
                <div className="size-24 shrink-0 overflow-hidden rounded-xl">
                  <Photo p={p} className="size-full transition duration-500 group-hover:scale-110" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1 text-xs font-semibold text-brand">
                    <Star className="size-3 fill-current" /> Favourite
                  </div>
                  <div className="font-bold group-hover:text-brand">{p.name}</div>
                  <p className="line-clamp-1 text-sm text-muted-foreground">{p.description}</p>
                  <div className="mt-1 font-black tabular">
                    {p.variants.length ? <span className="text-xs font-medium text-muted-foreground">from </span> : null}
                    {formatMoney(priceOf(p))}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── Promise strip ────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-4 pt-16">
        <div className="grid gap-4 rounded-3xl bg-brand p-6 text-brand-foreground sm:grid-cols-3 sm:p-8">
          {[
            { icon: ChefHat, title: "Made to order", text: "Cooked fresh when you order, never kept waiting." },
            { icon: Bike, title: `Delivered in ~${delivery.estimatedMinutes} min`, text: "Our own riders bring it hot to your door." },
            { icon: Banknote, title: "Pay on delivery", text: "Cash when your food arrives, no card needed." },
          ].map((f) => (
            <div key={f.title} className="flex gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-black/15">
                <f.icon className="size-5" />
              </span>
              <div>
                <div className="font-extrabold uppercase">{f.title}</div>
                <p className="text-sm opacity-80">{f.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
