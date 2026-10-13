import { Decimal, money } from "@/lib/money";

/**
 * Ingredient units. Stock is kept in a base unit (g, ml, piece); people buy
 * and count in friendlier units (kg, litre, box of 24 …).
 */
export type BaseUnit = "g" | "ml" | "piece";
export type UnitOption = { unit: string; factor: string };

const GENERIC: Record<BaseUnit, UnitOption[]> = {
  g: [
    { unit: "g", factor: "1" },
    { unit: "kg", factor: "1000" },
  ],
  ml: [
    { unit: "ml", factor: "1" },
    { unit: "l", factor: "1000" },
  ],
  piece: [
    { unit: "piece", factor: "1" },
    { unit: "dozen", factor: "12" },
  ],
};

export const BASE_UNIT_LABEL: Record<BaseUnit, string> = { g: "grams (g)", ml: "millilitres (ml)", piece: "pieces" };

/** All units an ingredient can be entered in: generic ones plus its custom units. */
export function unitOptions(base: BaseUnit, custom: UnitOption[] = []): UnitOption[] {
  const out = [...GENERIC[base]];
  for (const c of custom) if (!out.some((o) => o.unit === c.unit)) out.push(c);
  return out;
}

export function toBase(quantity: Decimal.Value, unit: string, options: UnitOption[]): Decimal {
  const opt = options.find((o) => o.unit === unit);
  if (!opt) throw new Error(`Unknown unit "${unit}"`);
  return money(quantity).times(opt.factor);
}

/** Human display of a base quantity: 1500 g → "1.5 kg", 750 ml → "750 ml". */
export function formatQty(baseQty: Decimal.Value, base: BaseUnit): string {
  const q = money(baseQty);
  const abs = q.abs();
  const fmt = (d: Decimal) => {
    const s = d.toDecimalPlaces(2).toString();
    return s.replace(/\.0+$/, "");
  };
  if (base === "g" && abs.greaterThanOrEqualTo(1000)) return `${fmt(q.dividedBy(1000))} kg`;
  if (base === "ml" && abs.greaterThanOrEqualTo(1000)) return `${fmt(q.dividedBy(1000))} l`;
  return `${fmt(q)} ${base === "piece" ? (abs.equals(1) ? "pc" : "pcs") : base}`;
}
