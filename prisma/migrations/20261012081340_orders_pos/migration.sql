-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('POS', 'PHONE', 'WEBSITE', 'PWA', 'ADMIN', 'AGGREGATOR');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('TAKEAWAY', 'DELIVERY', 'DINE_IN');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('NEW', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'COMPLETED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'ONLINE', 'WALLET', 'LOYALTY');

-- CreateEnum
CREATE TYPE "PaymentRecordStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'VOIDED');

-- CreateEnum
CREATE TYPE "DiscountKind" AS ENUM ('MANUAL', 'COUPON', 'LOYALTY', 'PROMOTION');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'RETURNED');

-- CreateEnum
CREATE TYPE "CashShiftStatus" AS ENUM ('OPEN', 'CLOSED', 'APPROVED');

-- CreateEnum
CREATE TYPE "CashTxType" AS ENUM ('SALE', 'REFUND', 'EXPENSE', 'PAY_IN', 'PAY_OUT', 'RIDER_SETTLEMENT', 'SUPPLIER_PAYMENT', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "is_blocked" BOOLEAN NOT NULL DEFAULT false,
    "block_reason" TEXT,
    "marketing_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "total_orders" INTEGER NOT NULL DEFAULT 0,
    "total_spent" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "last_order_at" TIMESTAMPTZ(6),
    "loyalty_points" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_addresses" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Home',
    "address_line" TEXT NOT NULL,
    "area" TEXT,
    "city" TEXT,
    "landmark" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "map_url" TEXT,
    "zone_id" UUID,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_zones" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "charge" DECIMAL(12,2) NOT NULL,
    "minimum_order" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "free_above" DECIMAL(12,2),
    "estimated_minutes" INTEGER NOT NULL DEFAULT 45,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "delivery_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "order_number" TEXT NOT NULL,
    "display_number" INTEGER NOT NULL,
    "business_date" DATE NOT NULL,
    "source" "OrderSource" NOT NULL,
    "type" "OrderType" NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "customer_id" UUID,
    "customer_name" TEXT,
    "customer_phone" TEXT,
    "table_label" TEXT,
    "created_by" UUID,
    "cash_shift_id" UUID,
    "terminal_id" UUID,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discount_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "service_charge" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "delivery_charge" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "tax_inclusive" BOOLEAN NOT NULL DEFAULT false,
    "rounding_adjustment" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "grand_total" DECIMAL(12,2) NOT NULL,
    "amount_paid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "amount_refunded" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "estimated_cost_total" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "coupon_id" UUID,
    "loyalty_points_redeemed" INTEGER NOT NULL DEFAULT 0,
    "customer_note" TEXT,
    "kitchen_note" TEXT,
    "estimated_ready_at" TIMESTAMPTZ(6),
    "scheduled_for" TIMESTAMPTZ(6),
    "accepted_at" TIMESTAMPTZ(6),
    "preparing_at" TIMESTAMPTZ(6),
    "ready_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" TEXT,
    "cancelled_by" UUID,
    "stock_deducted_at" TIMESTAMPTZ(6),
    "idempotency_key" TEXT NOT NULL,
    "tracking_token" TEXT NOT NULL,
    "offline_created_at" TIMESTAMPTZ(6),
    "sync_flags" JSONB,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "product_name" TEXT NOT NULL,
    "variant_name" TEXT,
    "sku" TEXT NOT NULL,
    "category_id" UUID,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "addons_unit_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(12,2) NOT NULL,
    "unit_cost_estimate" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "note" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item_addons" (
    "id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "addon_id" UUID NOT NULL,
    "group_name" TEXT NOT NULL,
    "addon_name" TEXT NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_cost_estimate" DECIMAL(14,4) NOT NULL DEFAULT 0,

    CONSTRAINT "order_item_addons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item_removals" (
    "id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "removable_option_id" UUID,
    "label" TEXT NOT NULL,

    CONSTRAINT "order_item_removals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "from_status" "OrderStatus",
    "to_status" "OrderStatus" NOT NULL,
    "changed_by" UUID,
    "source" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_discounts" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "kind" "DiscountKind" NOT NULL,
    "coupon_id" UUID,
    "percent" DECIMAL(5,2),
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT,
    "applied_by" UUID,
    "approved_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_discounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "cash_shift_id" UUID,
    "method" "PaymentMethod" NOT NULL,
    "provider" TEXT,
    "provider_reference" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "tendered" DECIMAL(12,2),
    "change_given" DECIMAL(12,2),
    "status" "PaymentRecordStatus" NOT NULL DEFAULT 'SUCCEEDED',
    "received_by" UUID,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "refund_number" TEXT NOT NULL,
    "order_id" UUID NOT NULL,
    "payment_id" UUID,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reason" TEXT NOT NULL,
    "restock" BOOLEAN NOT NULL DEFAULT false,
    "requested_by" UUID,
    "approved_by" UUID,
    "cash_shift_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliveries" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "zone_id" UUID,
    "rider_id" UUID,
    "recipient_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address_text" TEXT NOT NULL,
    "landmark" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "map_url" TEXT,
    "delivery_charge" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "assigned_at" TIMESTAMPTZ(6),
    "dispatched_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "cod_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cod_collected_at" TIMESTAMPTZ(6),
    "cod_settled_shift_id" UUID,
    "cod_settled_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "held_orders" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "terminal_id" UUID,
    "label" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "item_count" INTEGER NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "held_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_shifts" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "terminal_id" UUID NOT NULL,
    "shift_number" TEXT NOT NULL,
    "opened_by" UUID NOT NULL,
    "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opening_cash" DECIMAL(12,2) NOT NULL,
    "closed_by" UUID,
    "closed_at" TIMESTAMPTZ(6),
    "expected_cash" DECIMAL(12,2),
    "counted_cash" DECIMAL(12,2),
    "difference" DECIMAL(12,2),
    "denomination_breakdown" JSONB,
    "status" "CashShiftStatus" NOT NULL DEFAULT 'OPEN',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "closing_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cash_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_transactions" (
    "id" UUID NOT NULL,
    "cash_shift_id" UUID NOT NULL,
    "type" "CashTxType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "throttles" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "window_start" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "throttles_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_user_id_key" ON "customers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_phone_key" ON "customers"("phone");

-- CreateIndex
CREATE INDEX "customers_name_idx" ON "customers"("name");

-- CreateIndex
CREATE INDEX "customers_last_order_at_idx" ON "customers"("last_order_at");

-- CreateIndex
CREATE INDEX "customer_addresses_customer_id_idx" ON "customer_addresses"("customer_id");

-- CreateIndex
CREATE INDEX "delivery_zones_branch_id_is_active_idx" ON "delivery_zones"("branch_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_idempotency_key_key" ON "orders"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tracking_token_key" ON "orders"("tracking_token");

-- CreateIndex
CREATE INDEX "orders_branch_id_status_created_at_idx" ON "orders"("branch_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "orders_branch_id_business_date_idx" ON "orders"("branch_id", "business_date");

-- CreateIndex
CREATE INDEX "orders_customer_id_created_at_idx" ON "orders"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_cash_shift_id_idx" ON "orders"("cash_shift_id");

-- CreateIndex
CREATE INDEX "orders_created_at_idx" ON "orders"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_branch_id_business_date_display_number_key" ON "orders"("branch_id", "business_date", "display_number");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_items_product_id_idx" ON "order_items"("product_id");

-- CreateIndex
CREATE INDEX "order_item_addons_order_item_id_idx" ON "order_item_addons"("order_item_id");

-- CreateIndex
CREATE INDEX "order_item_removals_order_item_id_idx" ON "order_item_removals"("order_item_id");

-- CreateIndex
CREATE INDEX "order_status_history_order_id_created_at_idx" ON "order_status_history"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "order_discounts_order_id_idx" ON "order_discounts"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");

-- CreateIndex
CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");

-- CreateIndex
CREATE INDEX "payments_cash_shift_id_idx" ON "payments"("cash_shift_id");

-- CreateIndex
CREATE INDEX "payments_created_at_idx" ON "payments"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_provider_reference_key" ON "payments"("provider", "provider_reference");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_refund_number_key" ON "refunds"("refund_number");

-- CreateIndex
CREATE INDEX "refunds_order_id_idx" ON "refunds"("order_id");

-- CreateIndex
CREATE INDEX "refunds_created_at_idx" ON "refunds"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_order_id_key" ON "deliveries"("order_id");

-- CreateIndex
CREATE INDEX "deliveries_rider_id_status_idx" ON "deliveries"("rider_id", "status");

-- CreateIndex
CREATE INDEX "deliveries_status_idx" ON "deliveries"("status");

-- CreateIndex
CREATE INDEX "held_orders_branch_id_created_at_idx" ON "held_orders"("branch_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "cash_shifts_shift_number_key" ON "cash_shifts"("shift_number");

-- CreateIndex
CREATE INDEX "cash_shifts_branch_id_opened_at_idx" ON "cash_shifts"("branch_id", "opened_at");

-- CreateIndex
CREATE INDEX "cash_shifts_status_idx" ON "cash_shifts"("status");

-- CreateIndex
CREATE INDEX "cash_transactions_cash_shift_id_created_at_idx" ON "cash_transactions"("cash_shift_id", "created_at");

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "delivery_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_cash_shift_id_fkey" FOREIGN KEY ("cash_shift_id") REFERENCES "cash_shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_addons" ADD CONSTRAINT "order_item_addons_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_removals" ADD CONSTRAINT "order_item_removals_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_discounts" ADD CONSTRAINT "order_discounts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_cash_shift_id_fkey" FOREIGN KEY ("cash_shift_id") REFERENCES "cash_shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "delivery_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_shifts" ADD CONSTRAINT "cash_shifts_opened_by_fkey" FOREIGN KEY ("opened_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_shifts" ADD CONSTRAINT "cash_shifts_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "pos_terminals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_cash_shift_id_fkey" FOREIGN KEY ("cash_shift_id") REFERENCES "cash_shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Hand-written ─────────────────────────────────────────────────────────────
-- Financial records can never be deleted (cancel / refund / void instead).
CREATE TRIGGER orders_no_delete BEFORE DELETE ON "orders" FOR EACH ROW EXECUTE FUNCTION app_block_delete();
CREATE TRIGGER order_items_no_delete BEFORE DELETE ON "order_items" FOR EACH ROW EXECUTE FUNCTION app_block_delete();
CREATE TRIGGER order_item_addons_no_delete BEFORE DELETE ON "order_item_addons" FOR EACH ROW EXECUTE FUNCTION app_block_delete();
CREATE TRIGGER order_item_removals_no_delete BEFORE DELETE ON "order_item_removals" FOR EACH ROW EXECUTE FUNCTION app_block_delete();
CREATE TRIGGER order_status_history_no_delete BEFORE DELETE ON "order_status_history" FOR EACH ROW EXECUTE FUNCTION app_block_delete();
CREATE TRIGGER order_discounts_no_delete BEFORE DELETE ON "order_discounts" FOR EACH ROW EXECUTE FUNCTION app_block_delete();
CREATE TRIGGER payments_no_delete BEFORE DELETE ON "payments" FOR EACH ROW EXECUTE FUNCTION app_block_delete();
CREATE TRIGGER refunds_no_delete BEFORE DELETE ON "refunds" FOR EACH ROW EXECUTE FUNCTION app_block_delete();
CREATE TRIGGER cash_shifts_no_delete BEFORE DELETE ON "cash_shifts" FOR EACH ROW EXECUTE FUNCTION app_block_delete();
CREATE TRIGGER cash_transactions_no_delete BEFORE DELETE ON "cash_transactions" FOR EACH ROW EXECUTE FUNCTION app_block_delete();

-- At most one open cash shift per terminal.
CREATE UNIQUE INDEX "cash_shifts_one_open_per_terminal" ON "cash_shifts" ("terminal_id") WHERE "status" = 'OPEN';

-- Money sanity.
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_refund_not_above_paid" CHECK ("amount_refunded" <= "amount_paid");

SELECT app_enable_rls();
