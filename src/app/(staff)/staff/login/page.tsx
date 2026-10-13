import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { UtensilsCrossed } from "lucide-react";
import { LoginForm } from "./login-form";
import { getSetting } from "@/server/modules/settings/service";

export const metadata: Metadata = { title: "Staff sign in", robots: { index: false } };

async function BrandName() {
  await connection();
  const name = await getSetting("business.profile")
    .then((p) => p.name)
    .catch(() => "Restaurant");
  return <>{name}</>
}

export default function StaffLoginPage() {
  return (
    <main className="grid min-h-svh lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-[oklch(0.2_0.02_45)] text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-90"
          style={{
            background:
              "radial-gradient(60% 50% at 20% 10%, oklch(0.64 0.19 41 / 0.55), transparent 70%), radial-gradient(50% 45% at 90% 90%, oklch(0.72 0.15 75 / 0.35), transparent 70%)",
          }}
        />
        <div className="relative flex items-center gap-3 text-lg font-semibold tracking-tight">
          <span className="grid size-10 place-items-center rounded-xl bg-white/10 ring-1 ring-white/20">
            <UtensilsCrossed className="size-5" />
          </span>
          <Suspense fallback={<span className="opacity-0">.</span>}>
            <BrandName />
          </Suspense>
        </div>
        <div className="relative max-w-md">
          <p className="text-4xl font-semibold leading-tight tracking-tight">
            Orders, kitchen, stock and staff — one place.
          </p>
          <p className="mt-4 text-base text-white/70">
            Sign in with the account your manager created for you.
          </p>
        </div>
        <p className="relative text-sm text-white/50">Staff access only</p>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <span className="grid size-11 place-items-center rounded-xl bg-brand text-brand-foreground">
              <UtensilsCrossed className="size-5" />
            </span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">Enter your e-mail and password to continue.</p>
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
