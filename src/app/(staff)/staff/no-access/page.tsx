import { requireStaffPage } from "@/server/core/page-guard";
import { AccessDenied } from "@/components/shared/access-denied";
import { SignOutButton } from "@/components/shared/sign-out-button";

export const instant = false;

export default async function NoAccessPage() {
  await requireStaffPage();
  return (
    <main className="flex min-h-svh flex-col items-center justify-center p-6">
      <AccessDenied message="Your account has no screens assigned yet. Ask the owner to give you a role." />
      <SignOutButton />
    </main>
  );
}
