"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { apiGet } from "@/lib/api-client";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

type Item = { id: string; severity: "INFO" | "WARNING" | "CRITICAL"; title: string; body: string | null; link: string | null; read: boolean; createdAt: string };
type Data = { unread: number; items: Item[] };

const POLL_MS = 30_000;

/** Header bell: unread count, latest alerts, mark as read. Polls every 30 s (pauses in background tabs). */
export function NotificationBell() {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [now, setNow] = useState(0);
  const lastUnread = useRef(0);

  const load = useCallback(async () => {
    try {
      const d = await apiGet<Data>("/api/v1/notifications?limit=8");
      setData(d);
      setNow(Date.now());
      if (d.unread > lastUnread.current && d.items.some((i) => !i.read && i.severity === "CRITICAL") && typeof document !== "undefined" && document.title.indexOf("(") !== 0) {
        document.title = `(${d.unread}) ${document.title}`;
      }
      lastUnread.current = d.unread;
    } catch {
      // Offline or signed out: keep the last state.
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  async function mark(id: string | "all") {
    await fetch("/api/v1/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    document.title = document.title.replace(/^\(\d+\)\s*/, "");
    void load();
  }

  const unread = data?.unread ?? 0;
  return (
    <DropdownMenu onOpenChange={(o) => o && void load()}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} data-testid="notification-bell">
          <Bell />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-white tabular" data-testid="notification-count">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          Notifications
          {unread > 0 && (
            <button type="button" className="flex items-center gap-1 text-xs font-normal text-muted-foreground hover:text-foreground" onClick={() => void mark("all")}>
              <CheckCheck className="size-3.5" /> Mark all read
            </button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {(data?.items.length ?? 0) === 0 && <p className="px-2 py-6 text-center text-sm text-muted-foreground">You are all caught up.</p>}
        {data?.items.map((n) => (
          <DropdownMenuItem
            key={n.id}
            className="flex flex-col items-start gap-0.5 py-2"
            onSelect={() => {
              if (!n.read) void mark(n.id);
              if (n.link) router.push(n.link);
            }}
          >
            <span className={cn("flex w-full items-center gap-2 text-sm", !n.read && "font-medium")}>
              <span className={cn("size-2 shrink-0 rounded-full", n.read ? "bg-transparent" : n.severity === "CRITICAL" ? "bg-destructive" : n.severity === "WARNING" ? "bg-warning" : "bg-brand")} />
              <span className="flex-1">{n.title}</span>
            </span>
            {n.body && <span className="pl-4 text-xs text-muted-foreground">{n.body}</span>}
            <span className="pl-4 text-[11px] text-muted-foreground">{now ? timeAgo(n.createdAt, now) : ""}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/admin/notifications" className="justify-center text-sm">
            See all
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
