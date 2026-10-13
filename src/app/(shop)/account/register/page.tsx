import { Suspense } from "react";
import type { Metadata } from "next";
import { RegisterForm } from "@/features/storefront/auth-forms";

export const metadata: Metadata = { title: "Create account", robots: { index: false } };

export default function Page() {
  return (
    <main className="px-4">
      <Suspense>
        <RegisterForm />
      </Suspense>
    </main>
  );
}
