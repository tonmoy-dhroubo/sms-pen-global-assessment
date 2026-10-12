import type { PrismaClient } from "@/lib/generated/prisma/client";
import { isPendingKey } from "@/lib/storage-core";
import type { Storage } from "@/lib/storage-core";

// Abandoned uploads (DB-017, edge-cases.md "Submissions"): an upload URL was issued, the student never confirmed (closed
// the tab, lost the connection, or uploaded and walked away). Once its 15-minute expiry has passed, plus a grace period
// (D-042), nothing can use the pending upload any more, so its row and its stray object are removed. Run by
// `npm run uploads:cleanup`.
//
// What keeps this from ever deleting a submitted file (code review 2026-10-12, #2):
//   - It only deletes keys under the pending prefix. A confirmed file lives at a different, server-only key (D-042), so
//     even a confirm that commits just after a row was selected here loses nothing but its already-copied staging object.
//     A row whose key is not a pending key is reported and left alone.
//   - It only selects uploads that expired more than `CLEANUP_GRACE_MS` ago. Confirm re-checks the expiry inside its own
//     transaction, so a confirm that started in time has long finished by then.
//   - Rows are removed only while still unconfirmed.
//
// It takes its Prisma and storage clients as arguments instead of importing `lib/db` and `lib/storage`, because those
// are `server-only` and this also runs from the command line. It is safe to run any time, and as often as you like: a
// pending upload that was confirmed is never touched, and a second run finds nothing left to do.

/** How long after its expiry an unconfirmed upload is left before cleanup touches it (more than five minutes, D-042). */
export const CLEANUP_GRACE_MS = 10 * 60 * 1000;

export interface CleanupReport {
  /** Expired, unconfirmed pending uploads found. */
  expired: number;
  /** Rows removed (their object is gone first). */
  removed: number;
  /** Rows left in place because the object could not be deleted; the next run tries again. */
  failed: { objectKey: string; message: string }[];
}

export async function cleanupExpiredUploads(options: {
  prisma: Pick<PrismaClient, "pendingUpload">;
  storage: Pick<Storage, "deleteObject">;
  now: Date;
  /** How many rows to handle per round trip. */
  batchSize?: number;
  /** Overrides `CLEANUP_GRACE_MS`; only tests have a reason to. */
  graceMs?: number;
}): Promise<CleanupReport> {
  const { prisma, storage, now } = options;
  const batchSize = options.batchSize ?? 100;
  const cutoff = new Date(now.getTime() - (options.graceMs ?? CLEANUP_GRACE_MS));
  const report: CleanupReport = { expired: 0, removed: 0, failed: [] };
  const skip = new Set<string>(); // rows that failed this run, so they are not fetched again

  for (;;) {
    const batch = await prisma.pendingUpload.findMany({
      where: { confirmedAt: null, expiresAt: { lte: cutoff }, id: { notIn: [...skip] } },
      orderBy: { expiresAt: "asc" },
      take: batchSize,
      select: { id: true, objectKey: true },
    });
    if (batch.length === 0) return report;

    for (const row of batch) {
      report.expired += 1;
      if (!isPendingKey(row.objectKey)) {
        skip.add(row.id);
        report.failed.push({
          objectKey: row.objectKey,
          message: "Not a pending upload key; refusing to delete it.",
        });
        continue;
      }
      try {
        await storage.deleteObject(row.objectKey); // deleting a key that is already gone is not an error
      } catch (error) {
        skip.add(row.id);
        report.failed.push({
          objectKey: row.objectKey,
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      // Only while still unconfirmed: a confirm that raced in keeps its row. (Its file is safe either way: it was
      // copied to a final key, which is not what was deleted above.)
      const { count } = await prisma.pendingUpload.deleteMany({
        where: { id: row.id, confirmedAt: null },
      });
      report.removed += count;
    }
  }
}
