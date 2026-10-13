import "server-only";
import type { z } from "zod";
import { db, withTransaction, Prisma, type Tx } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";
import { authorize, authorizeAny, can } from "@/server/core/rbac";
import { recordAudit, diffObjects } from "@/server/core/audit";
import { emit } from "@/server/core/events";
import { forbidden, invalidState, notFound, validationFailed } from "@/server/core/errors";
import { zodFieldErrors } from "@/server/core/action";
import { slugify } from "@/lib/slug";
import { categorySchema, productSchema, addonGroupSchema, type ProductParsed } from "./schemas";

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw validationFailed(zodFieldErrors(r.error));
  return r.data;
}

const dec = (v: Prisma.Decimal | null | undefined, places = 2) => (v ? v.toFixed(places) : (0).toFixed(places));
/** Cost strings without trailing zeros beyond 2 decimals ("180.2500" → "180.25"). */
const costStr = (v: Prisma.Decimal | null | undefined) => (v ? new Prisma.Decimal(v).toDecimalPlaces(4).toString() : "0");

async function uniqueSlug(tx: Tx, model: "category" | "product", base: string, excludeId?: string) {
  const root = slugify(base);
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const existing =
      model === "category"
        ? await tx.category.findUnique({ where: { slug: candidate }, select: { id: true } })
        : await tx.product.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!existing || existing.id === excludeId) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

async function generateSku(tx: Tx, name: string) {
  const initials = name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 4) || "ITEM";
  for (let n = 1; n < 1000; n++) {
    const sku = `${initials}-${String(n).padStart(3, "0")}`;
    if (!(await tx.product.findUnique({ where: { sku }, select: { id: true } }))) return sku;
  }
  return `${initials}-${Date.now().toString(36).toUpperCase()}`;
}

// ═══ Categories ═════════════════════════════════════════════════════════════

export type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  isActive: boolean;
  sortOrder: number;
  productCount: number;
};

export async function listCategories(ctx: Ctx): Promise<CategoryRow[]> {
  authorizeAny(ctx, ["menu.view", "menu.manage", "menu.availability"]);
  const rows = await db.category.findMany({
    where: { deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { products: { where: { deletedAt: null } } } } },
  });
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    description: c.description,
    imageUrl: c.imageUrl,
    isActive: c.isActive,
    sortOrder: c.sortOrder,
    productCount: c._count.products,
  }));
}

async function assertCategoryNameFree(tx: Tx, name: string, excludeId?: string) {
  const clash = await tx.category.findFirst({
    where: { deletedAt: null, name: { equals: name, mode: "insensitive" }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  if (clash) throw validationFailed({ name: ["A category with this name already exists"] });
}

export async function createCategory(ctx: Ctx, input: unknown) {
  authorize(ctx, "menu.manage");
  const data = parse(categorySchema, input);
  return withTransaction(async (tx) => {
    await assertCategoryNameFree(tx, data.name);
    const max = await tx.category.aggregate({ _max: { sortOrder: true }, where: { deletedAt: null } });
    const cat = await tx.category.create({
      data: {
        name: data.name,
        slug: await uniqueSlug(tx, "category", data.name),
        description: data.description || null,
        imageUrl: data.imageUrl || null,
        isActive: data.isActive,
        sortOrder: (max._max.sortOrder ?? 0) + 10,
      },
    });
    await recordAudit(tx, ctx, { action: "category.create", module: "menu", entityType: "category", entityId: cat.id, after: data });
    return cat;
  });
}

export async function updateCategory(ctx: Ctx, id: string, input: unknown) {
  authorize(ctx, "menu.manage");
  const data = parse(categorySchema, input);
  return withTransaction(async (tx) => {
    const current = await tx.category.findFirst({ where: { id, deletedAt: null } });
    if (!current) throw notFound("Category");
    await assertCategoryNameFree(tx, data.name, id);
    const updated = await tx.category.update({
      where: { id },
      data: {
        name: data.name,
        slug: current.name === data.name ? current.slug : await uniqueSlug(tx, "category", data.name, id),
        description: data.description || null,
        imageUrl: data.imageUrl || null,
        isActive: data.isActive,
      },
    });
    const diff = diffObjects(
      { name: current.name, description: current.description ?? "", imageUrl: current.imageUrl ?? "", isActive: current.isActive },
      { name: data.name, description: data.description, imageUrl: data.imageUrl, isActive: data.isActive },
    );
    if (Object.keys(diff.after).length)
      await recordAudit(tx, ctx, { action: "category.update", module: "menu", entityType: "category", entityId: id, ...diff });
    return updated;
  });
}

/** Archive a category. Only allowed when it has no products left. */
export async function archiveCategory(ctx: Ctx, id: string) {
  authorize(ctx, "menu.manage");
  await withTransaction(async (tx) => {
    const cat = await tx.category.findFirst({ where: { id, deletedAt: null } });
    if (!cat) throw notFound("Category");
    const count = await tx.product.count({ where: { categoryId: id, deletedAt: null } });
    if (count > 0) throw invalidState(`Move or archive the ${count} product(s) in “${cat.name}” first.`);
    await tx.category.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await recordAudit(tx, ctx, { action: "category.archive", module: "menu", entityType: "category", entityId: id, before: { name: cat.name } });
  });
}

/** Persist a new display order (array of category ids, first = top). */
export async function reorderCategories(ctx: Ctx, ids: string[]) {
  authorize(ctx, "menu.manage");
  if (!Array.isArray(ids) || ids.length > 200) throw validationFailed({ _form: ["Invalid order"] });
  await withTransaction(async (tx) => {
    for (let i = 0; i < ids.length; i++) {
      await tx.category.updateMany({ where: { id: String(ids[i]), deletedAt: null }, data: { sortOrder: (i + 1) * 10 } });
    }
    await recordAudit(tx, ctx, { action: "category.reorder", module: "menu", entityType: "category", after: { order: ids } });
  });
}

// ═══ Products ═══════════════════════════════════════════════════════════════

export type ProductListRow = {
  id: string;
  name: string;
  sku: string;
  type: "SIMPLE" | "DEAL";
  imageUrl: string | null;
  categoryId: string;
  categoryName: string;
  minPrice: string;
  maxPrice: string;
  variantCount: number;
  isAvailable: boolean;
  isActive: boolean;
  isFeatured: boolean;
  showOnPos: boolean;
  showOnline: boolean;
};

export type ProductFilter = { q?: string; categoryId?: string; status?: "all" | "active" | "out" | "hidden" };

export async function listProducts(ctx: Ctx, filter: ProductFilter = {}): Promise<ProductListRow[]> {
  authorizeAny(ctx, ["menu.view", "menu.manage", "menu.availability"]);
  const q = filter.q?.trim();
  const where: Prisma.ProductWhereInput = {
    deletedAt: null,
    ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
    ...(filter.status === "active" ? { isActive: true, isAvailable: true } : {}),
    ...(filter.status === "out" ? { isAvailable: false } : {}),
    ...(filter.status === "hidden" ? { isActive: false } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const rows = await db.product.findMany({
    where,
    orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
    include: {
      category: { select: { name: true } },
      variants: { where: { deletedAt: null }, select: { price: true } },
    },
    take: 1000,
  });
  return rows.map((p) => {
    const prices = p.variants.length ? p.variants.map((v) => v.price) : [p.basePrice];
    const min = prices.reduce((a, b) => (b.lessThan(a) ? b : a));
    const max = prices.reduce((a, b) => (b.greaterThan(a) ? b : a));
    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      type: p.type,
      imageUrl: p.imageUrl,
      categoryId: p.categoryId,
      categoryName: p.category.name,
      minPrice: dec(min),
      maxPrice: dec(max),
      variantCount: p.variants.length,
      isAvailable: p.isAvailable,
      isActive: p.isActive,
      isFeatured: p.isFeatured,
      showOnPos: p.showOnPos,
      showOnline: p.showOnline,
    };
  });
}

export type ProductEditor = {
  id: string;
  name: string;
  categoryId: string;
  type: "SIMPLE" | "DEAL";
  sku: string;
  description: string;
  imageUrl: string;
  basePrice: string;
  cost: string;
  prepTimeMinutes: number;
  isAvailable: boolean;
  isActive: boolean;
  isFeatured: boolean;
  showOnPos: boolean;
  showOnline: boolean;
  variants: { id: string; name: string; sku: string; price: string; cost: string; isDefault: boolean; isAvailable: boolean }[];
  addonGroupIds: string[];
  removables: { id: string; label: string }[];
};

export async function getProductForEditor(ctx: Ctx, id: string): Promise<ProductEditor> {
  authorizeAny(ctx, ["menu.view", "menu.manage"]);
  const p = await db.product.findFirst({
    where: { id, deletedAt: null },
    include: {
      variants: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
      addonGroups: { orderBy: { sortOrder: "asc" } },
      removables: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!p) throw notFound("Product");
  return {
    id: p.id,
    name: p.name,
    categoryId: p.categoryId,
    type: p.type,
    sku: p.sku,
    description: p.description ?? "",
    imageUrl: p.imageUrl ?? "",
    basePrice: dec(p.basePrice),
    cost: costStr(p.cost),
    prepTimeMinutes: p.prepTimeMinutes,
    isAvailable: p.isAvailable,
    isActive: p.isActive,
    isFeatured: p.isFeatured,
    showOnPos: p.showOnPos,
    showOnline: p.showOnline,
    variants: p.variants.map((v) => ({
      id: v.id,
      name: v.name,
      sku: v.sku ?? "",
      price: dec(v.price),
      cost: costStr(v.cost),
      isDefault: v.isDefault,
      isAvailable: v.isAvailable,
    })),
    addonGroupIds: p.addonGroups.map((g) => g.addonGroupId),
    removables: p.removables.map((r) => ({ id: r.id, label: r.label })),
  };
}

type PriceSnapshot = { basePrice: string; variants: Record<string, string> };

function priceSnapshot(basePrice: string, variants: { name: string; price: string }[]): PriceSnapshot {
  return { basePrice, variants: Object.fromEntries(variants.map((v) => [v.name, v.price])) };
}

async function validateReferences(tx: Tx, data: ProductParsed) {
  const cat = await tx.category.findFirst({ where: { id: data.categoryId, deletedAt: null }, select: { id: true } });
  if (!cat) throw validationFailed({ categoryId: ["Choose a valid category"] });
  if (data.addonGroupIds.length) {
    const n = await tx.addonGroup.count({ where: { id: { in: data.addonGroupIds }, deletedAt: null } });
    if (n !== data.addonGroupIds.length) throw validationFailed({ addonGroupIds: ["An add-on group no longer exists"] });
  }
  for (const v of data.variants) {
    if (v.sku) {
      const clash = await tx.productVariant.findFirst({
        where: { sku: v.sku, ...(v.id ? { id: { not: v.id } } : {}) },
        select: { id: true },
      });
      if (clash) throw validationFailed({ variants: [`Variant SKU ${v.sku} is already used`] });
    }
  }
}

async function syncChildren(tx: Tx, productId: string, data: ProductParsed) {
  // Variants: update by id, create new, archive removed.
  const existing = await tx.productVariant.findMany({ where: { productId, deletedAt: null }, select: { id: true } });
  const keep = new Set(data.variants.map((v) => v.id).filter(Boolean) as string[]);
  for (const ex of existing) {
    if (!keep.has(ex.id)) await tx.productVariant.update({ where: { id: ex.id }, data: { deletedAt: new Date(), isDefault: false } });
  }
  for (let i = 0; i < data.variants.length; i++) {
    const v = data.variants[i]!;
    const values = {
      name: v.name,
      sku: v.sku || null,
      price: v.price,
      cost: v.cost,
      isDefault: v.isDefault,
      isAvailable: v.isAvailable,
      sortOrder: (i + 1) * 10,
    };
    if (v.id && existing.some((e) => e.id === v.id)) await tx.productVariant.update({ where: { id: v.id }, data: values });
    else await tx.productVariant.create({ data: { productId, ...values } });
  }

  await tx.productAddonGroup.deleteMany({ where: { productId } });
  if (data.addonGroupIds.length) {
    await tx.productAddonGroup.createMany({
      data: data.addonGroupIds.map((addonGroupId, i) => ({ productId, addonGroupId, sortOrder: (i + 1) * 10 })),
    });
  }

  const existingRem = await tx.productRemovableOption.findMany({ where: { productId }, select: { id: true } });
  const keepRem = new Set(data.removables.map((r) => r.id).filter(Boolean) as string[]);
  const removeIds = existingRem.filter((r) => !keepRem.has(r.id)).map((r) => r.id);
  if (removeIds.length) await tx.productRemovableOption.deleteMany({ where: { id: { in: removeIds } } });
  for (let i = 0; i < data.removables.length; i++) {
    const r = data.removables[i]!;
    if (r.id && existingRem.some((e) => e.id === r.id))
      await tx.productRemovableOption.update({ where: { id: r.id }, data: { label: r.label, sortOrder: (i + 1) * 10 } });
    else await tx.productRemovableOption.create({ data: { productId, label: r.label, sortOrder: (i + 1) * 10 } });
  }
}

function productColumns(data: ProductParsed) {
  return {
    name: data.name,
    categoryId: data.categoryId,
    type: data.type,
    description: data.description || null,
    imageUrl: data.imageUrl || null,
    basePrice: data.variants.length ? data.variants.find((v) => v.isDefault)!.price : data.basePrice,
    cost: data.variants.length ? data.variants.find((v) => v.isDefault)!.cost : data.cost,
    prepTimeMinutes: data.prepTimeMinutes,
    isAvailable: data.isAvailable,
    isActive: data.isActive,
    isFeatured: data.isFeatured,
    showOnPos: data.showOnPos,
    showOnline: data.showOnline,
  };
}

export async function createProduct(ctx: Ctx, input: unknown): Promise<{ id: string }> {
  authorize(ctx, "menu.manage");
  authorize(ctx, "menu.price.change");
  const data = parse(productSchema, input);
  return withTransaction(async (tx) => {
    await validateReferences(tx, data);
    const sku = data.sku || (await generateSku(tx, data.name));
    if (await tx.product.findUnique({ where: { sku }, select: { id: true } })) throw validationFailed({ sku: ["This SKU is already used"] });
    const max = await tx.product.aggregate({ _max: { sortOrder: true }, where: { categoryId: data.categoryId } });
    const product = await tx.product.create({
      data: {
        ...productColumns(data),
        sku,
        slug: await uniqueSlug(tx, "product", data.name),
        sortOrder: (max._max.sortOrder ?? 0) + 10,
      },
    });
    await syncChildren(tx, product.id, data);
    await recordAudit(tx, ctx, {
      action: "product.create",
      module: "menu",
      entityType: "product",
      entityId: product.id,
      after: { name: data.name, sku, ...priceSnapshot(data.basePrice, data.variants) },
    });
    return { id: product.id };
  });
}

export async function updateProduct(ctx: Ctx, id: string, input: unknown): Promise<{ id: string }> {
  authorize(ctx, "menu.manage");
  const data = parse(productSchema, input);
  return withTransaction(async (tx) => {
    const before = await getProductForEditor(ctx, id).catch(() => null);
    if (!before) throw notFound("Product");
    await validateReferences(tx, data);

    const sku = data.sku || before.sku;
    if (sku !== before.sku) {
      const clash = await tx.product.findFirst({ where: { sku, id: { not: id } }, select: { id: true } });
      if (clash) throw validationFailed({ sku: ["This SKU is already used"] });
    }

    const oldPrices = priceSnapshot(before.basePrice, before.variants);
    const newPrices = priceSnapshot(
      data.variants.length ? data.variants.find((v) => v.isDefault)!.price : data.basePrice,
      data.variants.map((v) => ({ name: v.name, price: new Prisma.Decimal(v.price).toFixed(2) })),
    );
    newPrices.basePrice = new Prisma.Decimal(newPrices.basePrice).toFixed(2);
    const priceChanged = JSON.stringify(oldPrices) !== JSON.stringify(newPrices);
    if (priceChanged && !can(ctx, "menu.price.change")) throw forbidden("You may not change prices.");

    await tx.product.update({
      where: { id },
      data: {
        ...productColumns(data),
        sku,
        slug: before.name === data.name ? undefined : await uniqueSlug(tx, "product", data.name, id),
      },
    });
    await syncChildren(tx, id, data);

    if (priceChanged) {
      await recordAudit(tx, ctx, {
        action: "product.price.change",
        module: "menu",
        entityType: "product",
        entityId: id,
        before: oldPrices,
        after: newPrices,
        reason: data.name,
      });
    }
    const diff = diffObjects(
      {
        name: before.name, categoryId: before.categoryId, sku: before.sku, description: before.description, imageUrl: before.imageUrl,
        prepTimeMinutes: before.prepTimeMinutes, isAvailable: before.isAvailable, isActive: before.isActive,
        isFeatured: before.isFeatured, showOnPos: before.showOnPos, showOnline: before.showOnline,
        addonGroupIds: before.addonGroupIds, removables: before.removables.map((r) => r.label),
      },
      {
        name: data.name, categoryId: data.categoryId, sku, description: data.description, imageUrl: data.imageUrl,
        prepTimeMinutes: data.prepTimeMinutes, isAvailable: data.isAvailable, isActive: data.isActive,
        isFeatured: data.isFeatured, showOnPos: data.showOnPos, showOnline: data.showOnline,
        addonGroupIds: data.addonGroupIds, removables: data.removables.map((r) => r.label),
      },
    );
    if (Object.keys(diff.after).length) {
      await recordAudit(tx, ctx, { action: "product.update", module: "menu", entityType: "product", entityId: id, ...diff });
    }
    return { id };
  });
}

/** Quick OUT OF STOCK toggle (POS, kitchen, admin list). Optionally for one variant. */
export async function setAvailability(
  ctx: Ctx,
  input: { productId: string; variantId?: string | null; available: boolean },
): Promise<void> {
  authorize(ctx, "menu.availability");
  await withTransaction(async (tx) => {
    const p = await tx.product.findFirst({ where: { id: input.productId, deletedAt: null }, select: { id: true, name: true } });
    if (!p) throw notFound("Product");
    if (input.variantId) {
      const v = await tx.productVariant.findFirst({ where: { id: input.variantId, productId: p.id, deletedAt: null } });
      if (!v) throw notFound("Variant");
      await tx.productVariant.update({ where: { id: v.id }, data: { isAvailable: input.available } });
    } else {
      await tx.product.update({ where: { id: p.id }, data: { isAvailable: input.available } });
    }
    await recordAudit(tx, ctx, {
      action: input.available ? "product.back_in_stock" : "product.out_of_stock",
      module: "menu",
      entityType: input.variantId ? "product_variant" : "product",
      entityId: input.variantId ?? p.id,
      reason: p.name,
    });
    await emit(tx, { type: "menu.availability_changed", productId: p.id, available: input.available });
  });
}

export async function archiveProduct(ctx: Ctx, id: string): Promise<void> {
  authorize(ctx, "menu.manage");
  await withTransaction(async (tx) => {
    const p = await tx.product.findFirst({ where: { id, deletedAt: null } });
    if (!p) throw notFound("Product");
    await tx.product.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await recordAudit(tx, ctx, { action: "product.archive", module: "menu", entityType: "product", entityId: id, before: { name: p.name, sku: p.sku } });
  });
}

// ═══ Add-on groups ══════════════════════════════════════════════════════════

export type AddonGroupRow = {
  id: string;
  name: string;
  title: string;
  minSelect: number;
  maxSelect: number;
  isActive: boolean;
  productCount: number;
  addons: { id: string; name: string; price: string; cost: string; isAvailable: boolean }[];
};

export async function listAddonGroups(ctx: Ctx): Promise<AddonGroupRow[]> {
  authorizeAny(ctx, ["menu.view", "menu.manage"]);
  const groups = await db.addonGroup.findMany({
    where: { deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      addons: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
      _count: { select: { products: true } },
    },
  });
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    title: g.title ?? "",
    minSelect: g.minSelect,
    maxSelect: g.maxSelect,
    isActive: g.isActive,
    productCount: g._count.products,
    addons: g.addons.map((a) => ({ id: a.id, name: a.name, price: dec(a.price), cost: costStr(a.cost), isAvailable: a.isAvailable })),
  }));
}

export async function saveAddonGroup(ctx: Ctx, id: string | null, input: unknown): Promise<{ id: string }> {
  authorize(ctx, "menu.manage");
  const data = parse(addonGroupSchema, input);
  return withTransaction(async (tx) => {
    let groupId = id;
    let before: unknown = null;
    if (groupId) {
      const current = await tx.addonGroup.findFirst({
        where: { id: groupId, deletedAt: null },
        include: { addons: { where: { deletedAt: null } } },
      });
      if (!current) throw notFound("Add-on group");
      before = { name: current.name, min: current.minSelect, max: current.maxSelect, addons: current.addons.map((a) => `${a.name}=${a.price.toFixed(2)}`) };
      const priceChange = current.addons.some((a) => {
        const next = data.addons.find((n) => n.id === a.id);
        return next && !new Prisma.Decimal(next.price).equals(a.price);
      });
      if (priceChange) authorize(ctx, "menu.price.change");
      await tx.addonGroup.update({
        where: { id: groupId },
        data: { name: data.name, title: data.title || null, minSelect: data.minSelect, maxSelect: data.maxSelect, isActive: data.isActive },
      });
    } else {
      authorize(ctx, "menu.price.change");
      const created = await tx.addonGroup.create({
        data: { name: data.name, title: data.title || null, minSelect: data.minSelect, maxSelect: data.maxSelect, isActive: data.isActive },
      });
      groupId = created.id;
    }
    const existing = await tx.addon.findMany({ where: { addonGroupId: groupId, deletedAt: null }, select: { id: true } });
    const keep = new Set(data.addons.map((a) => a.id).filter(Boolean) as string[]);
    for (const ex of existing) if (!keep.has(ex.id)) await tx.addon.update({ where: { id: ex.id }, data: { deletedAt: new Date() } });
    for (let i = 0; i < data.addons.length; i++) {
      const a = data.addons[i]!;
      const values = { name: a.name, price: a.price, cost: a.cost, isAvailable: a.isAvailable, sortOrder: (i + 1) * 10 };
      if (a.id && existing.some((e) => e.id === a.id)) await tx.addon.update({ where: { id: a.id }, data: values });
      else await tx.addon.create({ data: { addonGroupId: groupId, ...values } });
    }
    await recordAudit(tx, ctx, {
      action: id ? "addon_group.update" : "addon_group.create",
      module: "menu",
      entityType: "addon_group",
      entityId: groupId,
      before,
      after: { name: data.name, min: data.minSelect, max: data.maxSelect, addons: data.addons.map((a) => `${a.name}=${new Prisma.Decimal(a.price).toFixed(2)}`) },
    });
    return { id: groupId };
  });
}

export async function archiveAddonGroup(ctx: Ctx, id: string): Promise<void> {
  authorize(ctx, "menu.manage");
  await withTransaction(async (tx) => {
    const g = await tx.addonGroup.findFirst({ where: { id, deletedAt: null }, include: { _count: { select: { products: true } } } });
    if (!g) throw notFound("Add-on group");
    if (g._count.products > 0) throw invalidState(`Remove “${g.name}” from its ${g._count.products} product(s) first.`);
    await tx.addonGroup.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await recordAudit(tx, ctx, { action: "addon_group.archive", module: "menu", entityType: "addon_group", entityId: id, before: { name: g.name } });
  });
}
