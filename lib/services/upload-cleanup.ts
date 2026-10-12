import type { PrismaClient } from "@/lib/generated/prisma/client";
import type { Storage } from "@/lib/storage-core";

// Abandoned uploads (DB-017, edge-cases.md "Submissions"): an upload URL was issued, the student never confirmed (closed
// the tab, lost the connection, or uploaded and walked away). Past its 15-minute expiry nothing can use the pending
// upload any more, so its row and its stray object are removed. Run by `npm run uploads:cleanup`.
//
// It takes its Prisma and storage clients as arguments instead of importing `lib/db` and `lib/storage`, because those
// are `server-only` and this also runs from the command line. It is safe to run any time, and as often as you like: a
// pending upload that was confirmed is never touched, and a second run finds nothing left to do.

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
}): Promise<CleanupReport> {
  const { prisma, storage, now } = options;
  const batchSize = options.batchSize ?? 100;
  const report: CleanupReport = { expired: 0, removed: 0, failed: [] };
  const skip = new Set<string>(); // rows that failed this run, so they are not fetched again

  for (;;) {
    const batch = await prisma.pendingUpload.findMany({
      where: { confirmedAt: null, expiresAt: { lte: now }, id: { notIn: [...skip] } },
      orderBy: { expiresAt: "asc" },
      take: batchSize,
      select: { id: true, objectKey: true },
    });
    if (batch.length === 0) return report;

    for (const row of batch) {
      report.expired += 1;
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
      // Only while still unconfirmed: a confirm that raced in keeps its row (and, being unexpired when it started,
      // its object is not deleted by anything here either).
      const { count } = await prisma.pendingUpload.deleteMany({
        where: { id: row.id, confirmedAt: null },
      });
      report.removed += count;
    }
  }
}
