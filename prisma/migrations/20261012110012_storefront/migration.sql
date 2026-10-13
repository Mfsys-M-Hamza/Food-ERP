-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "linked_at" TIMESTAMPTZ(6),
ADD COLUMN     "phone_verified_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "customer_favorites" (
    "customer_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_favorites_pkey" PRIMARY KEY ("customer_id","product_id")
);

-- AddForeignKey
ALTER TABLE "customer_favorites" ADD CONSTRAINT "customer_favorites_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

SELECT app_enable_rls();
