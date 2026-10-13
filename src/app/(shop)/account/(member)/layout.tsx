import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext } from "@/server/core/context";
import { getCustomerSession } from "@/server/modules/storefront/account";
import { AccountNav, AccountSignOut } from "@/features/storefront/account-nav";
import { Button } from "@/components/ui/button";

export const instant = false;

export default async function MemberLayout({ children }: LayoutProps<"/account">) {
  const session = await getCustomerSession();
  if (!session) {
    const ctx = await getContext();
    if (ctx?.user.kind === "STAFF") {
      return (
        <main className="mx-auto max-w-md px-4 py-16 text-center">
          <h1 className="text-xl font-semibold">You are signed in with a staff account</h1>
          <p className="mt-2 text-muted-foreground">Customer accounts are separate. Sign out to use a customer account.</p>
          <div className="mt-6 flex justify-center gap-2">
            <Button asChild variant="outline">
              <Link href="/staff">Go to staff screens</Link>
            </Button>
            <AccountSignOut />
          </div>
        </main>
      );
    }
    redirect("/account/login?next=/account");
  }
  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Hi, {session.customer.name.split(" ")[0]}</h1>
          <p className="text-sm text-muted-foreground">{session.customer.email}</p>
        </div>
        <AccountSignOut />
      </div>
      <AccountNav />
      <div className="mt-6">{children}</div>
    </main>
  );
}
