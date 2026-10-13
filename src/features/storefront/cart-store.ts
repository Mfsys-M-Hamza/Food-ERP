"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { newRequestId } from "@/lib/api-client";
import type { CartLine } from "@/features/pos/store";
import { money } from "@/lib/money";

type ShopCart = {
  requestId: string;
  lines: CartLine[];
  type: "DELIVERY" | "TAKEAWAY";
  zoneId: string | null;
  add: (line: Omit<CartLine, "key">) => void;
  replace: (key: string, line: Omit<CartLine, "key">) => void;
  setQuantity: (key: string, q: number) => void;
  setType: (t: "DELIVERY" | "TAKEAWAY") => void;
  setZone: (id: string | null) => void;
  clear: () => void;
};

const same = (a: Omit<CartLine, "key" | "quantity">, b: Omit<CartLine, "key" | "quantity">) =>
  a.productId === b.productId &&
  a.variantId === b.variantId &&
  a.note === b.note &&
  a.addons.map((x) => x.id).sort().join() === b.addons.map((x) => x.id).sort().join() &&
  a.removables.map((x) => x.id).sort().join() === b.removables.map((x) => x.id).sort().join();

export const useShopCart = create<ShopCart>()(
  persist(
    (set) => ({
      requestId: newRequestId(),
      lines: [],
      type: "DELIVERY",
      zoneId: null,
      add: (line) =>
        set((s) => {
          const hit = s.lines.find((l) => same(l, line));
          if (hit) return { lines: s.lines.map((l) => (l.key === hit.key ? { ...l, quantity: Math.min(30, l.quantity + line.quantity) } : l)) };
          return { lines: [...s.lines, { ...line, key: newRequestId() }] };
        }),
      replace: (key, line) => set((s) => ({ lines: s.lines.map((l) => (l.key === key ? { ...line, key } : l)) })),
      setQuantity: (key, q) =>
        set((s) => ({ lines: q <= 0 ? s.lines.filter((l) => l.key !== key) : s.lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(30, q) } : l)) })),
      setType: (type) => set({ type }),
      setZone: (zoneId) => set({ zoneId }),
      clear: () => set({ lines: [], requestId: newRequestId() }),
    }),
    { name: "ferp-shop-cart", storage: createJSONStorage(() => localStorage), version: 1 },
  ),
);

export function lineUnit(l: CartLine) {
  return money(l.unitPrice).plus(l.addons.reduce((s, a) => s.plus(a.price), money(0)));
}

export function cartSubtotal(lines: CartLine[]) {
  return lines.reduce((s, l) => s.plus(lineUnit(l).times(l.quantity)), money(0));
}

export function toOrderItems(lines: CartLine[]) {
  return lines.map((l) => ({
    productId: l.productId,
    variantId: l.variantId,
    quantity: l.quantity,
    addonIds: l.addons.map((a) => a.id),
    removableIds: l.removables.map((r) => r.id),
    note: l.note,
  }));
}
