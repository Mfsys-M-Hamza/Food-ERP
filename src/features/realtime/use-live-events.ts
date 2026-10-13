"use client";

import { useEffect, useRef, useState } from "react";

export type LiveEvent = { id: string; type: string; data: Record<string, unknown> };

const TYPES = [
  "order.created",
  "order.status_changed",
  "order.paid",
  "order.cancelled",
  "order.refunded",
  "delivery.assigned",
  "menu.availability_changed",
];

/**
 * Subscribe to /api/v1/events (Server-Sent Events). Reconnects automatically.
 * `onEvent` is called for every event; returns whether the stream is live.
 */
export function useLiveEvents(onEvent: (e: LiveEvent) => void, enabled = true): boolean {
  const [live, setLive] = useState(false);
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return;
    const es = new EventSource("/api/v1/events");
    const listen = (type: string) => (msg: MessageEvent) => {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(msg.data);
      } catch {}
      handler.current({ id: msg.lastEventId, type, data });
    };
    const listeners = TYPES.map((t) => [t, listen(t)] as const);
    listeners.forEach(([t, fn]) => es.addEventListener(t, fn as EventListener));
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    return () => {
      listeners.forEach(([t, fn]) => es.removeEventListener(t, fn as EventListener));
      es.close();
    };
  }, [enabled]);

  return live;
}

/** Short "ding" via Web Audio (no audio file needed). Requires a prior user gesture. */
export function playChime(ctx: AudioContext | null) {
  if (!ctx) return;
  const now = ctx.currentTime;
  for (const [i, freq] of [880, 1320].entries()) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + i * 0.18);
    gain.gain.exponentialRampToValueAtTime(0.35, now + i * 0.18 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + i * 0.18);
    osc.stop(now + i * 0.18 + 0.4);
  }
}
