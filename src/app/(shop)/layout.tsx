import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { Clock, MapPin, MessageCircle, Phone, UserRound, UtensilsCrossed } from "lucide-react";
import { getPublicProfile } from "@/server/modules/storefront/store";
import { CartButton, MobileCartBar } from "@/features/storefront/cart-button";
import { ServiceWorker } from "@/features/storefront/service-worker";
import { QueryProvider } from "@/components/shared/query-provider";

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

async function Footer() {
  const { profile, hours } = await getPublicProfile();
  const wa = profile.whatsapp.replace(/\D/g, "");
  return (
    <footer className="mt-16 border-t bg-card pb-24 md:pb-0">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-3">
        <div>
          <div className="text-lg font-semibold">{profile.name}</div>
          {profile.tagline && <p className="mt-1 text-sm text-muted-foreground">{profile.tagline}</p>}
          {(profile.address || profile.city) && (
            <p className="mt-3 flex gap-2 text-sm text-muted-foreground">
              <MapPin className="mt-0.5 size-4 shrink-0" />
              {[profile.address, profile.city].filter(Boolean).join(", ")}
            </p>
          )}
        </div>
        <div className="text-sm">
          <div className="mb-2 flex items-center gap-2 font-medium">
            <Clock className="size-4" /> Opening hours
          </div>
          <ul className="space-y-0.5 text-muted-foreground tabular">
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
        <div className="space-y-2 text-sm">
          {profile.phone && (
            <a href={`tel:${profile.phone.replace(/\s/g, "")}`} className="flex items-center gap-2 hover:text-brand">
              <Phone className="size-4" /> {profile.phone}
            </a>
          )}
          {wa && (
            <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-brand">
              <MessageCircle className="size-4" /> WhatsApp us
            </a>
          )}
          <Link href="/contact" className="block hover:text-brand">
            Contact & directions
          </Link>
          <Link href="/staff/login" className="block text-xs text-muted-foreground hover:text-foreground">
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
    <Link href="/" className="flex min-w-0 items-center gap-2.5" aria-label={`${profile.name} home`}>
      <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-xl bg-brand text-brand-foreground">
        {profile.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- owner logo
          <img src={profile.logoUrl} alt="" className="size-full object-cover" />
        ) : (
          <UtensilsCrossed className="size-4" />
        )}
      </span>
      <span className="truncate font-semibold tracking-tight">{profile.name}</span>
    </Link>
  );
}

export default function ShopLayout({ children }: LayoutProps<"/">) {
  return (
    <QueryProvider>
      <div className="flex min-h-svh flex-col">
        <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
            <Suspense fallback={<span className="h-9 w-40" />}>
              <Brand />
            </Suspense>
            <nav className="ml-auto flex items-center gap-1 sm:gap-2">
              <Link href="/menu" className="rounded-full px-3 py-2 text-sm font-medium hover:bg-muted">
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
