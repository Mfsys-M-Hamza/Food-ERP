import "server-only";
import { db, type Db } from "@/server/core/db";

/**
 * Sellable menu for a channel (POS or ONLINE). Serialisable: money as strings.
 * Unavailable (out-of-stock) items are included with `isAvailable: false` so
 * screens can show them greyed out; hidden/archived items are excluded.
 */
export type CatalogAddon = { id: string; name: string; price: string; isAvailable: boolean };
export type CatalogAddonGroup = {
  id: string;
  name: string;
  title: string;
  minSelect: number;
  maxSelect: number;
  addons: CatalogAddon[];
};
export type CatalogVariant = { id: string; name: string; price: string; isDefault: boolean; isAvailable: boolean };
export type CatalogProduct = {
  id: string;
  categoryId: string;
  type: "SIMPLE" | "DEAL";
  sku: string;
  name: string;
  slug: string;
  description: string;
  imageUrl: string | null;
  price: string;
  prepTimeMinutes: number;
  isAvailable: boolean;
  isFeatured: boolean;
  variants: CatalogVariant[];
  addonGroups: CatalogAddonGroup[];
  removables: { id: string; label: string }[];
};
export type CatalogCategory = { id: string; name: string; slug: string; description: string; imageUrl: string | null };
export type Catalog = { categories: CatalogCategory[]; products: CatalogProduct[] };

export async function getCatalog(channel: "POS" | "ONLINE", client: Db = db): Promise<Catalog> {
  const [categories, products] = await Promise.all([
    client.category.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    client.product.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        category: { deletedAt: null, isActive: true },
        ...(channel === "POS" ? { showOnPos: true } : { showOnline: true }),
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        variants: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
        addonGroups: {
          where: { group: { deletedAt: null, isActive: true } },
          orderBy: { sortOrder: "asc" },
          include: { group: { include: { addons: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } } } } },
        },
        removables: { orderBy: { sortOrder: "asc" } },
      },
    }),
  ]);

  const usedCategoryIds = new Set(products.map((p) => p.categoryId));
  // "All" lists items grouped in category order, then by their position in the category.
  const categoryRank = new Map(categories.map((c, i) => [c.id, i]));
  products.sort((a, b) => (categoryRank.get(a.categoryId) ?? 999) - (categoryRank.get(b.categoryId) ?? 999) || a.sortOrder - b.sortOrder);
  return {
    categories: categories
      .filter((c) => usedCategoryIds.has(c.id))
      .map((c) => ({ id: c.id, name: c.name, slug: c.slug, description: c.description ?? "", imageUrl: c.imageUrl })),
    products: products.map((p) => ({
      id: p.id,
      categoryId: p.categoryId,
      type: p.type,
      sku: p.sku,
      name: p.name,
      slug: p.slug,
      description: p.description ?? "",
      imageUrl: p.imageUrl,
      price: p.basePrice.toFixed(2),
      prepTimeMinutes: p.prepTimeMinutes,
      isAvailable: p.isAvailable,
      isFeatured: p.isFeatured,
      variants: p.variants.map((v) => ({
        id: v.id,
        name: v.name,
        price: v.price.toFixed(2),
        isDefault: v.isDefault,
        isAvailable: v.isAvailable,
      })),
      addonGroups: p.addonGroups.map(({ group: g }) => ({
        id: g.id,
        name: g.name,
        title: g.title ?? g.name,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        addons: g.addons.map((a) => ({ id: a.id, name: a.name, price: a.price.toFixed(2), isAvailable: a.isAvailable })),
      })),
      removables: p.removables.map((r) => ({ id: r.id, label: r.label })),
    })),
  };
}
