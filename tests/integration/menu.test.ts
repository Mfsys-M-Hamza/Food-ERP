import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/core/db";
import {
  archiveCategory,
  archiveProduct,
  createCategory,
  createProduct,
  getProductForEditor,
  listProducts,
  saveAddonGroup,
  setAvailability,
  updateProduct,
} from "@/server/modules/menu/service";
import { getCatalog } from "@/server/modules/menu/catalog";
import { ctxForRole, resetDatabase } from "./helpers";
import type { Ctx } from "@/server/core/context";

let owner: Ctx;
let categoryId: string;

beforeEach(async () => {
  await resetDatabase();
  owner = await ctxForRole("owner");
  categoryId = (await createCategory(owner, { name: "Burgers" })).id;
});

const baseProduct = () => ({
  name: "Zinger Burger",
  categoryId,
  basePrice: "590",
  cost: "230",
  prepTimeMinutes: 8,
  variants: [],
  addonGroupIds: [],
  removables: [{ label: "No mayo" }],
});

describe("menu: products", () => {
  it("creates a product with generated SKU, slug and audit entry", async () => {
    const { id } = await createProduct(owner, baseProduct());
    const p = await getProductForEditor(owner, id);
    expect(p.sku).toBe("ZB-001");
    expect(p.basePrice).toBe("590.00");
    expect(p.removables.map((r) => r.label)).toEqual(["No mayo"]);
    const row = await db.product.findUniqueOrThrow({ where: { id } });
    expect(row.slug).toBe("zinger-burger");
    expect(await db.auditLog.count({ where: { action: "product.create", entityId: id } })).toBe(1);
  });

  it("requires exactly one default variant and unique variant names", async () => {
    const noDefault = await createProduct(owner, {
      ...baseProduct(),
      variants: [
        { name: "Small", price: "500" },
        { name: "Large", price: "800" },
      ],
    }).catch((e) => e);
    expect(noDefault.fieldErrors.variants).toBeDefined();

    const dup = await createProduct(owner, {
      ...baseProduct(),
      variants: [
        { name: "Large", price: "500", isDefault: true },
        { name: "large", price: "800" },
      ],
    }).catch((e) => e);
    expect(dup.fieldErrors.variants).toBeDefined();
  });

  it("uses the default variant price as the product price", async () => {
    const { id } = await createProduct(owner, {
      ...baseProduct(),
      name: "Tikka Pizza",
      variants: [
        { name: "Small", price: "799", cost: "320" },
        { name: "Medium", price: "1299", cost: "520", isDefault: true },
      ],
    });
    const row = await db.product.findUniqueOrThrow({ where: { id } });
    expect(row.basePrice.toFixed(2)).toBe("1299.00");
    const list = await listProducts(owner, {});
    expect(list[0]).toMatchObject({ minPrice: "799.00", maxPrice: "1299.00", variantCount: 2 });
  });

  it("audits price changes separately with old and new prices", async () => {
    const { id } = await createProduct(owner, baseProduct());
    const p = await getProductForEditor(owner, id);
    await updateProduct(owner, id, { ...p, basePrice: "620" });
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "product.price.change", entityId: id } });
    expect(audit.before).toMatchObject({ basePrice: "590.00" });
    expect(audit.after).toMatchObject({ basePrice: "620.00" });
  });

  it("blocks price changes for users without the price permission", async () => {
    const { id } = await createProduct(owner, baseProduct());
    const managerCtx = await ctxForRole("manager");
    const limited: Ctx = { ...managerCtx, permissions: new Set([...managerCtx.permissions].filter((k) => k !== "menu.price.change")) };
    const p = await getProductForEditor(owner, id);
    await expect(updateProduct(limited, id, { ...p, basePrice: "999" })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    // Non-price edits are fine.
    await expect(updateProduct(limited, id, { ...p, description: "Crispy" })).resolves.toEqual({ id });
  });

  it("archives variants instead of deleting them so order history stays valid", async () => {
    const { id } = await createProduct(owner, {
      ...baseProduct(),
      variants: [
        { name: "Single", price: "590", isDefault: true },
        { name: "Double", price: "890" },
      ],
    });
    const p = await getProductForEditor(owner, id);
    await updateProduct(owner, id, { ...p, variants: [p.variants[0]!] });
    expect(await db.productVariant.count({ where: { productId: id } })).toBe(2);
    expect((await getProductForEditor(owner, id)).variants).toHaveLength(1);
  });

  it("lets cashiers and kitchen toggle stock but not edit products", async () => {
    const { id } = await createProduct(owner, baseProduct());
    for (const role of ["cashier", "kitchen"]) {
      const ctx = await ctxForRole(role);
      await setAvailability(ctx, { productId: id, available: false });
      await expect(updateProduct(ctx, id, baseProduct())).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    }
    const rider = await ctxForRole("rider");
    await expect(setAvailability(rider, { productId: id, available: true })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect((await db.product.findUniqueOrThrow({ where: { id } })).isAvailable).toBe(false);
    expect(await db.auditLog.count({ where: { action: "product.out_of_stock" } })).toBe(2);
  });

  it("rejects duplicate SKUs", async () => {
    await createProduct(owner, { ...baseProduct(), sku: "BRG-1" });
    const err = await createProduct(owner, { ...baseProduct(), name: "Other", sku: "brg-1" }).catch((e) => e);
    expect(err.fieldErrors.sku).toBeDefined();
  });
});

describe("menu: categories and add-on groups", () => {
  it("rejects duplicate category names and protects categories with products", async () => {
    await expect(createCategory(owner, { name: "burgers" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await createProduct(owner, baseProduct());
    await expect(archiveCategory(owner, categoryId)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("validates add-on group selection rules", async () => {
    const err = await saveAddonGroup(owner, null, {
      name: "Drinks",
      minSelect: 3,
      maxSelect: 1,
      addons: [{ name: "Coke", price: "0" }],
    }).catch((e) => e);
    expect(err.fieldErrors.minSelect).toBeDefined();
    await expect(saveAddonGroup(owner, null, { name: "Empty", minSelect: 0, maxSelect: 1, addons: [] })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });

  it("builds a channel catalog without hidden or archived items", async () => {
    const group = await saveAddonGroup(owner, null, {
      name: "Choose drink",
      minSelect: 1,
      maxSelect: 1,
      addons: [
        { name: "Coke", price: "0" },
        { name: "Sprite", price: "0" },
      ],
    });
    const a = await createProduct(owner, { ...baseProduct(), addonGroupIds: [group.id] });
    await createProduct(owner, { ...baseProduct(), name: "Online only", showOnPos: false });
    const archived = await createProduct(owner, { ...baseProduct(), name: "Old item" });
    await archiveProduct(owner, archived.id);

    const pos = await getCatalog("POS");
    expect(pos.products.map((p) => p.name)).toEqual(["Zinger Burger"]);
    expect(pos.products[0]!.addonGroups[0]).toMatchObject({ minSelect: 1, maxSelect: 1 });
    expect(pos.products[0]!.addonGroups[0]!.addons.map((x) => x.name)).toEqual(["Coke", "Sprite"]);
    const online = await getCatalog("ONLINE");
    expect(online.products.map((p) => p.name).sort()).toEqual(["Online only", "Zinger Burger"]);
    expect(a.id).toBeTruthy();
  });
});
