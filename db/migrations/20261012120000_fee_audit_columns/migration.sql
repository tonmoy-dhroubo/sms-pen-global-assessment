-- M10 follow-up (DB-024): who voided a payment, who added a charge, and references that can be re-used after a void.

-- AlterTable
ALTER TABLE "fee_charges" ADD COLUMN     "created_by_id" UUID;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "voided_by_id" UUID;

-- Payments that were voided before this column existed have no recorded voider; attribute them to whoever recorded
-- them so the "both set or both null" check below holds. (Nothing in a fresh database is affected.)
UPDATE "payments" SET "voided_by_id" = "recorded_by_id" WHERE "voided_at" IS NOT NULL;

-- CreateIndex
CREATE INDEX "fee_charges_created_by_id_idx" ON "fee_charges"("created_by_id");

-- CreateIndex
CREATE INDEX "payments_voided_by_id_idx" ON "payments"("voided_by_id");

-- AddForeignKey
ALTER TABLE "fee_charges" ADD CONSTRAINT "fee_charges_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A payment is voided by someone, or not voided at all.
ALTER TABLE "payments" ADD CONSTRAINT "payments_voided_pair_check"
  CHECK (("voided_at" IS NULL) = ("voided_by_id" IS NULL));

-- A payment reference is unique among payments that are not voided: a payment entered wrongly, voided, and entered
-- again correctly carries the same bank reference. (Stored trimmed and upper-cased by the service.)
-- DropIndex
DROP INDEX "payments_reference_key";

-- CreateIndex
CREATE UNIQUE INDEX "payments_reference_active_key" ON "payments"("reference") WHERE (voided_at IS NULL);
