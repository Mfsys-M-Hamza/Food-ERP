import { z } from "zod";

/** Shared (client + server) validation for menu management. */

export const moneySchema = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,2})?$/, "Enter an amount like 450 or 450.50");
export const costSchema = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,4})?$/, "Enter a cost like 180 or 180.25");

const optionalUuid = z.union([z.uuid(), z.literal("")]).optional();

export const categorySchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(60),
  description: z.string().trim().max(300).optional().default(""),
  imageUrl: z.string().trim().max(500).optional().default(""),
  isActive: z.boolean().default(true),
});
export type CategoryInput = z.input<typeof categorySchema>;

export const variantSchema = z.object({
  id: optionalUuid,
  name: z.string().trim().min(1, "Name the variant").max(40),
  sku: z.string().trim().max(40).optional().default(""),
  price: moneySchema,
  cost: costSchema.default("0"),
  isDefault: z.boolean().default(false),
  isAvailable: z.boolean().default(true),
});

export const removableSchema = z.object({
  id: optionalUuid,
  label: z.string().trim().min(2, "Label is required").max(40),
});

export const productSchema = z
  .object({
    name: z.string().trim().min(2, "Name is required").max(80),
    categoryId: z.uuid("Choose a category"),
    type: z.enum(["SIMPLE", "DEAL"]).default("SIMPLE"),
    sku: z
      .string()
      .trim()
      .toUpperCase()
      .max(40)
      .regex(/^[A-Z0-9-]*$/, "Use A–Z, 0–9 and - only")
      .optional()
      .default(""),
    description: z.string().trim().max(500).optional().default(""),
    imageUrl: z.string().trim().max(500).optional().default(""),
    basePrice: z.union([moneySchema, z.literal("")]).default(""),
    cost: costSchema.default("0"),
    prepTimeMinutes: z.coerce.number().int().min(0, "Cannot be negative").max(240),
    isAvailable: z.boolean().default(true),
    isActive: z.boolean().default(true),
    isFeatured: z.boolean().default(false),
    showOnPos: z.boolean().default(true),
    showOnline: z.boolean().default(true),
    variants: z.array(variantSchema).max(20).default([]),
    addonGroupIds: z.array(z.uuid()).max(20).default([]),
    removables: z.array(removableSchema).max(20).default([]),
  })
  .superRefine((p, ctx) => {
    if (p.variants.length === 0 && !p.basePrice) {
      ctx.addIssue({ code: "custom", path: ["basePrice"], message: "Enter the selling price" });
    }
    if (p.variants.length > 0) {
      const defaults = p.variants.filter((v) => v.isDefault).length;
      if (defaults !== 1) ctx.addIssue({ code: "custom", path: ["variants"], message: "Mark exactly one variant as default" });
      const names = p.variants.map((v) => v.name.toLowerCase());
      if (new Set(names).size !== names.length)
        ctx.addIssue({ code: "custom", path: ["variants"], message: "Variant names must be different" });
    }
    if (new Set(p.addonGroupIds).size !== p.addonGroupIds.length)
      ctx.addIssue({ code: "custom", path: ["addonGroupIds"], message: "Add-on group listed twice" });
  });
export type ProductInput = z.input<typeof productSchema>;
export type ProductParsed = z.output<typeof productSchema>;

export const addonSchema = z.object({
  id: optionalUuid,
  name: z.string().trim().min(1, "Name is required").max(50),
  price: moneySchema,
  cost: costSchema.default("0"),
  isAvailable: z.boolean().default(true),
});

export const addonGroupSchema = z
  .object({
    name: z.string().trim().min(2, "Name is required").max(50),
    title: z.string().trim().max(60).optional().default(""),
    minSelect: z.coerce.number().int().min(0).max(20),
    maxSelect: z.coerce.number().int().min(1, "At least 1").max(20),
    isActive: z.boolean().default(true),
    addons: z.array(addonSchema).min(1, "Add at least one option").max(40),
  })
  .superRefine((g, ctx) => {
    if (g.minSelect > g.maxSelect)
      ctx.addIssue({ code: "custom", path: ["minSelect"], message: "Minimum cannot be more than maximum" });
    if (g.minSelect > g.addons.length)
      ctx.addIssue({ code: "custom", path: ["minSelect"], message: "Minimum is more than the number of options" });
  });
export type AddonGroupInput = z.input<typeof addonGroupSchema>;
