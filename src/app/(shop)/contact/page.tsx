import type { Metadata } from "next";
import { Clock, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import { getPublicProfile } from "@/server/modules/storefront/store";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Contact" };
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function ContactPage() {
  const { profile, hours } = await getPublicProfile();
  const wa = profile.whatsapp.replace(/\D/g, "");
  const address = [profile.address, profile.city].filter(Boolean).join(", ");
  const map = profile.mapUrl || (address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${profile.name} ${address}`)}` : "");
  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Contact us</h1>
      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <section className="space-y-4 rounded-2xl border bg-card p-6">
          {address && (
            <p className="flex gap-3">
              <MapPin className="mt-0.5 size-5 shrink-0 text-brand" /> {address}
            </p>
          )}
          {profile.phone && (
            <p className="flex gap-3">
              <Phone className="mt-0.5 size-5 shrink-0 text-brand" /> {profile.phone}
            </p>
          )}
          {profile.email && (
            <p className="flex gap-3">
              <Mail className="mt-0.5 size-5 shrink-0 text-brand" /> {profile.email}
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-2">
            {profile.phone && (
              <Button asChild variant="outline" className="rounded-full">
                <a href={`tel:${profile.phone.replace(/\s/g, "")}`}>
                  <Phone /> Call
                </a>
              </Button>
            )}
            {wa && (
              <Button asChild className="rounded-full bg-[#25D366] text-white hover:bg-[#1fb857]">
                <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer">
                  <MessageCircle /> WhatsApp
                </a>
              </Button>
            )}
            {map && (
              <Button asChild variant="outline" className="rounded-full">
                <a href={map} target="_blank" rel="noopener noreferrer">
                  <MapPin /> Directions
                </a>
              </Button>
            )}
          </div>
        </section>
        <section className="rounded-2xl border bg-card p-6">
          <h2 className="mb-3 flex items-center gap-2 font-semibold">
            <Clock className="size-5 text-brand" /> Opening hours
          </h2>
          <ul className="space-y-1 text-sm tabular">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => {
              const h = hours.find((x) => x.weekday === d)!;
              return (
                <li key={d} className="flex justify-between">
                  <span>{DAYS[d]}</span>
                  <span className="text-muted-foreground">{h.isClosed ? "Closed" : `${h.opensAt} – ${h.closesAt}`}</span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </main>
  );
}
