"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogIn, LogOut } from "lucide-react";
import { toast } from "sonner";
import { clockAction } from "@/server/modules/people/actions";
import { Button } from "@/components/ui/button";

export function ClockButton({ state }: { state: "OUT" | "IN" | "DONE" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (state === "DONE") return <p className="text-center text-sm text-muted-foreground">You have checked out for today.</p>;
  const action = state === "OUT" ? "IN" : "OUT";
  return (
    <Button
      size="lg"
      className="h-16 w-full text-lg"
      variant={action === "IN" ? "default" : "secondary"}
      disabled={pending}
      data-testid={action === "IN" ? "check-in" : "check-out"}
      onClick={() =>
        start(async () => {
          const r = await clockAction(action);
          if (r.ok) {
            const d = r.data as { lateMinutes?: number };
            toast.success(d.lateMinutes ? `${r.message}, ${d.lateMinutes} min late` : r.message);
            router.refresh();
          } else toast.error(r.error);
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : action === "IN" ? <LogIn /> : <LogOut />}
      {action === "IN" ? "Check in" : "Check out"}
    </Button>
  );
}
