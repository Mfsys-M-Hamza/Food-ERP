"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { newRequestId } from "@/lib/api-client";

export type CartAddon = { id: string; name: string; price: string };
export type CartLine = {
  key: string;
  productId: string;
  variantId: string | null;
  name: string;
  variantName: string | null;
  unitPrice: string;
  addons: CartAddon[];
  removables: { id: string; label: string }[];
  quantity: number;
  note: string;
};
export type CartCustomer = { id: string | null; name: string; phone: string };
export type CartDelivery = { zoneId: string | null; addressLine: string; area: string; landmark: string; mapUrl: string };
export type CartDiscount = { type: "PERCENT" | "AMOUNT"; value: string; reason: string; overridePin?: string };
export type OrderTypeName = "TAKEAWAY" | "DELIVERY" | "DINE_IN";

type CartState = {
  requestId: string;
  source: "POS" | "PHONE";
  type: OrderTypeName;
  lines: CartLine[];
  customer: CartCustomer | null;
  delivery: CartDelivery | null;
  discount: CartDiscount | null;
  couponCode: string;
  redeemPoints: number;
  kitchenNote: string;
  tableLabel: string;
  terminalId: string | null;

  addLine: (line: Omit<CartLine, "key">) => void;
  updateLine: (key: string, patch: Partial<CartLine>) => void;
  removeLine: (key: string) => void;
  setQuantity: (key: string, quantity: number) => void;
  setType: (t: OrderTypeName) => void;
  setSource: (s: "POS" | "PHONE") => void;
  setCustomer: (c: CartCustomer | null) => void;
  setDelivery: (d: CartDelivery | null) => void;
  setDiscount: (d: CartDiscount | null) => void;
  setPromo: (p: { couponCode: string; redeemPoints: number }) => void;
  setKitchenNote: (n: string) => void;
  setTableLabel: (t: string) => void;
  setTerminal: (id: string | null) => void;
  clear: () => void;
  restore: (payload: Partial<CartState>) => void;
};

const sameConfig = (a: Omit<CartLine, "key" | "quantity">, b: Omit<CartLine, "key" | "quantity">) =>
  a.productId === b.productId &&
  a.variantId === b.variantId &&
  a.note === b.note &&
  a.addons.map((x) => x.id).sort().join() === b.addons.map((x) => x.id).sort().join() &&
  a.removables.map((x) => x.id).sort().join() === b.removables.map((x) => x.id).sort().join();

const empty = {
  source: "POS" as const,
  type: "TAKEAWAY" as OrderTypeName,
  lines: [] as CartLine[],
  customer: null,
  delivery: null,
  discount: null,
  couponCode: "",
  redeemPoints: 0,
  kitchenNote: "",
  tableLabel: "",
};

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      ...empty,
      requestId: newRequestId(),
      terminalId: null,
      addLine: (line) =>
        set((s) => {
          const existing = s.lines.find((l) => sameConfig(l, line));
          if (existing) {
            return { lines: s.lines.map((l) => (l.key === existing.key ? { ...l, quantity: Math.min(99, l.quantity + line.quantity) } : l)) };
          }
          return { lines: [...s.lines, { ...line, key: newRequestId() }] };
        }),
      updateLine: (key, patch) => set((s) => ({ lines: s.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) })),
      removeLine: (key) => set((s) => ({ lines: s.lines.filter((l) => l.key !== key) })),
      setQuantity: (key, quantity) =>
        set((s) => ({
          lines: quantity <= 0 ? s.lines.filter((l) => l.key !== key) : s.lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(99, quantity) } : l)),
        })),
      setType: (type) => set((s) => ({ type, delivery: type === "DELIVERY" ? s.delivery : null })),
      setSource: (source) => set({ source }),
      // Points belong to a customer: changing the customer drops them.
      setCustomer: (customer) => set((s) => ({ customer, redeemPoints: customer?.id && customer.id === s.customer?.id ? s.redeemPoints : 0 })),
      setDelivery: (delivery) => set({ delivery }),
      setDiscount: (discount) => set({ discount }),
      setPromo: ({ couponCode, redeemPoints }) => set({ couponCode, redeemPoints }),
      setKitchenNote: (kitchenNote) => set({ kitchenNote }),
      setTableLabel: (tableLabel) => set({ tableLabel }),
      setTerminal: (terminalId) => set({ terminalId }),
      clear: () => set({ ...empty, requestId: newRequestId() }),
      restore: (payload) => set({ ...empty, ...payload, requestId: newRequestId() }),
    }),
    { name: "ferp-pos-cart", storage: createJSONStorage(() => localStorage), version: 1 },
  ),
);

/** The part of the cart saved when an order is held. */
export function cartSnapshot(s: CartState) {
  return {
    source: s.source,
    type: s.type,
    lines: s.lines,
    customer: s.customer,
    delivery: s.delivery,
    discount: s.discount ? { ...s.discount, overridePin: undefined } : null,
    couponCode: s.couponCode,
    redeemPoints: s.redeemPoints,
    kitchenNote: s.kitchenNote,
    tableLabel: s.tableLabel,
  };
}
