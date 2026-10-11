-- M13: the confirm step needs what was declared when the upload URL was issued - the file's original name (copied to
-- SUBMISSION_FILE), its type and its size (re-checked against the stored object). Rows can only exist from a build
-- that already issued upload URLs; they are throw-away (15-minute expiry), so any left over are removed first.
DELETE FROM "pending_uploads";

-- AlterTable
ALTER TABLE "pending_uploads" ADD COLUMN     "mime_type" TEXT NOT NULL,
ADD COLUMN     "original_name" TEXT NOT NULL,
ADD COLUMN     "size_bytes" INTEGER NOT NULL;
