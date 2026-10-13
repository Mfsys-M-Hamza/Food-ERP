import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { Metadata } from "next";
import { getTracking } from "@/server/modules/storefront/checkout";
import { getPublicProfile } from "@/server/modules/storefront/store";
import { TrackingView } from "@/features/storefront/tracking-view";

export const instant = false;
export const metadata: Metadata = { title: "Track your order", robots: { index: false } };

async function Tracker({ params, searchParams }: { params: PageProps<"/order/[token]">["params"]; searchParams: PageProps<"/order/[token]">["searchParams"] }) {
  await connection();
  const { token } = await params;
  const sp = await searchParams;
  const [t, { profile }] = await Promise.all([getTracking(token), getPublicProfile()]);
  if (!t) notFound();
  return (
    <TrackingView
      token={token}
      initial={JSON.parse(JSON.stringify(t))}
      isNew={sp.new === "1"}
      phone={profile.phone}
      whatsapp={profile.whatsapp.replace(/\D/g, "")}
    />
  );
}

export default function TrackPage(props: PageProps<"/order/[token]">) {
  return (
    <main className="px-4 py-8">
      <Tracker params={props.params} searchParams={props.searchParams} />
    </main>
  );
}
