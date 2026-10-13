import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { Clock, MapPin, MessageCircle, Phone, UserRound, UtensilsCrossed } from "lucide-react";
import { getPublicProfile } from "@/server/modules/storefront/store";
import { CartButton, MobileCartBar } from "@/features/storefront/cart-button";
import { ServiceWorker } from "@/features/storefront/service-worker";
import { ShopTheme } from "@/features/storefront/shop-theme";
import { QueryProvider } from "@/components/shared/query-provider";
import { contrastText } from "@/lib/color";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const { profile } = await getPublicProfile();
  return {
    title: { default: `${profile.name} — order online`, template: `%s · ${profile.name}` },
    description: profile.tagline || `Order online from ${profile.name}.`,
    applicationName: profile.name,
    icons: { icon: "/pwa-icon/192", apple: "/pwa-icon/180" },
    appleWebApp: { capable: true, title: profile.name, statusBarStyle: "default" },
  };
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function Instagram(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
    </svg>
  );
}
function Facebook(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M14 8.5V6.8c0-.8.5-1 .9-1H17V2.1L14.1 2C10.9 2 10.2 4.4 10.2 5.9v2.6H8v3.8h2.2V22H14v-9.7h2.9l.4-3.8H14Z" />
    </svg>
  );
}

async function Footer() {
  const { profile, hours, website } = await getPublicProfile();
  const wa = profile.whatsapp.replace(/\D/g, "");
  return (
    <footer className="mt-20 border-t bg-card pb-24 md:pb-0">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-1">
          <div className="flex items-center gap-3">
            {profile.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- owner logo
              <img src={profile.logoUrl} alt="" className="size-12 rounded-full bg-white object-contain" />
            ) : null}
            <div className="text-lg font-bold tracking-tight">{profile.name}</div>
          </div>
          {profile.tagline && <p className="mt-3 text-sm text-muted-foreground">{profile.tagline}</p>}
          {(website.instagramUrl || website.facebookUrl) && (
            <div className="mt-4 flex gap-2">
              {website.facebookUrl && (
                <a href={website.facebookUrl} target="_blank" rel="noopener noreferrer" aria-label="Facebook" className="grid size-10 place-items-center rounded-full border hover:border-brand hover:text-brand">
                  <Facebook className="size-4" />
                </a>
              )}
              {website.instagramUrl && (
                <a href={website.instagramUrl} target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="grid size-10 place-items-center rounded-full border hover:border-brand hover:text-brand">
                  <Instagram className="size-4" />
                </a>
              )}
            </div>
          )}
        </div>
        <div className="text-sm">
          <div className="mb-3 text-xs font-bold uppercase tracking-widest text-brand">Visit us</div>
          {(profile.address || profile.city) && (
            <p className="flex gap-2 text-muted-foreground">
              <MapPin className="mt-0.5 size-4 shrink-0" />
              {[profile.address, profile.city].filter(Boolean).join(", ")}
            </p>
          )}
          <Link href="/contact" className="mt-3 inline-block font-medium hover:text-brand">
            Directions →
          </Link>
        </div>
        <div className="text-sm">
          <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-brand">
            <Clock className="size-3.5" /> Opening hours
          </div>
          <ul className="space-y-1 text-muted-foreground tabular">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => {
              const h = hours.find((x) => x.weekday === d)!;
              return (
                <li key={d} className="flex max-w-56 justify-between">
                  <span>{DAYS[d]}</span>
                  <span>{h.isClosed ? "Closed" : `${h.opensAt} – ${h.closesAt}`}</span>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="space-y-3 text-sm">
          <div className="mb-3 text-xs font-bold uppercase tracking-widest text-brand">Order by phone</div>
          {profile.phone && (
            <a href={`tel:${profile.phone.replace(/\s/g, "")}`} className="flex items-center gap-2 text-base font-semibold hover:text-brand">
              <Phone className="size-4" /> {profile.phone}
            </a>
          )}
          {wa && (
            <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-brand">
              <MessageCircle className="size-4" /> WhatsApp us
            </a>
          )}
          <Link href="/account" className="block hover:text-brand">
            My account & orders
          </Link>
        </div>
      </div>
      <div className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground">
          <span>
            © {profile.name}. Prices include all charges shown at checkout.
          </span>
          <Link href="/staff/login" className="hover:text-foreground">
            Staff sign in
          </Link>
        </div>
      </div>
    </footer>
  );
}

async function Brand() {
  const { profile } = await getPublicProfile();
  return (
    <Link href="/" className="flex min-w-0 items-center gap-3" aria-label={`${profile.name} home`}>
      {profile.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- owner logo
        <img src={profile.logoUrl} alt="" className="size-11 shrink-0 rounded-full bg-white object-contain ring-2 ring-brand/60" />
      ) : (
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand text-brand-foreground">
          <UtensilsCrossed className="size-5" />
        </span>
      )}
      <span className="truncate text-lg font-extrabold uppercase tracking-tight">{profile.name}</span>
    </Link>
  );
}

async function Announcement() {
  const { website } = await getPublicProfile();
  if (!website.announcement) return null;
  return (
    <div className="bg-brand px-4 py-2 text-center text-xs font-semibold uppercase tracking-wider text-brand-foreground sm:text-sm" data-testid="announcement">
      {website.announcement}
    </div>
  );
}

async function HeaderPhone() {
  const { profile } = await getPublicProfile();
  if (!profile.phone) return null;
  return (
    <a href={`tel:${profile.phone.replace(/\s/g, "")}`} className="hidden items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold hover:border-brand hover:text-brand lg:flex">
      <Phone className="size-4" /> {profile.phone}
    </a>
  );
}

export default async function ShopLayout({ children }: LayoutProps<"/">) {
  const { website } = await getPublicProfile();
  const dark = website.theme === "dark";
  const brand = website.brandColor || null;
  const brandForeground = brand ? contrastText(brand) : null;
  const style = brand ? ({ "--brand": brand, "--brand-foreground": brandForeground } as React.CSSProperties) : undefined;

  return (
    <QueryProvider>
      <div className={cn("flex min-h-svh flex-col bg-background text-foreground", dark && "dark")} style={style} data-shop-theme={website.theme}>
        <ShopTheme dark={dark} brand={brand} brandForeground={brandForeground} />
        <Suspense>
          <Announcement />
        </Suspense>
        <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
          <div className="mx-auto flex h-[4.5rem] max-w-6xl items-center gap-3 px-4">
            <Suspense fallback={<span className="h-10 w-44" />}>
              <Brand />
            </Suspense>
            <nav className="ml-auto flex items-center gap-1 sm:gap-2">
              <Link href="/menu" className="hidden rounded-full px-4 py-2 text-sm font-semibold uppercase tracking-wide hover:text-brand sm:block">
                Menu
              </Link>
              <Link href="/menu#deals" className="hidden rounded-full px-4 py-2 text-sm font-semibold uppercase tracking-wide hover:text-brand md:block">
                Deals
              </Link>
              <Suspense>
                <HeaderPhone />
              </Suspense>
              <Link href="/menu" className="rounded-full px-3 py-2 text-sm font-semibold sm:hidden">
                Menu
              </Link>
              <Link href="/account" className="grid size-10 place-items-center rounded-full hover:bg-muted" aria-label="My account">
                <UserRound className="size-5" />
              </Link>
              <CartButton />
            </nav>
          </div>
        </header>
        <div className="flex-1">{children}</div>
        <Suspense>
          <Footer />
        </Suspense>
        <MobileCartBar />
        <ServiceWorker />
      </div>
    </QueryProvider>
  );
}
