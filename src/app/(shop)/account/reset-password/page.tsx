import { Suspense } from "react";
import type { Metadata } from "next";
import { ResetPasswordForm } from "@/features/storefront/auth-forms";

export const metadata: Metadata = { title: "Reset password", robots: { index: false } };

export default function Page() {
  return (
    <main className="px-4">
      <Suspense>
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
