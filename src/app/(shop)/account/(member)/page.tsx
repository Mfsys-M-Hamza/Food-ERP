import type { Metadata } from "next";
import { Gift } from "lucide-react";
import { requireCustomer, getMyProfile } from "@/server/modules/storefront/account";
import { getSetting } from "@/server/modules/settings/service";
import { formatPhone } from "@/lib/phone";
import { formatMoney, money } from "@/lib/money";
import { ProfileForm } from "@/features/storefront/profile-form";
import { VerifyPhone } from "@/features/storefront/verify-phone";

export const metadata: Metadata = { title: "My account", robots: { index: false } };

export default async function AccountPage() {
  const session = await requireCustomer();
  const [c, loyalty] = await Promise.all([getMyProfile(session), getSetting("loyalty")]);
  return (
    <div className="space-y-6">
      {loyalty.enabled && (
        <div className="flex items-center gap-3 rounded-2xl bg-brand/10 p-4" data-testid="my-points">
          <Gift className="size-6 text-brand" />
          <div>
            <p className="font-semibold">{session.customer.loyaltyPoints} points</p>
            <p className="text-sm text-muted-foreground">
              Worth {formatMoney(money(loyalty.pointValue).times(session.customer.loyaltyPoints))}. You earn 1 point for every {formatMoney(loyalty.spendPerPoint)} spent.
            </p>
          </div>
        </div>
      )}
      {session.customer.phone && !session.customer.phoneVerifiedAt && <VerifyPhone phone={formatPhone(session.customer.phone)} />}
      <ProfileForm name={c.name} phone={formatPhone(c.phone)} marketingOptIn={c.marketingOptIn} />
    </div>
  );
}
