import "server-only";
import { db } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";
import { publicContext } from "@/server/core/context";
import { authorize } from "@/server/core/rbac";
import { getCatalog } from "@/server/modules/menu/catalog";
import { getSetting } from "@/server/modules/settings/service";
import { listZones } from "@/server/modules/delivery/zones";
import { listTerminals } from "@/server/modules/shifts/service";

/** Everything the POS needs in one request. */
export async function getPosBootstrap(ctx: Ctx) {
  authorize(ctx, "pos.use");
  const [catalog, finance, ordering, pos, delivery, receipt, profile, terminals, zones, staff] = await Promise.all([
    getCatalog("POS"),
    getSetting("finance"),
    getSetting("ordering"),
    getSetting("pos"),
    getSetting("delivery"),
    getSetting("receipt"),
    getSetting("business.profile"),
    listTerminals(ctx),
    listZones(ctx.branchId, { activeOnly: true }),
    db.user.findMany({
      where: { kind: "STAFF", status: "ACTIVE", pinHash: { not: null } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return {
    catalog,
    settings: {
      businessName: profile.name,
      currencySymbol: finance.currencySymbol,
      finance: {
        taxEnabled: finance.taxEnabled,
        taxLabel: finance.taxLabel,
        taxRateCash: finance.taxRateCash,
        taxRateCard: finance.taxRateCard,
        pricesIncludeTax: finance.pricesIncludeTax,
        serviceChargeEnabled: finance.serviceChargeEnabled,
        serviceChargePercent: finance.serviceChargePercent,
        cashRoundingStep: finance.cashRoundingStep,
      },
      ordering: {
        takeawayEnabled: ordering.takeawayEnabled,
        deliveryEnabled: ordering.deliveryEnabled,
        dineInEnabled: ordering.dineInEnabled,
        splitPaymentEnabled: ordering.splitPaymentEnabled,
      },
      pos: {
        cashierMaxDiscountPercent: pos.cashierMaxDiscountPercent,
        autoPrintReceipt: pos.autoPrintReceipt,
        autoPrintKitchenTicket: pos.autoPrintKitchenTicket,
        lockAfterIdleMinutes: pos.lockAfterIdleMinutes,
      },
      delivery: { defaultCharge: delivery.defaultCharge, minimumOrder: delivery.minimumOrder, freeDeliveryAbove: delivery.freeDeliveryAbove },
      receipt: { paperWidth: receipt.paperWidth },
    },
    terminals,
    zones,
    staff,
    me: publicContext(ctx),
  };
}

export type PosBootstrap = Awaited<ReturnType<typeof getPosBootstrap>>;
