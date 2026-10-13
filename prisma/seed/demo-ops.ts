/** Demo delivery areas and customers (skipped when any exist). */
import type { PrismaClient } from "../../src/generated/prisma/client";

const ZONES = [
  { name: "DHA Phase 5", charge: 150, minimumOrder: 600, freeAbove: 3000, estimatedMinutes: 35 },
  { name: "Gulberg", charge: 120, minimumOrder: 500, freeAbove: 2500, estimatedMinutes: 30 },
  { name: "Model Town", charge: 180, minimumOrder: 700, freeAbove: null, estimatedMinutes: 45 },
  { name: "Johar Town", charge: 200, minimumOrder: 800, freeAbove: null, estimatedMinutes: 50 },
];

const CUSTOMERS = [
  { name: "Ali Raza", phone: "+923001110001", zone: "DHA Phase 5", address: "House 45, Street 12, DHA Phase 5", landmark: "Near Y-Block market" },
  { name: "Sana Tariq", phone: "+923001110002", zone: "Gulberg", address: "Flat 3B, Main Boulevard, Gulberg III", landmark: "Opposite MM Alam Road" },
  { name: "Usman Sheikh", phone: "+923001110003", zone: "Model Town", address: "12-C, Model Town", landmark: "Behind Model Town Park" },
  { name: "Hira Malik", phone: "+923001110004", zone: "Johar Town", address: "House 88, Block R2, Johar Town", landmark: "Near Emporium Mall" },
  { name: "Fahad Iqbal", phone: "+923001110005", zone: "Gulberg", address: "Office 7, Liberty Market, Gulberg", landmark: "" },
  { name: "Ayesha Noor", phone: "+923001110006", zone: "DHA Phase 5", address: "House 7, Street 3, DHA Phase 5", landmark: "" },
  { name: "Bilal Hussain", phone: "+923001110007", zone: null, address: "", landmark: "" },
  { name: "Zainab Ahmed", phone: "+923001110008", zone: null, address: "", landmark: "" },
];

export async function seedDemoOps(db: PrismaClient, branchId: string, log: (m: string) => void) {
  if ((await db.deliveryZone.count()) === 0) {
    for (const [i, z] of ZONES.entries()) {
      await db.deliveryZone.create({ data: { ...z, branchId, sortOrder: (i + 1) * 10 } });
    }
    log(`✓ Demo delivery areas: ${ZONES.length}`);
  }
  if ((await db.customer.count()) === 0) {
    const zones = await db.deliveryZone.findMany();
    for (const c of CUSTOMERS) {
      await db.customer.create({
        data: {
          name: c.name,
          phone: c.phone,
          marketingOptIn: true,
          addresses: c.address
            ? {
                create: [
                  {
                    addressLine: c.address,
                    landmark: c.landmark || null,
                    zoneId: zones.find((z) => z.name === c.zone)?.id ?? null,
                    isDefault: true,
                  },
                ],
              }
            : undefined,
        },
      });
    }
    log(`✓ Demo customers: ${CUSTOMERS.length}`);
  }
}
