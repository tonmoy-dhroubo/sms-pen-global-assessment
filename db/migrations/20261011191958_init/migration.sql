-- Extensions (hand-written). `unaccent` and `pg_trgm` power accent-insensitive,
-- typo-tolerant student name search.
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "enrolment_status" AS ENUM ('ENROLLED', 'DEFERRED', 'WITHDRAWN', 'COMPLETED');

-- CreateEnum
CREATE TYPE "fee_charge_kind" AS ENUM ('PROGRAMME_FEE', 'ADJUSTMENT', 'WAIVER');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('BANK_TRANSFER', 'CASH', 'BKASH', 'NAGAD', 'CARD');

-- CreateEnum
CREATE TYPE "release_status" AS ENUM ('DRAFT', 'PUBLISHED', 'WITHHELD');

-- CreateEnum
CREATE TYPE "mark_change_type" AS ENUM ('MARK', 'PUBLISH', 'WITHHOLD', 'UNPUBLISH');

-- CreateTable
CREATE TABLE "programmes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "duration_years" INTEGER NOT NULL,

    CONSTRAINT "programmes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programme_fees" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "programme_id" UUID NOT NULL,
    "academic_year" TEXT NOT NULL,
    "instalment" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "due_date" DATE NOT NULL,

    CONSTRAINT "programme_fees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,

    CONSTRAINT "modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programme_modules" (
    "programme_id" UUID NOT NULL,
    "module_id" UUID NOT NULL,

    CONSTRAINT "programme_modules_pkey" PRIMARY KEY ("programme_id","module_id")
);

-- CreateTable
CREATE TABLE "staff" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "full_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "job_title" TEXT NOT NULL,

    CONSTRAINT "staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_number" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "programme_id" UUID NOT NULL,
    "academic_year" TEXT NOT NULL,
    "year_of_study" INTEGER NOT NULL,
    "status" "enrolment_status" NOT NULL DEFAULT 'ENROLLED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_id_sequences" (
    "year" INTEGER NOT NULL,
    "last_value" INTEGER NOT NULL,

    CONSTRAINT "student_id_sequences_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "status_changes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_id" UUID NOT NULL,
    "from_status" "enrolment_status",
    "to_status" "enrolment_status" NOT NULL,
    "reason" TEXT,
    "changed_by_id" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_charges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_id" UUID NOT NULL,
    "programme_fee_id" UUID,
    "kind" "fee_charge_kind" NOT NULL,
    "academic_year" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "due_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "payment_method" NOT NULL,
    "paid_at" DATE NOT NULL,
    "reference" TEXT NOT NULL,
    "recorded_by_id" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(3),
    "void_reason" TEXT,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "module_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "deadline" TIMESTAMPTZ(3) NOT NULL,
    "closed_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extensions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assessment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "new_deadline" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "extensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_uploads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assessment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "object_key" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3),

    CONSTRAINT "pending_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assessment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "first_submitted_at" TIMESTAMPTZ(3) NOT NULL,
    "last_submitted_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_files" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "submission_id" UUID NOT NULL,
    "object_key" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploaded_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "submission_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assessment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "mark" DECIMAL(4,1),
    "is_non_submission" BOOLEAN NOT NULL DEFAULT false,
    "release_status" "release_status" NOT NULL DEFAULT 'DRAFT',
    "withheld_reason" TEXT,
    "published_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "entered_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mark_changes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mark_id" UUID NOT NULL,
    "change" "mark_change_type" NOT NULL,
    "old_mark" DECIMAL(4,1),
    "new_mark" DECIMAL(4,1),
    "reason" TEXT,
    "changed_by_id" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mark_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "programmes_code_key" ON "programmes"("code");

-- CreateIndex
CREATE INDEX "programme_fees_due_date_idx" ON "programme_fees"("due_date");

-- CreateIndex
CREATE UNIQUE INDEX "programme_fees_programme_id_academic_year_instalment_key" ON "programme_fees"("programme_id", "academic_year", "instalment");

-- CreateIndex
CREATE UNIQUE INDEX "modules_code_key" ON "modules"("code");

-- CreateIndex
CREATE INDEX "programme_modules_module_id_idx" ON "programme_modules"("module_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_email_key" ON "staff"("email");

-- CreateIndex
CREATE UNIQUE INDEX "students_student_number_key" ON "students"("student_number");

-- CreateIndex
CREATE UNIQUE INDEX "students_email_key" ON "students"("email");

-- CreateIndex
CREATE INDEX "students_programme_id_idx" ON "students"("programme_id");

-- CreateIndex
CREATE INDEX "students_status_idx" ON "students"("status");

-- CreateIndex
CREATE INDEX "status_changes_student_id_idx" ON "status_changes"("student_id");

-- CreateIndex
CREATE INDEX "status_changes_changed_by_id_idx" ON "status_changes"("changed_by_id");

-- CreateIndex
CREATE INDEX "fee_charges_student_id_idx" ON "fee_charges"("student_id");

-- CreateIndex
CREATE INDEX "fee_charges_programme_fee_id_idx" ON "fee_charges"("programme_fee_id");

-- CreateIndex
CREATE INDEX "fee_charges_due_date_idx" ON "fee_charges"("due_date");

-- CreateIndex
CREATE UNIQUE INDEX "payments_reference_key" ON "payments"("reference");

-- CreateIndex
CREATE INDEX "payments_student_id_idx" ON "payments"("student_id");

-- CreateIndex
CREATE INDEX "payments_recorded_by_id_idx" ON "payments"("recorded_by_id");

-- CreateIndex
CREATE INDEX "assessments_module_id_idx" ON "assessments"("module_id");

-- CreateIndex
CREATE INDEX "assessments_created_by_id_idx" ON "assessments"("created_by_id");

-- CreateIndex
CREATE INDEX "assessments_deadline_idx" ON "assessments"("deadline");

-- CreateIndex
CREATE INDEX "extensions_student_id_idx" ON "extensions"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "extensions_assessment_id_student_id_key" ON "extensions"("assessment_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "pending_uploads_object_key_key" ON "pending_uploads"("object_key");

-- CreateIndex
CREATE INDEX "pending_uploads_assessment_id_idx" ON "pending_uploads"("assessment_id");

-- CreateIndex
CREATE INDEX "pending_uploads_student_id_idx" ON "pending_uploads"("student_id");

-- CreateIndex
CREATE INDEX "pending_uploads_expires_at_idx" ON "pending_uploads"("expires_at");

-- CreateIndex
CREATE INDEX "submissions_student_id_idx" ON "submissions"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_assessment_id_student_id_key" ON "submissions"("assessment_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "submission_files_object_key_key" ON "submission_files"("object_key");

-- CreateIndex
CREATE INDEX "submission_files_submission_id_idx" ON "submission_files"("submission_id");

-- CreateIndex
CREATE INDEX "marks_student_id_idx" ON "marks"("student_id");

-- CreateIndex
CREATE INDEX "marks_entered_by_id_idx" ON "marks"("entered_by_id");

-- CreateIndex
CREATE INDEX "marks_release_status_idx" ON "marks"("release_status");

-- CreateIndex
CREATE UNIQUE INDEX "marks_assessment_id_student_id_key" ON "marks"("assessment_id", "student_id");

-- CreateIndex
CREATE INDEX "mark_changes_mark_id_idx" ON "mark_changes"("mark_id");

-- CreateIndex
CREATE INDEX "mark_changes_changed_by_id_idx" ON "mark_changes"("changed_by_id");

-- AddForeignKey
ALTER TABLE "programme_fees" ADD CONSTRAINT "programme_fees_programme_id_fkey" FOREIGN KEY ("programme_id") REFERENCES "programmes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programme_modules" ADD CONSTRAINT "programme_modules_programme_id_fkey" FOREIGN KEY ("programme_id") REFERENCES "programmes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programme_modules" ADD CONSTRAINT "programme_modules_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_programme_id_fkey" FOREIGN KEY ("programme_id") REFERENCES "programmes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_changes" ADD CONSTRAINT "status_changes_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_changes" ADD CONSTRAINT "status_changes_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_charges" ADD CONSTRAINT "fee_charges_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_charges" ADD CONSTRAINT "fee_charges_programme_fee_id_fkey" FOREIGN KEY ("programme_fee_id") REFERENCES "programme_fees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "modules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extensions" ADD CONSTRAINT "extensions_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extensions" ADD CONSTRAINT "extensions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_uploads" ADD CONSTRAINT "pending_uploads_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_uploads" ADD CONSTRAINT "pending_uploads_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_files" ADD CONSTRAINT "submission_files_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marks" ADD CONSTRAINT "marks_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marks" ADD CONSTRAINT "marks_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marks" ADD CONSTRAINT "marks_entered_by_id_fkey" FOREIGN KEY ("entered_by_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mark_changes" ADD CONSTRAINT "mark_changes_mark_id_fkey" FOREIGN KEY ("mark_id") REFERENCES "marks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mark_changes" ADD CONSTRAINT "mark_changes_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- Hand-written SQL below: Prisma cannot express check constraints, functions or expression indexes.
-- ---------------------------------------------------------------------------------------------

-- Name search ---------------------------------------------------------------------------------
-- `unaccent()` is only STABLE, so it cannot be used in an index. This wrapper pins the dictionary and
-- is declared IMMUTABLE (the dictionary does not change at runtime), the usual workaround.
-- Services must search with exactly this expression: immutable_unaccent(lower(full_name)).
CREATE OR REPLACE FUNCTION immutable_unaccent(text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  STRICT
AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

-- Trigram index for `ILIKE '%term%'` / `%` similarity on the normalised full name.
CREATE INDEX "students_full_name_search_idx"
  ON "students" USING GIN (immutable_unaccent(lower("full_name")) gin_trgm_ops);

-- Check constraints ---------------------------------------------------------------------------
-- Payments are positive amounts; corrections are made by voiding (DB-005), never by negative payments.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_positive_check" CHECK ("amount" > 0);

-- A waiver reduces what is owed (negative); programme fees and adjustments increase it (positive).
ALTER TABLE "fee_charges"
  ADD CONSTRAINT "fee_charges_amount_sign_check"
  CHECK (
    ("kind" = 'WAIVER' AND "amount" < 0)
    OR ("kind" <> 'WAIVER' AND "amount" > 0)
  );

-- Marks are 0-100 (DB-019); a non-submission has no mark and every other row has one.
ALTER TABLE "marks"
  ADD CONSTRAINT "marks_mark_range_check"
  CHECK ("mark" IS NULL OR ("mark" >= 0 AND "mark" <= 100));

ALTER TABLE "marks"
  ADD CONSTRAINT "marks_non_submission_check"
  CHECK (("mark" IS NULL) = "is_non_submission");
