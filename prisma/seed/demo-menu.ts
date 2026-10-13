/**
 * Demo menu for a Pakistani fast-food restaurant. Runs only when the database
 * has no products yet, so it never overwrites real data.
 */
import type { PrismaClient } from "../../src/generated/prisma/client";

type V = { name: string; price: number; cost: number; isDefault?: boolean };
type P = {
  name: string;
  sku: string;
  price: number;
  cost: number;
  prep: number;
  description: string;
  type?: "SIMPLE" | "DEAL";
  featured?: boolean;
  variants?: V[];
  groups?: string[];
  removables?: string[];
};

const GROUPS: { key: string; name: string; title: string; min: number; max: number; addons: [string, number, number][] }[] = [
  { key: "burger-extras", name: "Burger extras", title: "Add extras?", min: 0, max: 4, addons: [["Extra cheese slice", 80, 30], ["Extra patty", 250, 120], ["Jalapeños", 50, 15], ["Fried egg", 60, 25]] },
  { key: "pizza-toppings", name: "Pizza toppings", title: "Extra toppings", min: 0, max: 5, addons: [["Extra cheese", 150, 70], ["Olives", 100, 40], ["Mushrooms", 100, 45], ["Jalapeños", 80, 25], ["Chicken tikka", 200, 95]] },
  { key: "dips", name: "Dips & sauces", title: "Add a dip", min: 0, max: 3, addons: [["Garlic mayo", 50, 15], ["Chipotle sauce", 50, 15], ["Ketchup", 0, 3]] },
  { key: "drink-choice", name: "Choose your drink", title: "Choose your drink", min: 1, max: 1, addons: [["Coca-Cola", 0, 45], ["Sprite", 0, 45], ["Fanta", 0, 45], ["Mineral water", 0, 30]] },
  { key: "flavour", name: "Soft drink flavour", title: "Choose flavour", min: 1, max: 1, addons: [["Coca-Cola", 0, 0], ["Sprite", 0, 0], ["Fanta", 0, 0]] },
  { key: "meal", name: "Make it a meal", title: "Make it a meal?", min: 0, max: 1, addons: [["Regular fries + drink", 299, 110]] },
  { key: "deal-burger", name: "Deal burger choice", title: "Choose your burger", min: 1, max: 1, addons: [["Zinger burger", 0, 230], ["Beef smash burger", 100, 290]] },
];

const MENU: { category: string; description: string; products: P[] }[] = [
  {
    category: "Burgers",
    description: "Freshly fried and grilled, made to order",
    products: [
      { name: "Zinger Burger", sku: "BRG-ZNG", price: 590, cost: 230, prep: 8, featured: true, description: "Crispy spiced chicken fillet, lettuce and house mayo in a toasted bun.", groups: ["burger-extras", "dips", "meal"], removables: ["No mayo", "No lettuce"] },
      { name: "Beef Smash Burger", sku: "BRG-SMS", price: 690, cost: 290, prep: 10, description: "Smashed beef patty, cheddar, caramelised onions, pickles and smash sauce.", variants: [{ name: "Single", price: 690, cost: 290, isDefault: true }, { name: "Double", price: 990, cost: 430 }], groups: ["burger-extras", "dips", "meal"], removables: ["No onions", "No pickles"] },
      { name: "Chicken Tikka Burger", sku: "BRG-TKA", price: 550, cost: 210, prep: 9, description: "Charcoal tikka chicken with mint raita and onion rings.", groups: ["burger-extras", "meal"], removables: ["No onions", "No raita"] },
      { name: "Crispy Supreme", sku: "BRG-SUP", price: 650, cost: 260, prep: 9, description: "Double-crunch chicken, cheese, jalapeños and chipotle sauce.", groups: ["burger-extras", "dips", "meal"], removables: ["No jalapeños"] },
    ],
  },
  {
    category: "Pizza",
    description: "Hand-stretched dough, stone-baked",
    products: [
      { name: "Chicken Tikka Pizza", sku: "PZA-TKA", price: 1299, cost: 520, prep: 15, featured: true, description: "Tikka chicken, onions, green chillies and mozzarella.", variants: [{ name: "Small", price: 799, cost: 320 }, { name: "Medium", price: 1299, cost: 520, isDefault: true }, { name: "Large", price: 1799, cost: 720 }], groups: ["pizza-toppings"], removables: ["No onions", "No green chillies"] },
      { name: "Chicken Fajita Pizza", sku: "PZA-FJT", price: 1299, cost: 510, prep: 15, description: "Fajita chicken, capsicum, onions and mozzarella.", variants: [{ name: "Small", price: 799, cost: 315 }, { name: "Medium", price: 1299, cost: 510, isDefault: true }, { name: "Large", price: 1799, cost: 710 }], groups: ["pizza-toppings"], removables: ["No capsicum"] },
      { name: "Beef Pepperoni Pizza", sku: "PZA-PEP", price: 1399, cost: 580, prep: 15, description: "Beef pepperoni and double mozzarella.", variants: [{ name: "Small", price: 899, cost: 360 }, { name: "Medium", price: 1399, cost: 580, isDefault: true }, { name: "Large", price: 1899, cost: 790 }], groups: ["pizza-toppings"] },
      { name: "Veggie Supreme Pizza", sku: "PZA-VEG", price: 1099, cost: 400, prep: 14, description: "Olives, mushrooms, sweetcorn, capsicum and onions.", variants: [{ name: "Small", price: 699, cost: 250 }, { name: "Medium", price: 1099, cost: 400, isDefault: true }, { name: "Large", price: 1599, cost: 580 }], groups: ["pizza-toppings"], removables: ["No olives", "No mushrooms"] },
    ],
  },
  {
    category: "Deals",
    description: "Better together",
    products: [
      { name: "Solo Deal", sku: "DEAL-SOLO", type: "DEAL", price: 899, cost: 360, prep: 10, featured: true, description: "Any burger, regular fries and a drink.", groups: ["deal-burger", "drink-choice", "dips"] },
      { name: "Duo Deal", sku: "DEAL-DUO", type: "DEAL", price: 1690, cost: 690, prep: 12, description: "2 Zinger burgers, large fries and 2 drinks.", groups: ["drink-choice"] },
      { name: "Family Pizza Deal", sku: "DEAL-FAM", type: "DEAL", price: 2999, cost: 1250, prep: 18, featured: true, description: "2 medium pizzas, 6 wings and a 1.5 L drink.", groups: ["drink-choice"] },
    ],
  },
  {
    category: "Fries & Sides",
    description: "Perfect partners",
    products: [
      { name: "French Fries", sku: "SD-FRY", price: 250, cost: 70, prep: 5, description: "Golden, salted fries.", variants: [{ name: "Regular", price: 250, cost: 70, isDefault: true }, { name: "Large", price: 390, cost: 110 }], groups: ["dips"] },
      { name: "Loaded Fries", sku: "SD-LDF", price: 550, cost: 190, prep: 7, description: "Fries with cheese sauce, jalapeños and chicken chunks.", groups: ["dips"], removables: ["No jalapeños"] },
      { name: "Hot Wings", sku: "SD-WNG", price: 590, cost: 240, prep: 10, description: "Crispy spicy wings.", variants: [{ name: "6 pieces", price: 590, cost: 240, isDefault: true }, { name: "12 pieces", price: 1090, cost: 470 }], groups: ["dips"] },
      { name: "Chicken Nuggets", sku: "SD-NUG", price: 450, cost: 170, prep: 6, description: "6 crunchy nuggets.", groups: ["dips"] },
    ],
  },
  {
    category: "Drinks",
    description: "Chilled",
    products: [
      { name: "Soft Drink", sku: "DR-SFT", price: 120, cost: 60, prep: 1, description: "Coca-Cola, Sprite or Fanta.", variants: [{ name: "345 ml", price: 120, cost: 60, isDefault: true }, { name: "500 ml", price: 160, cost: 80 }, { name: "1.5 L", price: 280, cost: 160 }], groups: ["flavour"] },
      { name: "Mineral Water", sku: "DR-WTR", price: 100, cost: 45, prep: 1, description: "500 ml bottle." },
      { name: "Mint Margarita", sku: "DR-MNT", price: 350, cost: 90, prep: 4, description: "Fresh mint, lemon and soda." },
    ],
  },
  {
    category: "Desserts",
    description: "Something sweet",
    products: [
      { name: "Chocolate Lava Cake", sku: "DS-LAVA", price: 450, cost: 150, prep: 6, description: "Warm cake with a molten centre." },
      { name: "Brownie with Ice Cream", sku: "DS-BRW", price: 550, cost: 190, prep: 4, description: "Fudge brownie, vanilla ice cream, chocolate sauce." },
      { name: "Ice Cream Sundae", sku: "DS-SUN", price: 350, cost: 110, prep: 3, description: "Vanilla, chocolate sauce and nuts." },
    ],
  },
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export async function seedDemoMenu(db: PrismaClient, log: (m: string) => void) {
  if ((await db.product.count()) > 0) {
    log("• Menu exists — demo menu skipped");
    return;
  }
  const groupIds = new Map<string, string>();
  for (const [i, g] of GROUPS.entries()) {
    const created = await db.addonGroup.create({
      data: {
        name: g.name,
        title: g.title,
        minSelect: g.min,
        maxSelect: g.max,
        sortOrder: (i + 1) * 10,
        addons: { create: g.addons.map(([name, price, cost], j) => ({ name, price, cost, sortOrder: (j + 1) * 10 })) },
      },
    });
    groupIds.set(g.key, created.id);
  }

  let productCount = 0;
  for (const [ci, c] of MENU.entries()) {
    const category = await db.category.create({
      data: { name: c.category, slug: slug(c.category), description: c.description, sortOrder: (ci + 1) * 10 },
    });
    for (const [pi, p] of c.products.entries()) {
      await db.product.create({
        data: {
          categoryId: category.id,
          type: p.type ?? "SIMPLE",
          sku: p.sku,
          name: p.name,
          slug: slug(p.name),
          description: p.description,
          basePrice: p.price,
          cost: p.cost,
          prepTimeMinutes: p.prep,
          isFeatured: !!p.featured,
          sortOrder: (pi + 1) * 10,
          variants: p.variants
            ? { create: p.variants.map((v, vi) => ({ name: v.name, price: v.price, cost: v.cost, isDefault: !!v.isDefault, sortOrder: (vi + 1) * 10 })) }
            : undefined,
          addonGroups: p.groups
            ? { create: p.groups.map((g, gi) => ({ addonGroupId: groupIds.get(g)!, sortOrder: (gi + 1) * 10 })) }
            : undefined,
          removables: p.removables ? { create: p.removables.map((label, ri) => ({ label, sortOrder: (ri + 1) * 10 })) } : undefined,
        },
      });
      productCount++;
    }
  }
  log(`✓ Demo menu: ${MENU.length} categories, ${productCount} products, ${GROUPS.length} add-on groups`);
}
