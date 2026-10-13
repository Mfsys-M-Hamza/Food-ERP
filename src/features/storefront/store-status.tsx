import { connection } from "next/server";
import { getStoreStatus } from "@/server/modules/storefront/store";
import { cn } from "@/lib/utils";

/** Live open / closed pill (request-time). Wrap in <Suspense>. */
export async function StoreStatusPill({ className }: { className?: string }) {
  await connection();
  const s = await getStoreStatus();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium",
        s.accepting ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
        className,
      )}
      data-testid="store-status"
    >
      <span className={cn("size-2 rounded-full", s.accepting ? "animate-pulse bg-success" : "bg-muted-foreground")} />
      {s.accepting ? "Open now · ordering online" : s.open ? "Online orders paused" : `Closed${s.nextOpening ? ` · ${s.nextOpening}` : ""}`}
    </span>
  );
}

/** Banner shown on menu/checkout when ordering is not possible. */
export async function StoreClosedBanner() {
  await connection();
  const s = await getStoreStatus();
  if (s.accepting) return null;
  return (
    <div className="border-b border-warning/40 bg-warning/15 px-4 py-3 text-center text-sm" role="status" data-testid="store-closed">
      {s.message} {s.nextOpening}
    </div>
  );
}
