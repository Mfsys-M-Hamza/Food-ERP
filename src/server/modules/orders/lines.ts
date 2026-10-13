import "server-only";
import { Prisma, type Db } from "@/server/core/db";
import { validationFailed } from "@/server/core/errors";
import type { OrderLineInput } from "./schemas";

export type ResolvedAddon = {
  addonId: string;
  groupName: string;
  addonName: string;
  unitPrice: Prisma.Decimal;
  unitCost: Prisma.Decimal;
};

export type ResolvedLine = {
  productId: string;
  variantId: string | null;
  categoryId: string;
  productName: string;
  variantName: string | null;
  sku: string;
  quantity: number;
  unitPrice: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  addons: ResolvedAddon[];
  addonsUnitTotal: Prisma.Decimal;
  addonsUnitCost: Prisma.Decimal;
  removals: { removableOptionId: string; label: string }[];
  note: string;
  prepTimeMinutes: number;
};

/**
 * Re-price and validate cart lines against the live menu. Throws
 * VALIDATION_FAILED with a per-line message the cashier/customer can act on.
 */
export async function resolveLines(tx: Db, items: OrderLineInput[], channel: "POS" | "ONLINE"): Promise<ResolvedLine[]> {
  const productIds = [...new Set(items.map((i) => i.productId))];
  const products = await tx.product.findMany({
    where: { id: { in: productIds } },
    include: {
      category: { select: { isActive: true, deletedAt: true } },
      variants: { where: { deletedAt: null } },
      addonGroups: { include: { group: { include: { addons: { where: { deletedAt: null } } } } } },
      removables: true,
    },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const errors: Record<string, string[]> = {};
  const fail = (i: number, msg: string) => ((errors[`items.${i}`] ??= []).push(msg));

  const lines: ResolvedLine[] = [];
  items.forEach((item, i) => {
    const p = byId.get(item.productId);
    if (!p || p.deletedAt || !p.isActive || p.category.deletedAt || !p.category.isActive) return fail(i, "This item is no longer on the menu.");
    if (channel === "POS" ? !p.showOnPos : !p.showOnline) return fail(i, `${p.name} is not sold on this channel.`);
    if (!p.isAvailable) return fail(i, `${p.name} is out of stock.`);

    let variant = null as (typeof p.variants)[number] | null;
    if (p.variants.length > 0) {
      variant = p.variants.find((v) => v.id === item.variantId) ?? null;
      if (!variant) return fail(i, `Choose a size for ${p.name}.`);
      if (!variant.isAvailable) return fail(i, `${p.name} (${variant.name}) is out of stock.`);
    } else if (item.variantId) {
      return fail(i, `${p.name} has no sizes.`);
    }

    const activeGroups = p.addonGroups.filter((pg) => pg.group.isActive && !pg.group.deletedAt).map((pg) => pg.group);
    const selected: ResolvedAddon[] = [];
    const addonIds = item.addonIds ?? [];
    if (new Set(addonIds).size !== addonIds.length) return fail(i, "An option was selected twice.");
    for (const addonId of addonIds) {
      const group = activeGroups.find((g) => g.addons.some((a) => a.id === addonId));
      const addon = group?.addons.find((a) => a.id === addonId);
      if (!group || !addon) return fail(i, `An option for ${p.name} is no longer available.`);
      if (!addon.isAvailable) return fail(i, `${addon.name} is out of stock.`);
      selected.push({ addonId, groupName: group.name, addonName: addon.name, unitPrice: addon.price, unitCost: addon.cost });
    }
    for (const g of activeGroups) {
      const count = selected.filter((s) => g.addons.some((a) => a.id === s.addonId)).length;
      if (count < g.minSelect) return fail(i, `${p.name}: ${g.title || g.name} — choose ${g.minSelect === 1 ? "one" : `at least ${g.minSelect}`}.`);
      if (count > g.maxSelect) return fail(i, `${p.name}: ${g.title || g.name} — choose at most ${g.maxSelect}.`);
    }

    const removals: { removableOptionId: string; label: string }[] = [];
    for (const rid of item.removableIds ?? []) {
      const r = p.removables.find((x) => x.id === rid);
      if (!r) return fail(i, `A removal option for ${p.name} is no longer available.`);
      removals.push({ removableOptionId: r.id, label: r.label });
    }

    const addonsUnitTotal = selected.reduce((a, s) => a.plus(s.unitPrice), new Prisma.Decimal(0));
    const addonsUnitCost = selected.reduce((a, s) => a.plus(s.unitCost), new Prisma.Decimal(0));
    lines.push({
      productId: p.id,
      variantId: variant?.id ?? null,
      categoryId: p.categoryId,
      productName: p.name,
      variantName: variant?.name ?? null,
      sku: variant?.sku || p.sku,
      quantity: item.quantity,
      unitPrice: variant ? variant.price : p.basePrice,
      unitCost: variant ? variant.cost : p.cost,
      addons: selected,
      addonsUnitTotal,
      addonsUnitCost,
      removals,
      note: item.note ?? "",
      prepTimeMinutes: p.prepTimeMinutes,
    });
  });

  if (Object.keys(errors).length) {
    const first = Object.values(errors)[0]![0]!;
    throw validationFailed(errors, first);
  }
  return lines;
}
