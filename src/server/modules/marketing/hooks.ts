import "server-only";
import { onOrderStatusChange } from "@/server/modules/orders/hooks";
import { earnForOrder, reverseForOrder } from "./loyalty";
import { reverseCoupon } from "./coupons";

// Completed orders earn points; cancelled orders give back coupon uses and points.
onOrderStatusChange(async (tx, change) => {
  if (change.to === "COMPLETED") await earnForOrder(tx, change.orderId);
  if (change.to === "CANCELLED") {
    await reverseCoupon(tx, change.orderId);
    await reverseForOrder(tx, change.orderId, "Order cancelled");
  }
});
