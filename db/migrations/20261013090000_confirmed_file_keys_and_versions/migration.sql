-- M18R (code review 2026-10-12, D-042): a confirmed file now lives at its own server-only "final" key, copied from the
-- pending key the presigned PUT URL can write, and file versions get their own sequence number.

-- Pending uploads never confirmed are throw-away (15-minute expiry). They are removed so that every row left either is
-- confirmed or was issued by a build that uses the separate pending key prefix (their objects, if any, are left behind
-- in storage under the old key and are harmless).
DELETE FROM "pending_uploads" WHERE "confirmed_at" IS NULL;

-- AlterTable: where the confirmed file ended up. Rows confirmed before this migration kept the pending key as the file.
ALTER TABLE "pending_uploads" ADD COLUMN     "final_object_key" TEXT;
UPDATE "pending_uploads" SET "final_object_key" = "object_key" WHERE "confirmed_at" IS NOT NULL;
CREATE UNIQUE INDEX "pending_uploads_final_object_key_key" ON "pending_uploads"("final_object_key");

-- AlterTable: the version number of a file within its submission (1, 2, 3...). Existing files are numbered in arrival
-- order (ties by id), which is the order they were shown in.
ALTER TABLE "submission_files" ADD COLUMN     "version" INTEGER;
UPDATE "submission_files" AS f
SET "version" = numbered."version"
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "submission_id" ORDER BY "uploaded_at", "id")::INTEGER AS "version"
  FROM "submission_files"
) AS numbered
WHERE f."id" = numbered."id";
ALTER TABLE "submission_files" ALTER COLUMN "version" SET NOT NULL;
CREATE UNIQUE INDEX "submission_files_submission_id_version_key" ON "submission_files"("submission_id", "version");
