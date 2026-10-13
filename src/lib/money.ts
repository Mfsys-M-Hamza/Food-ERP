import Decimal from "decimal.js";

/**
 * Money helpers. All money arithmetic goes through Decimal; JavaScript numbers
 * are never used for money. Values cross the wire as strings ("1250.00").
 */
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };
export type MoneyInput = Decimal.Value | { toString(): string };

export function money(value: MoneyInput | null | undefined): Decimal {
  if (value === null || value === undefined || value === "") return new Decimal(0);
  return new Decimal(typeof value === "object" && !(value instanceof Decimal) ? value.toString() : (value as Decimal.Value));
}

/** Round to 2 decimal places (half-up), the storage precision for money. */
export function round2(value: MoneyInput): Decimal {
  return money(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function sum(values: MoneyInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(money(v)), new Decimal(0));
}

/** Percentage of an amount, rounded to 2dp. `percent` 16 = 16%. */
export function percentOf(amount: MoneyInput, percent: MoneyInput): Decimal {
  return round2(money(amount).times(money(percent)).dividedBy(100));
}

/**
 * Round a cash total to the nearest `step` (e.g. 5 or 10 rupees).
 * Returns the rounded total and the adjustment line (can be negative).
 */
export function roundCash(total: MoneyInput, step: number): { total: Decimal; adjustment: Decimal } {
  const t = money(total);
  if (!step || step <= 0) return { total: round2(t), adjustment: new Decimal(0) };
  const rounded = t.dividedBy(step).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).times(step);
  return { total: round2(rounded), adjustment: round2(rounded.minus(t)) };
}

/** Serialise for JSON/API (always 2dp string). */
export function toMoneyString(value: MoneyInput): string {
  return round2(value).toFixed(2);
}

/** Display formatting, e.g. "Rs 1,250" (decimals shown only when non-zero). */
export function formatMoney(value: MoneyInput, opts: { symbol?: string; decimals?: "auto" | 0 | 2 } = {}): string {
  const d = round2(value);
  const symbol = opts.symbol ?? "Rs";
  const decimals = opts.decimals ?? "auto";
  const places = decimals === "auto" ? (d.isInteger() ? 0 : 2) : decimals;
  const [intPart, frac] = d.abs().toFixed(places).split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = d.isNegative() ? "-" : "";
  return `${sign}${symbol} ${grouped}${frac ? "." + frac : ""}`;
}
