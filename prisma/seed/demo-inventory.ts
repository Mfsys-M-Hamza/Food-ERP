/**
 * Demo inventory: ingredients with opening stock, suppliers, recipes for the
 * demo menu, and a few received purchases. Skipped when ingredients exist.
 */
import { Prisma, type PrismaClient } from "../../src/generated/prisma/client";

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);

type I = [name: string, base: "g" | "ml" | "piece", opening: number, cost: number, min: number, category: string, supplier: string, units?: [string, number][]];

const INGREDIENTS: I[] = [
  ["Burger bun", "piece", 180, 25, 40, "Bakery", "Lahore Bakery Supplies", [["pack", 6]]],
  ["Pizza dough", "g", 15000, 0.12, 3000, "Bakery", "Lahore Bakery Supplies"],
  ["Chicken fillet", "piece", 150, 120, 30, "Meat", "Al-Madina Poultry", [["box", 50]]],
  ["Beef patty", "piece", 120, 140, 30, "Meat", "Al-Madina Poultry", [["box", 40]]],
  ["Chicken tikka", "g", 8000, 1.1, 2000, "Meat", "Al-Madina Poultry"],
  ["Chicken wings", "piece", 300, 35, 60, "Meat", "Al-Madina Poultry"],
  ["Chicken nuggets", "piece", 200, 20, 48, "Meat", "Al-Madina Poultry", [["bag", 50]]],
  ["Beef pepperoni", "g", 3000, 2.2, 600, "Meat", "Metro Cash & Carry"],
  ["Mozzarella cheese", "g", 10000, 1.6, 2000, "Dairy", "Metro Cash & Carry"],
  ["Cheddar slice", "piece", 300, 18, 60, "Dairy", "Metro Cash & Carry", [["pack", 24]]],
  ["Vanilla ice cream", "ml", 8000, 0.5, 2000, "Dairy", "Metro Cash & Carry"],
  ["Pizza sauce", "g", 6000, 0.4, 1000, "Sauces", "Metro Cash & Carry"],
  ["Burger sauce", "g", 5000, 0.8, 1000, "Sauces", "Metro Cash & Carry"],
  ["Garlic mayo", "g", 4000, 0.7, 1000, "Sauces", "Metro Cash & Carry"],
  ["Chipotle sauce", "g", 2000, 0.9, 500, "Sauces", "Metro Cash & Carry"],
  ["Ketchup sachet", "piece", 800, 3, 200, "Sauces", "Metro Cash & Carry", [["box", 200]]],
  ["Lettuce", "g", 3000, 0.5, 800, "Vegetables", "Fresh Veg Mandi"],
  ["Onion", "g", 8000, 0.15, 2000, "Vegetables", "Fresh Veg Mandi"],
  ["Jalapeño", "g", 2000, 1.2, 400, "Vegetables", "Metro Cash & Carry"],
  ["Capsicum", "g", 3000, 0.4, 800, "Vegetables", "Fresh Veg Mandi"],
  ["Mushrooms", "g", 2000, 1.4, 500, "Vegetables", "Fresh Veg Mandi"],
  ["Black olives", "g", 2000, 1.5, 500, "Vegetables", "Metro Cash & Carry"],
  ["Mint", "g", 1000, 1, 200, "Vegetables", "Fresh Veg Mandi"],
  ["Lemon", "piece", 100, 10, 20, "Vegetables", "Fresh Veg Mandi"],
  ["Frozen fries", "g", 25000, 0.35, 5000, "Frozen", "Metro Cash & Carry", [["carton", 10000]]],
  ["Cooking oil", "ml", 40000, 0.6, 10000, "Pantry", "Metro Cash & Carry", [["tin", 16000]]],
  ["Egg", "piece", 120, 25, 30, "Dairy", "Fresh Veg Mandi", [["tray", 30]]],
  ["Soft drink 345 ml", "piece", 240, 60, 48, "Drinks", "Metro Cash & Carry", [["crate", 24]]],
  ["Soft drink 500 ml", "piece", 120, 80, 24, "Drinks", "Metro Cash & Carry", [["crate", 12]]],
  ["Soft drink 1.5 L", "piece", 60, 160, 12, "Drinks", "Metro Cash & Carry", [["pack", 6]]],
  ["Mineral water 500 ml", "piece", 120, 45, 24, "Drinks", "Metro Cash & Carry", [["pack", 12]]],
  ["Soda water", "ml", 10000, 0.05, 2000, "Drinks", "Metro Cash & Carry"],
  ["Chocolate lava cake", "piece", 40, 150, 10, "Desserts", "Lahore Bakery Supplies"],
  ["Brownie", "piece", 40, 110, 10, "Desserts", "Lahore Bakery Supplies"],
  ["Chocolate sauce", "ml", 2000, 0.8, 400, "Desserts", "Metro Cash & Carry"],
  ["Burger box", "piece", 500, 8, 100, "Packaging", "PackPro Packaging", [["bundle", 100]]],
  ["Pizza box", "piece", 300, 25, 60, "Packaging", "PackPro Packaging", [["bundle", 50]]],
  ["Fries bag", "piece", 600, 3, 100, "Packaging", "PackPro Packaging", [["bundle", 200]]],
];

const SUPPLIERS: [string, string, string, number][] = [
  ["Al-Madina Poultry", "Haji Rafiq", "+923211234001", 7],
  ["Lahore Bakery Supplies", "Imran Butt", "+923211234002", 0],
  ["Metro Cash & Carry", "Accounts desk", "+924235711111", 0],
  ["PackPro Packaging", "Sohail Akhtar", "+923211234004", 15],
  ["Fresh Veg Mandi", "Nadeem", "+923211234005", 0],
];

type R = [ingredient: string, qty: number][];
const burger = (protein: R): R => [["Burger bun", 1], ...protein, ["Burger box", 1]];
const pizza = (size: "S" | "M" | "L", toppings: R): R => {
  const k = size === "S" ? 0.6 : size === "L" ? 1.4 : 1;
  return [["Pizza dough", 250 * k], ["Pizza sauce", 80 * k], ["Mozzarella cheese", 120 * k], ...toppings.map(([n, q]) => [n, Math.round(q * k)] as [string, number]), ["Pizza box", 1]];
};

/** Recipes by product SKU (base) or "SKU:Variant name". */
const RECIPES: Record<string, R> = {
  "BRG-ZNG": burger([["Chicken fillet", 1], ["Burger sauce", 20], ["Cheddar slice", 1], ["Lettuce", 15], ["Cooking oil", 60]]),
  "BRG-SMS:Single": burger([["Beef patty", 1], ["Cheddar slice", 1], ["Onion", 25], ["Burger sauce", 20]]),
  "BRG-SMS:Double": burger([["Beef patty", 2], ["Cheddar slice", 2], ["Onion", 30], ["Burger sauce", 25]]),
  "BRG-TKA": burger([["Chicken tikka", 120], ["Onion", 25], ["Garlic mayo", 20]]),
  "BRG-SUP": burger([["Chicken fillet", 1], ["Cheddar slice", 1], ["Jalapeño", 10], ["Chipotle sauce", 20], ["Cooking oil", 60]]),
  "PZA-TKA:Small": pizza("S", [["Chicken tikka", 100], ["Onion", 40]]),
  "PZA-TKA:Medium": pizza("M", [["Chicken tikka", 100], ["Onion", 40]]),
  "PZA-TKA:Large": pizza("L", [["Chicken tikka", 100], ["Onion", 40]]),
  "PZA-FJT:Small": pizza("S", [["Chicken tikka", 90], ["Capsicum", 40], ["Onion", 30]]),
  "PZA-FJT:Medium": pizza("M", [["Chicken tikka", 90], ["Capsicum", 40], ["Onion", 30]]),
  "PZA-FJT:Large": pizza("L", [["Chicken tikka", 90], ["Capsicum", 40], ["Onion", 30]]),
  "PZA-PEP:Small": pizza("S", [["Beef pepperoni", 70], ["Mozzarella cheese", 30]]),
  "PZA-PEP:Medium": pizza("M", [["Beef pepperoni", 70], ["Mozzarella cheese", 30]]),
  "PZA-PEP:Large": pizza("L", [["Beef pepperoni", 70], ["Mozzarella cheese", 30]]),
  "PZA-VEG:Small": pizza("S", [["Black olives", 30], ["Mushrooms", 40], ["Capsicum", 40], ["Onion", 30]]),
  "PZA-VEG:Medium": pizza("M", [["Black olives", 30], ["Mushrooms", 40], ["Capsicum", 40], ["Onion", 30]]),
  "PZA-VEG:Large": pizza("L", [["Black olives", 30], ["Mushrooms", 40], ["Capsicum", 40], ["Onion", 30]]),
  "DEAL-SOLO": [["Frozen fries", 150], ["Fries bag", 1], ["Cooking oil", 40], ["Soft drink 345 ml", 1]],
  "DEAL-DUO": [...burger([["Chicken fillet", 1], ["Burger sauce", 20], ["Lettuce", 15]]).map(([n, q]) => [n, q * 2] as [string, number]), ["Frozen fries", 250], ["Fries bag", 1], ["Cooking oil", 160], ["Soft drink 345 ml", 2]],
  "DEAL-FAM": [...pizza("M", [["Chicken tikka", 100], ["Onion", 40]]).map(([n, q]) => [n, q * 2] as [string, number]), ["Chicken wings", 6], ["Soft drink 1.5 L", 1]],
  "SD-FRY:Regular": [["Frozen fries", 150], ["Cooking oil", 40], ["Fries bag", 1]],
  "SD-FRY:Large": [["Frozen fries", 250], ["Cooking oil", 60], ["Fries bag", 1]],
  "SD-LDF": [["Frozen fries", 200], ["Cooking oil", 50], ["Mozzarella cheese", 60], ["Jalapeño", 15], ["Chicken tikka", 60], ["Fries bag", 1]],
  "SD-WNG:6 pieces": [["Chicken wings", 6], ["Cooking oil", 80]],
  "SD-WNG:12 pieces": [["Chicken wings", 12], ["Cooking oil", 150]],
  "SD-NUG": [["Chicken nuggets", 6], ["Cooking oil", 50]],
  "DR-SFT:345 ml": [["Soft drink 345 ml", 1]],
  "DR-SFT:500 ml": [["Soft drink 500 ml", 1]],
  "DR-SFT:1.5 L": [["Soft drink 1.5 L", 1]],
  "DR-WTR": [["Mineral water 500 ml", 1]],
  "DR-MNT": [["Mint", 10], ["Lemon", 1], ["Soda water", 250]],
  "DS-LAVA": [["Chocolate lava cake", 1]],
  "DS-BRW": [["Brownie", 1], ["Vanilla ice cream", 80], ["Chocolate sauce", 20]],
  "DS-SUN": [["Vanilla ice cream", 150], ["Chocolate sauce", 25]],
};

/** Add-on recipes by add-on name within its group. */
const ADDON_RECIPES: Record<string, R> = {
  "Burger extras/Extra cheese slice": [["Cheddar slice", 1]],
  "Burger extras/Extra patty": [["Beef patty", 1]],
  "Burger extras/Jalapeños": [["Jalapeño", 15]],
  "Burger extras/Fried egg": [["Egg", 1], ["Cooking oil", 10]],
  "Pizza toppings/Extra cheese": [["Mozzarella cheese", 60]],
  "Pizza toppings/Olives": [["Black olives", 30]],
  "Pizza toppings/Mushrooms": [["Mushrooms", 40]],
  "Pizza toppings/Jalapeños": [["Jalapeño", 20]],
  "Pizza toppings/Chicken tikka": [["Chicken tikka", 80]],
  "Dips & sauces/Garlic mayo": [["Garlic mayo", 30]],
  "Dips & sauces/Chipotle sauce": [["Chipotle sauce", 30]],
  "Dips & sauces/Ketchup": [["Ketchup sachet", 2]],
  "Make it a meal/Regular fries + drink": [["Frozen fries", 150], ["Fries bag", 1], ["Cooking oil", 40], ["Soft drink 345 ml", 1]],
  "Deal burger choice/Zinger burger": burger([["Chicken fillet", 1], ["Burger sauce", 20], ["Lettuce", 15], ["Cooking oil", 60]]),
  "Deal burger choice/Beef smash burger": burger([["Beef patty", 1], ["Cheddar slice", 1], ["Burger sauce", 20]]),
};

const REMOVABLE_LINKS: Record<string, string> = {
  "No mayo": "Burger sauce",
  "No lettuce": "Lettuce",
  "No onions": "Onion",
  "No jalapeños": "Jalapeño",
  "No raita": "Garlic mayo",
  "No capsicum": "Capsicum",
  "No olives": "Black olives",
  "No mushrooms": "Mushrooms",
};

async function move(
  db: PrismaClient,
  branchId: string,
  ingredientId: string,
  type: "OPENING" | "PURCHASE",
  qty: Prisma.Decimal,
  unitCost: Prisma.Decimal,
  at: Date,
  ref?: { type: string; id: string; reason: string },
) {
  const stock = await db.ingredientStock.findUnique({ where: { branchId_ingredientId: { branchId, ingredientId } } });
  const before = stock?.onHand ?? D(0);
  const after = before.plus(qty);
  const ing = await db.ingredient.findUniqueOrThrow({ where: { id: ingredientId } });
  const avg = before.lessThanOrEqualTo(0) ? unitCost : before.times(ing.averageCost).plus(qty.times(unitCost)).dividedBy(after);
  await db.ingredient.update({ where: { id: ingredientId }, data: { averageCost: avg.toDecimalPlaces(4), lastPurchaseCost: unitCost } });
  await db.ingredientStock.upsert({
    where: { branchId_ingredientId: { branchId, ingredientId } },
    create: { branchId, ingredientId, onHand: after },
    update: { onHand: after },
  });
  await db.inventoryTransaction.create({
    data: {
      branchId,
      ingredientId,
      type,
      quantity: qty,
      unitCost,
      totalCost: qty.times(unitCost).toDecimalPlaces(2),
      balanceAfter: after,
      referenceType: ref?.type,
      referenceId: ref?.id,
      reason: ref?.reason ?? "Opening stock",
      createdAt: at,
    },
  });
}

export async function seedDemoInventory(db: PrismaClient, branchId: string, log: (m: string) => void) {
  if ((await db.ingredient.count()) > 0) return log("• Ingredients exist — demo inventory skipped");
  const products = await db.product.findMany({ include: { variants: true, removables: true } });
  if (products.length === 0) return log("• No menu — demo inventory skipped");

  const supplierIds = new Map<string, string>();
  for (const [name, contact, phone, terms] of SUPPLIERS) {
    const s = await db.supplier.create({ data: { name, contactPerson: contact, phone, whatsapp: phone, paymentTermsDays: terms } });
    supplierIds.set(name, s.id);
  }

  const ids = new Map<string, string>();
  const opening = new Date(Date.now() - 21 * 86_400_000);
  for (const [name, base, qty, cost, min, category, supplier, units] of INGREDIENTS) {
    const i = await db.ingredient.create({
      data: {
        name,
        baseUnit: base,
        category,
        minStock: min,
        reorderQty: min * 3,
        defaultSupplierId: supplierIds.get(supplier),
        units: units ? { create: units.map(([unit, factor]) => ({ unit, factorToBase: factor })) } : undefined,
      },
    });
    ids.set(name, i.id);
    await db.supplierIngredient.create({ data: { supplierId: supplierIds.get(supplier)!, ingredientId: i.id, lastUnitCost: cost } });
    await move(db, branchId, i.id, "OPENING", D(qty), D(cost), opening);
  }

  // Recipes
  const recipeIdFor = new Map<string, string>();
  for (const [key, items] of Object.entries(RECIPES)) {
    const [sku, variantName] = key.split(":");
    const p = products.find((x) => x.sku === sku);
    if (!p) continue;
    const variant = variantName ? p.variants.find((v) => v.name === variantName) : null;
    if (variantName && !variant) continue;
    const merged = new Map<string, number>();
    for (const [n, q] of items) merged.set(n, (merged.get(n) ?? 0) + q);
    const r = await db.recipe.create({
      data: {
        ...(variant ? { variantId: variant.id } : { productId: p.id }),
        items: { create: [...merged].map(([n, q]) => ({ ingredientId: ids.get(n)!, quantity: q })) },
      },
    });
    recipeIdFor.set(key, r.id);
  }
  const groups = await db.addonGroup.findMany({ include: { addons: true } });
  for (const [key, items] of Object.entries(ADDON_RECIPES)) {
    const [gName, aName] = key.split("/");
    const addon = groups.find((g) => g.name === gName)?.addons.find((a) => a.name === aName);
    if (!addon) continue;
    const merged = new Map<string, number>();
    for (const [n, q] of items) merged.set(n, (merged.get(n) ?? 0) + q);
    await db.recipe.create({ data: { addonId: addon.id, items: { create: [...merged].map(([n, q]) => ({ ingredientId: ids.get(n)!, quantity: q })) } } });
  }
  for (const p of products) {
    for (const r of p.removables) {
      const ing = REMOVABLE_LINKS[r.label];
      if (ing) await db.productRemovableOption.update({ where: { id: r.id }, data: { ingredientId: ids.get(ing) } });
    }
  }

  // Received purchases in the last two weeks (some unpaid)
  const purchases: [supplier: string, daysAgo: number, paid: number, lines: [string, number, string, number][]][] = [
    ["Al-Madina Poultry", 12, 1, [["Chicken fillet", 2, "box", 6000], ["Chicken wings", 200, "piece", 34]]],
    ["Metro Cash & Carry", 9, 1, [["Mozzarella cheese", 5, "kg", 1650], ["Frozen fries", 2, "carton", 3600], ["Cooking oil", 1, "tin", 9600]]],
    ["Lahore Bakery Supplies", 5, 0.5, [["Burger bun", 20, "pack", 150], ["Pizza dough", 10, "kg", 120]]],
    ["PackPro Packaging", 3, 0, [["Burger box", 3, "bundle", 820], ["Pizza box", 2, "bundle", 1300]]],
  ];
  let n = 0;
  for (const [supplier, daysAgo, paidShare, lines] of purchases) {
    n++;
    const at = new Date(Date.now() - daysAgo * 86_400_000);
    const supplierId = supplierIds.get(supplier)!;
    const items = await Promise.all(
      lines.map(async ([name, qty, unit, unitCost]) => {
        const id = ids.get(name)!;
        const u = await db.ingredientUnit.findUnique({ where: { ingredientId_unit: { ingredientId: id, unit } } });
        const factor = u ? u.factorToBase : D(unit === "kg" ? 1000 : 1);
        return { ingredientId: id, quantity: D(qty), unit, factorToBase: factor, baseQuantity: D(qty).times(factor), unitCost: D(unitCost), lineTotal: D(qty).times(unitCost) };
      }),
    );
    const total = items.reduce((s, i) => s.plus(i.lineTotal), D(0));
    const paid = total.times(paidShare).toDecimalPlaces(0);
    const p = await db.purchase.create({
      data: {
        branchId,
        purchaseNumber: `PO-${String(n).padStart(5, "0")}`,
        supplierId,
        supplierInvoiceNo: `INV-${1000 + n}`,
        invoiceDate: at,
        status: "RECEIVED",
        paymentStatus: paidShare >= 1 ? "PAID" : paidShare > 0 ? "PARTIALLY_PAID" : "UNPAID",
        subtotal: total,
        total,
        amountPaid: paid,
        receivedAt: at,
        createdAt: at,
        items: { create: items },
      },
    });
    for (const i of items) {
      await move(db, branchId, i.ingredientId, "PURCHASE", i.baseQuantity, i.lineTotal.dividedBy(i.baseQuantity), at, { type: "purchase", id: p.id, reason: `Purchase ${p.purchaseNumber}` });
    }
    if (paid.greaterThan(0)) await db.supplierPayment.create({ data: { branchId, supplierId, purchaseId: p.id, amount: paid, method: "BANK_TRANSFER", paidAt: at } });
  }
  await db.numberSequence.upsert({
    where: { branchId_scope_periodKey: { branchId, scope: "PURCHASE", periodKey: "ALL" } },
    create: { branchId, scope: "PURCHASE", periodKey: "ALL", lastValue: n },
    update: { lastValue: n },
  });

  // Push recipe costs into the menu.
  const allRecipes = await db.recipe.findMany({ include: { items: { include: { ingredient: true } } } });
  for (const r of allRecipes) {
    const cost = r.items.reduce((s, i) => s.plus(i.quantity.times(i.ingredient.averageCost)), D(0)).toDecimalPlaces(4);
    if (r.variantId) await db.productVariant.update({ where: { id: r.variantId }, data: { cost } });
    else if (r.addonId) await db.addon.update({ where: { id: r.addonId }, data: { cost } });
    else if (r.productId) await db.product.update({ where: { id: r.productId }, data: { cost } });
  }
  for (const p of await db.product.findMany({ include: { variants: { orderBy: { sortOrder: "asc" } } } })) {
    const def = p.variants.find((v) => v.isDefault);
    if (def) await db.product.update({ where: { id: p.id }, data: { cost: def.cost } });
  }
  log(`✓ Demo inventory: ${INGREDIENTS.length} ingredients, ${SUPPLIERS.length} suppliers, ${recipeIdFor.size} recipes, ${purchases.length} purchases`);
}
