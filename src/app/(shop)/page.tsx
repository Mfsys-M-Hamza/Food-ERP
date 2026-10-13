import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight, Bike, Clock, ShoppingBag, Star } from "lucide-react";
import { getPublicCatalog, getPublicProfile } from "@/server/modules/storefront/store";
import { StoreStatusPill } from "@/features/storefront/store-status";
import { ProductThumb } from "@/components/shared/product-thumb";
import { Button } from "@/components/ui/button";
import { formatMoney, money } from "@/lib/money";

export default async function HomePage() {
  const [{ profile, ordering, delivery }, catalog] = await Promise.all([getPublicProfile(), getPublicCatalog()]);
  const featured = catalog.products.filter((p) => p.isFeatured && p.isAvailable).slice(0, 6);
  const priceOf = (p: (typeof catalog.products)[number]) =>
    p.variants.length ? p.variants.reduce((m, v) => (money(v.price).lessThan(m) ? v.price : m), p.variants[0]!.price) : p.price;

  return (
    <main>
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(50% 60% at 85% 10%, color-mix(in oklch, var(--brand) 22%, transparent), transparent 70%), radial-gradient(40% 50% at 10% 90%, color-mix(in oklch, var(--warning) 18%, transparent), transparent 70%)",
          }}
        />
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 md:grid-cols-[1.1fr_1fr] md:py-20">
          <div className="animate-in fade-in slide-in-from-bottom-3 duration-700">
            <Suspense fallback={<span className="inline-block h-7 w-48 rounded-full bg-muted" />}>
              <StoreStatusPill />
            </Suspense>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">{profile.name}</h1>
            <p className="mt-4 max-w-lg text-lg text-muted-foreground">{profile.tagline || "Freshly made food, delivered hot."}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg" className="h-12 rounded-full bg-brand px-7 text-base text-brand-foreground hover:bg-brand/90">
                <Link href="/menu" data-testid="order-now">
                  Order now <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 rounded-full px-6 text-base">
                <Link href="/contact">Find us</Link>
              </Button>
            </div>
            <dl className="mt-10 flex flex-wrap gap-x-8 gap-y-3 text-sm">
              {ordering.deliveryEnabled && (
                <div className="flex items-center gap-2">
                  <Bike className="size-4 text-brand" />
                  <dt className="sr-only">Delivery</dt>
                  <dd>Delivery in ~{delivery.estimatedMinutes} min</dd>
                </div>
              )}
              {ordering.takeawayEnabled && (
                <div className="flex items-center gap-2">
                  <ShoppingBag className="size-4 text-brand" />
                  <dt className="sr-only">Takeaway</dt>
                  <dd>Takeaway ready in ~{ordering.defaultPrepMinutes} min</dd>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Clock className="size-4 text-brand" />
                <dt className="sr-only">Payment</dt>
                <dd>Cash on delivery</dd>
              </div>
            </dl>
          </div>
          {featured[0] && (
            <div className="relative hidden aspect-square md:block">
              <div className="absolute inset-6 rotate-3 rounded-[2.5rem] bg-brand/15" />
              <div className="absolute inset-6 -rotate-2 overflow-hidden rounded-[2.5rem] border bg-card shadow-2xl">
                {featured[0].imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- menu photo
                  <img src={featured[0].imageUrl} alt={featured[0].name} className="size-full object-cover" />
                ) : (
                  <div className="flex size-full flex-col items-center justify-center gap-4 p-10 text-center">
                    <ProductThumb name={featured[0].name} className="size-28 rounded-3xl text-4xl" />
                    <div className="text-2xl font-semibold">{featured[0].name}</div>
                    <div className="text-muted-foreground">{featured[0].description}</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {featured.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-8">
          <div className="mb-5 flex items-end justify-between">
            <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <Star className="size-5 fill-warning text-warning" /> Customer favourites
            </h2>
            <Link href="/menu" className="text-sm font-medium text-brand">
              Full menu →
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((p) => (
              <Link
                key={p.id}
                href={`/menu?item=${p.slug}`}
                className="group flex gap-4 rounded-2xl border bg-card p-4 transition hover:-translate-y-0.5 hover:shadow-lg"
              >
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- menu photo
                  <img src={p.imageUrl} alt="" className="size-20 shrink-0 rounded-xl object-cover" />
                ) : (
                  <ProductThumb name={p.name} className="size-20 rounded-xl text-xl" />
                )}
                <div className="min-w-0">
                  <div className="font-semibold group-hover:text-brand">{p.name}</div>
                  <p className="line-clamp-2 text-sm text-muted-foreground">{p.description}</p>
                  <div className="mt-1 text-sm font-medium tabular">
                    {p.variants.length ? "from " : ""}
                    {formatMoney(priceOf(p))}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mx-auto max-w-6xl px-4 py-8">
        <h2 className="mb-5 text-2xl font-semibold tracking-tight">Browse the menu</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {catalog.categories.map((c) => (
            <Link key={c.id} href={`/menu#${c.slug}`} className="flex flex-col items-center gap-3 rounded-2xl border bg-card p-5 text-center transition hover:border-brand/50 hover:bg-brand/5">
              <ProductThumb name={c.name} imageUrl={c.imageUrl} className="size-14 rounded-2xl text-lg" />
              <span className="font-medium">{c.name}</span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
