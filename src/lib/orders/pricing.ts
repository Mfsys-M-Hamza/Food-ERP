import { Decimal, money, round2, roundCash, toMoneyString, type MoneyInput } from "@/lib/money";

/**
 * Order pricing engine. Pure and shared: the POS uses it to show totals and the
 * server re-runs it on every order (client totals are never trusted).
 *
 * Order of calculation:
 *   subtotal            = Σ (unit price + add-ons) × quantity
 *   − discount          (percent of subtotal, or fixed amount capped at subtotal)
 *   + service charge    (% of discounted subtotal; dine-in only)
 *   = taxable base
 *   + tax               (exclusive) — or extracted from the base when prices include tax
 *   + delivery charge   (not taxed)
 *   ± cash rounding     (only when settling in cash)
 *   = grand total
 */
export type PriceLineInput = { unitPrice: MoneyInput; addonsUnitTotal: MoneyInput; quantity: number };

export type DiscountInput = { type: "PERCENT" | "AMOUNT"; value: MoneyInput } | null | undefined;

export type PricingInput = {
  lines: PriceLineInput[];
  discount?: DiscountInput;
  serviceChargePercent?: number;
  deliveryCharge?: MoneyInput;
  tax?: { enabled: boolean; rate: number; inclusive: boolean };
  cashRoundingStep?: number;
};

export type PricingResult = {
  lineTotals: string[];
  subtotal: string;
  discount: string;
  discountPercent: number;
  serviceCharge: string;
  taxableBase: string;
  tax: string;
  taxRate: number;
  deliveryCharge: string;
  rounding: string;
  grandTotal: string;
};

export function priceOrder(input: PricingInput): PricingResult {
  const lineTotals = input.lines.map((l) =>
    round2(money(l.unitPrice).plus(money(l.addonsUnitTotal)).times(Math.max(0, Math.trunc(l.quantity)))),
  );
  const subtotal = lineTotals.reduce((a, b) => a.plus(b), new Decimal(0));

  let discount = new Decimal(0);
  if (input.discount && subtotal.greaterThan(0)) {
    const v = money(input.discount.value);
    if (v.greaterThan(0)) {
      discount =
        input.discount.type === "PERCENT"
          ? round2(subtotal.times(Decimal.min(v, 100)).dividedBy(100))
          : Decimal.min(round2(v), subtotal);
    }
  }
  const afterDiscount = subtotal.minus(discount);
  const serviceCharge =
    input.serviceChargePercent && input.serviceChargePercent > 0
      ? round2(afterDiscount.times(input.serviceChargePercent).dividedBy(100))
      : new Decimal(0);
  const base = afterDiscount.plus(serviceCharge);

  let tax = new Decimal(0);
  let totalBeforeDelivery = base;
  const rate = input.tax?.enabled ? input.tax.rate : 0;
  if (rate > 0) {
    if (input.tax!.inclusive) {
      tax = round2(base.minus(base.dividedBy(new Decimal(1).plus(new Decimal(rate).dividedBy(100)))));
    } else {
      tax = round2(base.times(rate).dividedBy(100));
      totalBeforeDelivery = base.plus(tax);
    }
  }

  const delivery = round2(money(input.deliveryCharge ?? 0));
  const beforeRounding = totalBeforeDelivery.plus(delivery);
  const { total, adjustment } = roundCash(beforeRounding, input.cashRoundingStep ?? 0);

  return {
    lineTotals: lineTotals.map(toMoneyString),
    subtotal: toMoneyString(subtotal),
    discount: toMoneyString(discount),
    discountPercent: subtotal.isZero() ? 0 : discount.dividedBy(subtotal).times(100).toDecimalPlaces(2).toNumber(),
    serviceCharge: toMoneyString(serviceCharge),
    taxableBase: toMoneyString(base),
    tax: toMoneyString(tax),
    taxRate: rate,
    deliveryCharge: toMoneyString(delivery),
    rounding: toMoneyString(adjustment),
    grandTotal: toMoneyString(total),
  };
}

/** Tax rate for the way the customer pays (card/online may have a lower provincial rate). */
export function taxRateFor(
  methods: ("CASH" | "CARD" | "ONLINE" | "WALLET" | "LOYALTY")[],
  finance: { taxEnabled: boolean; taxRateCash: number; taxRateCard: number },
): number {
  if (!finance.taxEnabled) return 0;
  const nonCash = methods.length > 0 && methods.every((m) => m === "CARD" || m === "ONLINE" || m === "WALLET");
  return nonCash ? finance.taxRateCard : finance.taxRateCash;
}

/** Change to give back for a cash payment. Never negative. */
export function changeDue(amount: MoneyInput, tendered: MoneyInput): string {
  const c = money(tendered).minus(money(amount));
  return toMoneyString(c.isNegative() ? 0 : c);
}

/** Delivery charge for a zone / default settings, honouring "free above". */
export function deliveryChargeFor(
  subtotalAfterDiscount: MoneyInput,
  zone: { charge: MoneyInput; freeAbove?: MoneyInput | null } | null,
  defaults: { defaultCharge: MoneyInput; freeDeliveryAbove: MoneyInput | "" },
): string {
  const charge = zone ? money(zone.charge) : money(defaults.defaultCharge);
  const freeAbove = zone ? zone.freeAbove : defaults.freeDeliveryAbove;
  if (freeAbove !== null && freeAbove !== undefined && freeAbove !== "" && money(subtotalAfterDiscount).greaterThanOrEqualTo(money(freeAbove))) {
    return "0.00";
  }
  return toMoneyString(charge);
}
