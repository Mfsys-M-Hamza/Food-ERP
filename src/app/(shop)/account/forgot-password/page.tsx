import { Suspense } from "react";
import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/features/storefront/auth-forms";

export const metadata: Metadata = { title: "Forgot password", robots: { index: false } };

export default function Page() {
  return (
    <main className="px-4">
      <Suspense>
        <ForgotPasswordForm />
      </Suspense>
    </main>
  );
}
