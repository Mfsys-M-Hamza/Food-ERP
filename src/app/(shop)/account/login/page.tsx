import { Suspense } from "react";
import type { Metadata } from "next";
import { CustomerLoginForm } from "@/features/storefront/auth-forms";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default function Page() {
  return (
    <main className="px-4">
      <Suspense>
        <CustomerLoginForm />
      </Suspense>
    </main>
  );
}
