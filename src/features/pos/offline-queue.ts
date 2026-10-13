"use client";

import { useEffect, useSyncExternalStore } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { toast } from "sonner";
import { placeOrderAction } from "@/server/modules/orders/actions";
import type { CreateOrderInput } from "@/server/modules/orders/schemas";

/**
 * Offline POS. When the connection drops, cash sales are saved on this device
 * (localStorage) with their request id, and sent to the server when the
 * connection returns. The server's idempotency key means a retried order is
 * never created twice. Card / online payments and coupons need a connection.
 */
export type QueuedOrder = { id: string; input: CreateOrderInput; total: string; queuedAt: string; error: string | null; attempts: number };

type QueueState = {
  items: QueuedOrder[];
  syncing: boolean;
  add: (input: CreateOrderInput, total: string) => void;
  remove: (id: string) => void;
  fail: (id: string, error: string) => void;
  setSyncing: (v: boolean) => void;
};

export const useOfflineQueue = create<QueueState>()(
  persist(
    (set) => ({
      items: [],
      syncing: false,
      add: (input, total) =>
        set((s) => ({ items: [...s.items, { id: input.clientRequestId, input, total, queuedAt: new Date().toISOString(), error: null, attempts: 0 }] })),
      remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
      fail: (id, error) => set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, error, attempts: i.attempts + 1 } : i)) })),
      setSyncing: (syncing) => set({ syncing }),
    }),
    { name: "ferp-pos-offline", storage: createJSONStorage(() => localStorage), partialize: (s) => ({ items: s.items }), version: 1 },
  ),
);

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

/** A thrown server-action call (as opposed to an error result) means the request never reached the server. */
export function isNetworkFailure(e: unknown): boolean {
  return (typeof navigator !== "undefined" && !navigator.onLine) || e instanceof TypeError || (e instanceof Error && /fetch|network|Failed to/i.test(e.message));
}

export async function syncOfflineOrders(): Promise<number> {
  const q = useOfflineQueue.getState();
  if (q.syncing || !navigator.onLine) return 0;
  const pending = q.items.filter((i) => !i.error);
  if (!pending.length) return 0;
  q.setSyncing(true);
  let synced = 0;
  try {
    for (const item of pending) {
      let r;
      try {
        r = await placeOrderAction(item.input);
      } catch {
        break; // still offline; try again later
      }
      if (r.ok) {
        useOfflineQueue.getState().remove(item.id);
        synced++;
        toast.success(`Offline sale synced as order #${r.data.displayNumber}`);
      } else {
        useOfflineQueue.getState().fail(item.id, r.error);
      }
    }
  } finally {
    useOfflineQueue.getState().setSyncing(false);
  }
  return synced;
}

/** Sync when the connection returns and every 20 s while orders wait. */
export function useOfflineSync(onSynced: () => void) {
  const online = useOnline();
  const waiting = useOfflineQueue((s) => s.items.filter((i) => !i.error).length);
  useEffect(() => {
    if (!online || waiting === 0) return;
    let alive = true;
    const run = () =>
      void syncOfflineOrders().then((n) => {
        if (alive && n > 0) onSynced();
      });
    const first = setTimeout(run, 500);
    const t = setInterval(run, 20_000);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(t);
    };
  }, [online, waiting, onSynced]);
}
