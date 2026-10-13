"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      data-testid="sign-out"
      onClick={async () => {
        await authClient.signOut();
        router.replace("/staff/login");
        router.refresh();
      }}
    >
      <LogOut />
      Sign out
    </Button>
  );
}
