-- CreateEnum
CREATE TYPE "BaseUnit" AS ENUM ('g', 'ml', 'piece');

-- CreateEnum
CREATE TYPE "InventoryTxType" AS ENUM ('OPENING', 'PURCHASE', 'SALE', 'SALE_REVERSAL', 'WASTAGE', 'ADJUSTMENT', 'COUNT_VARIANCE', 'TRANSFER_IN', 'TRANSFER_OUT');

-- CreateEnum
CREATE TYPE "WastageReason" AS ENUM ('EXPIRED', 'BURNED', 'DAMAGED', 'SPOILED', 'WRONG_PREPARATION', 'STAFF_MEAL', 'CANCELLED_ORDER', 'OTHER');

-- CreateEnum
CREATE TYPE "StockCountStatus" AS ENUM ('DRAFT', 'POSTED');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('DRAFT', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchasePaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID');

-- CreateEnum
CREATE TYPE "SupplierPaymentMethod" AS ENUM ('CASH_DRAWER', 'CASH_OTHER', 'BANK_TRANSFER', 'CHEQUE', 'CARD');

-- CreateTable
CREATE TABLE "ingredients" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "category" TEXT,
    "base_unit" "BaseUnit" NOT NULL,
    "min_stock" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "reorder_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "average_cost" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "last_purchase_cost" DECIMAL(14,4),
    "default_supplier_id" UUID,
    "track_stock" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredient_units" (
    "ingredient_id" UUID NOT NULL,
    "unit" TEXT NOT NULL,
    "factor_to_base" DECIMAL(14,4) NOT NULL,

    CONSTRAINT "ingredient_units_pkey" PRIMARY KEY ("ingredient_id","unit")
);

-- CreateTable
CREATE TABLE "ingredient_stock" (
    "branch_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "on_hand" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ingredient_stock_pkey" PRIMARY KEY ("branch_id","ingredient_id")
);

-- CreateTable
CREATE TABLE "inventory_transactions" (
    "id" BIGSERIAL NOT NULL,
    "branch_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "type" "InventoryTxType" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit_cost" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "total_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "balance_after" DECIMAL(14,3) NOT NULL,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipes" (
    "id" UUID NOT NULL,
    "product_id" UUID,
    "variant_id" UUID,
    "addon_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_items" (
    "id" UUID NOT NULL,
    "recipe_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "recipe_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "count_number" TEXT NOT NULL,
    "status" "StockCountStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "created_by" UUID,
    "posted_by" UUID,
    "posted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_items" (
    "id" UUID NOT NULL,
    "stock_count_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "expected_qty" DECIMAL(14,3) NOT NULL,
    "counted_qty" DECIMAL(14,3),
    "variance_qty" DECIMAL(14,3),
    "unit_cost" DECIMAL(14,4) NOT NULL DEFAULT 0,

    CONSTRAINT "stock_count_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wastage" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "wastage_number" TEXT NOT NULL,
    "ingredient_id" UUID,
    "product_id" UUID,
    "variant_id" UUID,
    "item_name" TEXT NOT NULL,
    "order_id" UUID,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "reason" "WastageReason" NOT NULL,
    "estimated_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "employee_name" TEXT,
    "recorded_by" UUID,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wastage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contact_person" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "address" TEXT,
    "tax_number" TEXT,
    "payment_terms_days" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_ingredients" (
    "supplier_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "last_unit_cost" DECIMAL(14,4),
    "last_purchased_at" TIMESTAMPTZ(6),

    CONSTRAINT "supplier_ingredients_pkey" PRIMARY KEY ("supplier_id","ingredient_id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "purchase_number" TEXT NOT NULL,
    "supplier_id" UUID NOT NULL,
    "supplier_invoice_no" TEXT,
    "invoice_date" DATE NOT NULL,
    "due_date" DATE,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'DRAFT',
    "payment_status" "PurchasePaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "amount_paid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "attachment_url" TEXT,
    "notes" TEXT,
    "received_at" TIMESTAMPTZ(6),
    "received_by" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_items" (
    "id" UUID NOT NULL,
    "purchase_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "factor_to_base" DECIMAL(14,4) NOT NULL,
    "base_quantity" DECIMAL(14,3) NOT NULL,
    "unit_cost" DECIMAL(14,4) NOT NULL,
    "line_total" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "purchase_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payments" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "purchase_id" UUID,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "SupplierPaymentMethod" NOT NULL,
    "reference" TEXT,
    "paid_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cash_shift_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ingredients_sku_key" ON "ingredients"("sku");

-- CreateIndex
CREATE INDEX "ingredients_is_active_name_idx" ON "ingredients"("is_active", "name");

-- CreateIndex
CREATE INDEX "inventory_transactions_branch_id_ingredient_id_created_at_idx" ON "inventory_transactions"("branch_id", "ingredient_id", "created_at");

-- CreateIndex
CREATE INDEX "inventory_transactions_reference_type_reference_id_idx" ON "inventory_transactions"("reference_type", "reference_id");

-- CreateIndex
CREATE INDEX "inventory_transactions_type_created_at_idx" ON "inventory_transactions"("type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "recipes_variant_id_key" ON "recipes"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "recipes_addon_id_key" ON "recipes"("addon_id");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_items_recipe_id_ingredient_id_key" ON "recipe_items"("recipe_id", "ingredient_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_count_number_key" ON "stock_counts"("count_number");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_items_stock_count_id_ingredient_id_key" ON "stock_count_items"("stock_count_id", "ingredient_id");

-- CreateIndex
CREATE UNIQUE INDEX "wastage_wastage_number_key" ON "wastage"("wastage_number");

-- CreateIndex
CREATE INDEX "wastage_branch_id_occurred_at_idx" ON "wastage"("branch_id", "occurred_at");

-- CreateIndex
CREATE INDEX "wastage_reason_idx" ON "wastage"("reason");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_purchase_number_key" ON "purchases"("purchase_number");

-- CreateIndex
CREATE INDEX "purchases_supplier_id_payment_status_idx" ON "purchases"("supplier_id", "payment_status");

-- CreateIndex
CREATE INDEX "purchases_branch_id_invoice_date_idx" ON "purchases"("branch_id", "invoice_date");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_supplier_id_supplier_invoice_no_key" ON "purchases"("supplier_id", "supplier_invoice_no");

-- CreateIndex
CREATE INDEX "purchase_items_purchase_id_idx" ON "purchase_items"("purchase_id");

-- CreateIndex
CREATE INDEX "supplier_payments_supplier_id_idx" ON "supplier_payments"("supplier_id");

-- AddForeignKey
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_default_supplier_id_fkey" FOREIGN KEY ("default_supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient_units" ADD CONSTRAINT "ingredient_units_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient_stock" ADD CONSTRAINT "ingredient_stock_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_items" ADD CONSTRAINT "stock_count_items_stock_count_id_fkey" FOREIGN KEY ("stock_count_id") REFERENCES "stock_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_items" ADD CONSTRAINT "stock_count_items_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wastage" ADD CONSTRAINT "wastage_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_ingredients" ADD CONSTRAINT "supplier_ingredients_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_ingredients" ADD CONSTRAINT "supplier_ingredients_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Hand-written ─────────────────────────────────────────────────────────────
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_one_target" CHECK (num_nonnulls("product_id", "variant_id", "addon_id") = 1);
CREATE UNIQUE INDEX "recipes_product_base_key" ON "recipes" ("product_id") WHERE "product_id" IS NOT NULL;
ALTER TABLE "wastage" ADD CONSTRAINT "wastage_item" CHECK ("ingredient_id" IS NOT NULL OR "product_id" IS NOT NULL);
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_qty_positive" CHECK ("quantity" > 0);
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_positive" CHECK ("amount" > 0);
CREATE UNIQUE INDEX "ingredients_name_active_key" ON "ingredients" (lower("name")) WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "suppliers_name_active_key" ON "suppliers" (lower("name")) WHERE "deleted_at" IS NULL;

-- Ledgers are append-only.
CREATE TRIGGER inventory_transactions_no_change BEFORE UPDATE OR DELETE ON "inventory_transactions" FOR EACH ROW EXECUTE FUNCTION app_block_modification();
CREATE TRIGGER supplier_payments_no_delete BEFORE DELETE ON "supplier_payments" FOR EACH ROW EXECUTE FUNCTION app_block_delete();
CREATE TRIGGER wastage_no_delete BEFORE DELETE ON "wastage" FOR EACH ROW EXECUTE FUNCTION app_block_delete();

-- Removable options can point at the ingredient they leave out.
ALTER TABLE "product_removable_options" ADD CONSTRAINT "product_removable_options_ingredient_fk" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE SET NULL;

SELECT app_enable_rls();
