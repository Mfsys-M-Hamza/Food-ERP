import Link from "next/link";
import { Construction } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SignOutButton } from "./sign-out-button";

/** Temporary screen for operational apps that arrive in later phases. */
export function OpsPlaceholder({
  title,
  phase,
  description,
  userName,
  showAdminLink,
}: {
  title: string;
  phase: number;
  description: string;
  userName: string;
  showAdminLink: boolean;
}) {
  return (
    <main className="flex min-h-svh flex-col">
      <header className="flex h-14 items-center justify-between border-b px-4">
        <span className="font-semibold">{title}</span>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="hidden sm:inline">{userName}</span>
          <SignOutButton />
        </div>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center" data-testid="ops-placeholder">
        <span className="grid size-14 place-items-center rounded-2xl bg-brand/10 text-brand">
          <Construction className="size-7" />
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">{title} arrives in Phase {phase}</h1>
        <p className="mt-2 max-w-md text-muted-foreground">{description}</p>
        {showAdminLink && (
          <Button asChild variant="outline" className="mt-6">
            <Link href="/admin">Back to admin</Link>
          </Button>
        )}
      </div>
    </main>
  );
}
