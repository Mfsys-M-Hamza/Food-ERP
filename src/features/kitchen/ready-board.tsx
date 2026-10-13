"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import { useLiveEvents } from "@/features/realtime/use-live-events";

export function ReadyBoard({ businessName }: { businessName: string }) {
  const qc = useQueryClient();
  const live = useLiveEvents(useCallback((e) => e.type.startsWith("order.") && qc.invalidateQueries({ queryKey: ["board"] }), [qc]));
  const board = useQuery({
    queryKey: ["board"],
    queryFn: () => apiGet<{ preparing: number[]; ready: number[] }>("/api/v1/kitchen/board"),
    refetchInterval: live ? 30_000 : 5_000,
  });
  return (
    <div className="flex h-svh flex-col bg-neutral-950 text-white">
      <header className="flex items-center justify-between px-10 py-6">
        <h1 className="text-3xl font-semibold tracking-tight">{businessName}</h1>
        <span className="text-lg text-white/60">Your order number is on your receipt</span>
      </header>
      <main className="grid flex-1 grid-cols-2 gap-6 px-10 pb-10">
        <section className="rounded-3xl bg-white/5 p-8">
          <h2 className="mb-6 text-2xl font-semibold uppercase tracking-widest text-amber-400">Preparing</h2>
          <div className="flex flex-wrap gap-4" data-testid="board-preparing">
            {board.data?.preparing.map((n) => (
              <span key={n} className="rounded-2xl bg-white/10 px-6 py-3 text-5xl font-bold tabular">
                {n}
              </span>
            ))}
          </div>
        </section>
        <section className="rounded-3xl bg-emerald-500/10 p-8 ring-2 ring-emerald-400/40">
          <h2 className="mb-6 text-2xl font-semibold uppercase tracking-widest text-emerald-400">Ready — please collect</h2>
          <div className="flex flex-wrap gap-4" data-testid="board-ready">
            {board.data?.ready.map((n) => (
              <span key={n} className="animate-in zoom-in-50 rounded-2xl bg-emerald-500 px-6 py-3 text-6xl font-bold text-emerald-950 tabular">
                {n}
              </span>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
