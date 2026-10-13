import { z } from "zod";

/**
 * Business settings registry. Each key is stored as one JSON row in `settings`
 * and validated with its Zod schema on read and write. Defaults are used for
 * keys that have not been saved yet, so nothing about the restaurant is
 * hard-coded in components.
 *
 * Pure data + Zod: safe on client (form validation) and server.
 */

const moneyString = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, "Enter an amount like 150 or 150.50");
const optionalMoney = z.union([moneyString, z.literal("")]).default("");
const percent = z.coerce.number().min(0, "Cannot be negative").max(100, "Cannot exceed 100");
const optionalText = (max = 200) => z.string().trim().max(max).default("");
const phone = z
  .string()
  .trim()
  .max(20)
  .regex(/^[+0-9 ()-]*$/, "Use digits, spaces, + ( ) - only")
  .default("");

export const settingsSchemas = {
  "business.profile": z.object({
    name: z.string().trim().min(2, "Restaurant name is required").max(80),
    tagline: optionalText(120),
    logoUrl: optionalText(500),
    address: optionalText(300),
    city: optionalText(80),
    phone,
    whatsapp: phone,
    email: z.union([z.email("Enter a valid e-mail"), z.literal("")]).default(""),
    website: optionalText(200),
    mapUrl: optionalText(500),
    taxNumber: optionalText(40),
  }),

  finance: z.object({
    currencyCode: z.string().trim().length(3).default("PKR"),
    currencySymbol: z.string().trim().min(1).max(5).default("Rs"),
    taxEnabled: z.boolean().default(false),
    taxLabel: z.string().trim().min(1).max(20).default("Sales Tax"),
    taxRateCash: percent.default(0),
    taxRateCard: percent.default(0),
    pricesIncludeTax: z.boolean().default(false),
    serviceChargeEnabled: z.boolean().default(false),
    serviceChargePercent: percent.default(0),
    cashRoundingStep: z.coerce.number().int().refine((v) => [0, 1, 5, 10].includes(v), "Choose 0, 1, 5 or 10").default(0),
  }),

  ordering: z.object({
    onlineOrderingEnabled: z.boolean().default(true),
    takeawayEnabled: z.boolean().default(true),
    deliveryEnabled: z.boolean().default(true),
    dineInEnabled: z.boolean().default(false),
    autoAcceptOnlineOrders: z.boolean().default(false),
    defaultPrepMinutes: z.coerce.number().int().min(1).max(240).default(20),
    unacceptedAlertMinutes: z.coerce.number().int().min(1).max(60).default(5),
    splitPaymentEnabled: z.boolean().default(false),
    dayCutoffHour: z.coerce.number().int().min(0).max(11).default(5),
    /** ISO time until which online ordering is paused (set from the POS). Empty = not paused. */
    onlinePausedUntil: z.string().max(40).default(""),
  }),

  delivery: z.object({
    defaultCharge: moneyString.default("150"),
    minimumOrder: moneyString.default("500"),
    freeDeliveryAbove: optionalMoney,
    estimatedMinutes: z.coerce.number().int().min(5).max(240).default(45),
  }),

  pos: z.object({
    cashierMaxDiscountPercent: percent.default(10),
    largeRefundThreshold: moneyString.default("2000"),
    cashDiscrepancyTolerance: moneyString.default("100"),
    autoPrintReceipt: z.boolean().default(true),
    autoPrintKitchenTicket: z.boolean().default(false),
    lockAfterIdleMinutes: z.coerce.number().int().min(0).max(120).default(5),
  }),

  inventory: z.object({
    deductionPoint: z.enum(["ACCEPTED", "PREPARING", "COMPLETED"]).default("PREPARING"),
    allowNegativeStock: z.boolean().default(true),
  }),

  receipt: z.object({
    header: optionalText(300),
    footer: z.string().trim().max(300).default("Thank you! Please visit again."),
    showLogo: z.boolean().default(true),
    showCashier: z.boolean().default(true),
    showTaxBreakdown: z.boolean().default(true),
    paperWidth: z.enum(["80mm", "58mm"]).default("80mm"),
  }),

  numbering: z.object({
    orderPrefix: z.string().trim().max(6).regex(/^[A-Z0-9-]*$/, "Use A–Z, 0–9 or -").default(""),
    expensePrefix: z.string().trim().min(1).max(6).regex(/^[A-Z0-9-]*$/).default("EXP"),
    purchasePrefix: z.string().trim().min(1).max(6).regex(/^[A-Z0-9-]*$/).default("PO"),
    refundPrefix: z.string().trim().min(1).max(6).regex(/^[A-Z0-9-]*$/).default("RF"),
    wastagePrefix: z.string().trim().min(1).max(6).regex(/^[A-Z0-9-]*$/).default("WS"),
  }),

  payroll: z.object({
    dailyRateBasis: z.enum(["CALENDAR", "30", "26"]).default("30"),
    unrecordedDays: z.enum(["PAID", "UNPAID"]).default("PAID"),
    latesPerDayDeduction: z.coerce.number().int().min(0).max(31).default(0),
    overtimeMultiplier: z.string().trim().regex(/^\d(\.\d{1,2})?$/, "Enter a number like 1 or 1.5").default("1"),
    overtimeMinimumMinutes: z.coerce.number().int().min(0).max(240).default(30),
    standardShiftHours: z.coerce.number().int().min(1).max(16).default(8),
  }),

  notifications: z.object({
    emailCriticalAlerts: z.boolean().default(false),
    alertEmail: z.union([z.email("Enter a valid e-mail"), z.literal("")]).default(""),
    alertChannel: z.enum(["NONE", "SMS", "WHATSAPP"]).default("NONE"),
    alertPhone: phone,
    customerOrderMessages: z.enum(["NONE", "SMS", "WHATSAPP"]).default("NONE"),
  }),

  loyalty: z.object({
    enabled: z.boolean().default(false),
    spendPerPoint: moneyString.default("100"),
    pointValue: moneyString.default("1"),
    minimumRedeemPoints: z.coerce.number().int().min(0).default(100),
    maxRedeemPercent: percent.default(50),
    expiryDays: z.coerce.number().int().min(0).max(3650).default(365),
  }),
} as const;

export type SettingsKey = keyof typeof settingsSchemas;
export type SettingsValue<K extends SettingsKey> = z.output<(typeof settingsSchemas)[K]>;
export const SETTINGS_KEYS = Object.keys(settingsSchemas) as SettingsKey[];

export function isSettingsKey(v: string): v is SettingsKey {
  return Object.prototype.hasOwnProperty.call(settingsSchemas, v);
}

/** Default value for a key (business.profile needs a name, so it gets a placeholder). */
export function defaultSettings<K extends SettingsKey>(key: K): SettingsValue<K> {
  const schema = settingsSchemas[key] as unknown as z.ZodType<SettingsValue<K>>;
  const base = key === "business.profile" ? { name: "My Restaurant" } : {};
  return schema.parse(base);
}

/** Parse a stored value, falling back to defaults for missing/invalid fields. */
export function parseStoredSettings<K extends SettingsKey>(key: K, stored: unknown): SettingsValue<K> {
  const schema = settingsSchemas[key] as unknown as z.ZodType<SettingsValue<K>>;
  const merged = { ...(defaultSettings(key) as object), ...((stored as object) ?? {}) };
  const parsed = schema.safeParse(merged);
  return parsed.success ? parsed.data : defaultSettings(key);
}

// ─── UI description of each settings section ────────────────────────────────

export type FieldType = "text" | "textarea" | "email" | "tel" | "url" | "number" | "money" | "percent" | "switch" | "select";

export type FieldDef = {
  name: string;
  label: string;
  type: FieldType;
  help?: string;
  options?: { value: string; label: string }[];
  placeholder?: string;
};

export type SectionDef = {
  slug: string;
  key: SettingsKey;
  title: string;
  description: string;
  fields: FieldDef[];
  notice?: string;
};

export const SETTINGS_SECTIONS: SectionDef[] = [
  {
    slug: "business",
    key: "business.profile",
    title: "Business profile",
    description: "Name, contact details and logo shown on the website and receipts.",
    fields: [
      { name: "name", label: "Restaurant name", type: "text" },
      { name: "tagline", label: "Tagline", type: "text", placeholder: "Fresh, fast and delicious" },
      { name: "logoUrl", label: "Logo", type: "url", help: "Upload an image or paste an image URL." },
      { name: "address", label: "Address", type: "textarea" },
      { name: "city", label: "City", type: "text" },
      { name: "phone", label: "Phone", type: "tel" },
      { name: "whatsapp", label: "WhatsApp number", type: "tel", help: "International format, e.g. +92 300 1234567" },
      { name: "email", label: "E-mail", type: "email" },
      { name: "website", label: "Website", type: "url" },
      { name: "mapUrl", label: "Google Maps link", type: "url" },
      { name: "taxNumber", label: "Tax registration number (NTN/STRN)", type: "text" },
    ],
  },
  {
    slug: "finance",
    key: "finance",
    title: "Currency, tax & charges",
    description: "How totals are calculated on every order.",
    notice:
      "Confirm your provincial sales-tax rates and rules with your tax advisor before enabling tax. This system does not provide tax advice.",
    fields: [
      { name: "currencyCode", label: "Currency code", type: "text" },
      { name: "currencySymbol", label: "Currency symbol", type: "text" },
      { name: "taxEnabled", label: "Charge sales tax", type: "switch" },
      { name: "taxLabel", label: "Tax label on receipts", type: "text" },
      { name: "taxRateCash", label: "Tax rate — cash payments (%)", type: "percent" },
      { name: "taxRateCard", label: "Tax rate — card / online payments (%)", type: "percent" },
      { name: "pricesIncludeTax", label: "Menu prices already include tax", type: "switch" },
      { name: "serviceChargeEnabled", label: "Service charge on dine-in", type: "switch" },
      { name: "serviceChargePercent", label: "Service charge (%)", type: "percent" },
      {
        name: "cashRoundingStep",
        label: "Round cash totals to",
        type: "select",
        options: [
          { value: "0", label: "No rounding" },
          { value: "1", label: "Nearest 1" },
          { value: "5", label: "Nearest 5" },
          { value: "10", label: "Nearest 10" },
        ],
      },
    ],
  },
  {
    slug: "ordering",
    key: "ordering",
    title: "Ordering",
    description: "Order types, online ordering behaviour and the business day.",
    fields: [
      { name: "onlineOrderingEnabled", label: "Accept online orders", type: "switch" },
      { name: "takeawayEnabled", label: "Takeaway", type: "switch" },
      { name: "deliveryEnabled", label: "Delivery", type: "switch" },
      { name: "dineInEnabled", label: "Dine-in", type: "switch" },
      { name: "autoAcceptOnlineOrders", label: "Auto-accept online orders", type: "switch" },
      { name: "defaultPrepMinutes", label: "Default preparation time (minutes)", type: "number" },
      { name: "unacceptedAlertMinutes", label: "Alert if an online order is not accepted within (minutes)", type: "number" },
      { name: "splitPaymentEnabled", label: "Allow split payments", type: "switch" },
      {
        name: "dayCutoffHour",
        label: "Business day ends at (hour, 0–11)",
        type: "number",
        help: "Sales before this hour count toward the previous day. Example: 5 means a 2 am sale belongs to yesterday.",
      },
    ],
  },
  {
    slug: "delivery",
    key: "delivery",
    title: "Delivery",
    description: "Default charges used when an address has no delivery zone.",
    fields: [
      { name: "defaultCharge", label: "Default delivery charge", type: "money" },
      { name: "minimumOrder", label: "Minimum order for delivery", type: "money" },
      { name: "freeDeliveryAbove", label: "Free delivery above (leave empty to disable)", type: "money" },
      { name: "estimatedMinutes", label: "Estimated delivery time (minutes)", type: "number" },
    ],
  },
  {
    slug: "pos",
    key: "pos",
    title: "POS & cash",
    description: "Limits that decide when a manager must approve.",
    fields: [
      { name: "cashierMaxDiscountPercent", label: "Max discount a cashier can give without approval (%)", type: "percent" },
      { name: "largeRefundThreshold", label: "Notify managers of refunds above", type: "money" },
      { name: "cashDiscrepancyTolerance", label: "Cash shortage/excess tolerance at shift close", type: "money" },
      { name: "autoPrintReceipt", label: "Print receipt automatically after payment", type: "switch" },
      { name: "autoPrintKitchenTicket", label: "Print kitchen ticket automatically", type: "switch" },
      { name: "lockAfterIdleMinutes", label: "Lock POS after idle (minutes, 0 = never)", type: "number" },
    ],
  },
  {
    slug: "inventory",
    key: "inventory",
    title: "Inventory",
    description: "When ingredients are deducted from stock.",
    fields: [
      {
        name: "deductionPoint",
        label: "Deduct ingredients when the order is",
        type: "select",
        options: [
          { value: "ACCEPTED", label: "Accepted" },
          { value: "PREPARING", label: "Being prepared (recommended)" },
          { value: "COMPLETED", label: "Completed" },
        ],
      },
      { name: "allowNegativeStock", label: "Allow sales when stock shows zero (alert instead of blocking)", type: "switch" },
    ],
  },
  {
    slug: "receipt",
    key: "receipt",
    title: "Receipt",
    description: "Thermal receipt layout.",
    fields: [
      { name: "header", label: "Header text", type: "textarea" },
      { name: "footer", label: "Footer / thank-you message", type: "textarea" },
      { name: "showLogo", label: "Print logo", type: "switch" },
      { name: "showCashier", label: "Print cashier name", type: "switch" },
      { name: "showTaxBreakdown", label: "Print tax breakdown", type: "switch" },
      {
        name: "paperWidth",
        label: "Paper width",
        type: "select",
        options: [
          { value: "80mm", label: "80 mm" },
          { value: "58mm", label: "58 mm" },
        ],
      },
    ],
  },
  {
    slug: "numbering",
    key: "numbering",
    title: "Document numbering",
    description: "Prefixes for document numbers. Order numbers reset daily, e.g. 261012-0042.",
    fields: [
      { name: "orderPrefix", label: "Order number prefix (optional)", type: "text" },
      { name: "expensePrefix", label: "Expense prefix", type: "text" },
      { name: "purchasePrefix", label: "Purchase prefix", type: "text" },
      { name: "refundPrefix", label: "Refund prefix", type: "text" },
      { name: "wastagePrefix", label: "Wastage prefix", type: "text" },
    ],
  },
  {
    slug: "payroll",
    key: "payroll",
    title: "Attendance & payroll",
    description: "How salaries are calculated from attendance. Changes apply to draft payroll runs when they are recalculated.",
    fields: [
      {
        name: "dailyRateBasis",
        label: "Daily rate for a monthly salary",
        type: "select",
        options: [
          { value: "30", label: "Salary ÷ 30 (common)" },
          { value: "26", label: "Salary ÷ 26 working days" },
          { value: "CALENDAR", label: "Salary ÷ days in the month" },
        ],
      },
      {
        name: "unrecordedDays",
        label: "Days with no attendance entry are",
        type: "select",
        options: [
          { value: "PAID", label: "Paid (only marked absences are deducted)" },
          { value: "UNPAID", label: "Unpaid (every working day must be recorded)" },
        ],
      },
      { name: "latesPerDayDeduction", label: "Deduct one day for every N late arrivals (0 = never)", type: "number" },
      { name: "overtimeMultiplier", label: "Overtime pay multiplier (1 = normal hourly rate)", type: "text" },
      { name: "overtimeMinimumMinutes", label: "Count overtime only when it is at least (minutes)", type: "number" },
      { name: "standardShiftHours", label: "Standard shift length in hours (for staff without a shift)", type: "number" },
    ],
  },
  {
    slug: "notifications",
    key: "notifications",
    title: "Alerts & messages",
    description: "Staff see alerts in the bell menu. Urgent ones (online orders not accepted in time, big cash differences) can also go by e-mail, SMS or WhatsApp once a provider is connected.",
    fields: [
      { name: "emailCriticalAlerts", label: "E-mail urgent alerts", type: "switch" },
      { name: "alertEmail", label: "Send urgent e-mails to (blank = each manager's own e-mail)", type: "email" },
      {
        name: "alertChannel",
        label: "Also send urgent alerts by",
        type: "select",
        options: [
          { value: "NONE", label: "Nothing else" },
          { value: "SMS", label: "SMS" },
          { value: "WHATSAPP", label: "WhatsApp" },
        ],
      },
      { name: "alertPhone", label: "Phone number for urgent alerts", type: "tel" },
      {
        name: "customerOrderMessages",
        label: "Message customers when their order is accepted, ready or on the way",
        type: "select",
        options: [
          { value: "NONE", label: "Off" },
          { value: "SMS", label: "By SMS" },
          { value: "WHATSAPP", label: "By WhatsApp" },
        ],
      },
    ],
  },
  {
    slug: "loyalty",
    key: "loyalty",
    title: "Loyalty",
    description: "Customers with an account or phone number earn points on completed orders and can spend them as a discount.",
    fields: [
      { name: "enabled", label: "Enable loyalty points", type: "switch" },
      { name: "spendPerPoint", label: "Amount spent to earn 1 point", type: "money" },
      { name: "pointValue", label: "Value of 1 point when redeemed", type: "money" },
      { name: "minimumRedeemPoints", label: "Minimum points to redeem", type: "number" },
      { name: "maxRedeemPercent", label: "Max % of an order payable with points", type: "percent" },
      { name: "expiryDays", label: "Points expire after (days, 0 = never)", type: "number" },
    ],
  },
];

export function sectionBySlug(slug: string): SectionDef | undefined {
  return SETTINGS_SECTIONS.find((s) => s.slug === slug);
}
