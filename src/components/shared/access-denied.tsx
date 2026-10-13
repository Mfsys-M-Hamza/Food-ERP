import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AccessDenied({ message }: { message?: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center" data-testid="access-denied">
      <span className="grid size-14 place-items-center rounded-2xl bg-destructive/10 text-destructive">
        <ShieldAlert className="size-7" />
      </span>
      <h1 className="mt-5 text-xl font-semibold tracking-tight">You don&apos;t have access to this page</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {message ?? "Your role does not include this area. Ask the owner if you need access."}
      </p>
      <Button asChild variant="outline" className="mt-6">
        <Link href="/staff">Go to my home screen</Link>
      </Button>
    </div>
  );
}
