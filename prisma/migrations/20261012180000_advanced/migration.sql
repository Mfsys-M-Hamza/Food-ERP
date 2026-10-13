-- CreateEnum
CREATE TYPE "CouponType" AS ENUM ('PERCENT', 'AMOUNT', 'FREE_DELIVERY');

-- CreateEnum
CREATE TYPE "CouponChannel" AS ENUM ('ALL', 'ONLINE', 'POS');

-- CreateEnum
CREATE TYPE "LoyaltyTxType" AS ENUM ('EARN', 'REDEEM', 'REVERSE_EARN', 'REVERSE_REDEEM', 'EXPIRE', 'ADJUST');

-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('EMAIL', 'SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('PHONE_VERIFY');

-- CreateTable
CREATE TABLE "coupons" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "type" "CouponType" NOT NULL,
    "value" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "max_discount" DECIMAL(12,2),
    "min_order" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "starts_at" TIMESTAMPTZ(6),
    "ends_at" TIMESTAMPTZ(6),
    "usage_limit" INTEGER,
    "per_customer_limit" INTEGER,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "first_order_only" BOOLEAN NOT NULL DEFAULT false,
    "channel" "CouponChannel" NOT NULL DEFAULT 'ALL',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_redemptions" (
    "id" UUID NOT NULL,
    "coupon_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "customer_id" UUID,
    "phone" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "reversed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_transactions" (
    "id" BIGSERIAL NOT NULL,
    "customer_id" UUID NOT NULL,
    "order_id" UUID,
    "type" "LoyaltyTxType" NOT NULL,
    "points" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(6),
    "consumed" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "branch_id" UUID,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "dedupe_key" TEXT,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_messages" (
    "id" UUID NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "related_type" TEXT,
    "related_id" TEXT,
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbound_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" UUID NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "phone" TEXT NOT NULL,
    "customer_id" UUID,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "ip" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coupons_is_active_idx" ON "coupons"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_redemptions_order_id_key" ON "coupon_redemptions"("order_id");

-- CreateIndex
CREATE INDEX "coupon_redemptions_coupon_id_customer_id_idx" ON "coupon_redemptions"("coupon_id", "customer_id");

-- CreateIndex
CREATE INDEX "coupon_redemptions_coupon_id_phone_idx" ON "coupon_redemptions"("coupon_id", "phone");

-- CreateIndex
CREATE INDEX "loyalty_transactions_customer_id_created_at_idx" ON "loyalty_transactions"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "loyalty_transactions_order_id_idx" ON "loyalty_transactions"("order_id");

-- CreateIndex
CREATE INDEX "loyalty_transactions_type_expires_at_idx" ON "loyalty_transactions"("type", "expires_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_user_id_dedupe_key_key" ON "notifications"("user_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "outbound_messages_status_created_at_idx" ON "outbound_messages"("status", "created_at");

-- CreateIndex
CREATE INDEX "otp_codes_phone_purpose_created_at_idx" ON "otp_codes"("phone", "purpose", "created_at");

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Hand-written ─────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "coupons_code_active_key" ON "coupons" (upper("code")) WHERE "deleted_at" IS NULL;
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_value_valid" CHECK ("value" >= 0 AND ("type" <> 'PERCENT' OR "value" <= 100) AND "min_order" >= 0 AND "used_count" >= 0);
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_amount_positive" CHECK ("amount" >= 0);
ALTER TABLE "customers" ADD CONSTRAINT "customers_loyalty_points_nonnegative" CHECK ("loyalty_points" >= 0);

-- The points ledger is append-only (only the "consumed" counter of earn rows may move).
CREATE OR REPLACE FUNCTION app_loyalty_ledger_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'The loyalty ledger is append-only' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.points <> OLD.points OR NEW.type <> OLD.type OR NEW.customer_id <> OLD.customer_id OR NEW.balance_after <> OLD.balance_after THEN
    RAISE EXCEPTION 'The loyalty ledger is append-only' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER loyalty_transactions_guard BEFORE UPDATE OR DELETE ON "loyalty_transactions" FOR EACH ROW EXECUTE FUNCTION app_loyalty_ledger_guard();
CREATE TRIGGER coupon_redemptions_no_delete BEFORE DELETE ON "coupon_redemptions" FOR EACH ROW EXECUTE FUNCTION app_block_delete();

SELECT app_enable_rls();
