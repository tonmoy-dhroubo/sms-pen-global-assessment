import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createTestStorage } from "../../support/test-storage";
import { CLEANUP_GRACE_MS, cleanupExpiredUploads } from "@/lib/services/upload-cleanup";
import { deleteObject, deletePrefix, headObject, putObject } from "@/lib/storage";
import {
  createAssessment,
  createModule,
  createStaff,
  createStudent,
} from "../../support/factories";

// `npm run uploads:cleanup` (DB-017, D-042): pending uploads that expired more than a grace period ago, were never
// confirmed, and their stray pending objects are removed; confirmed ones, ones still within their 15 minutes (or the
// grace period after) and anything outside the pending key prefix are never touched. Real Postgres and MinIO.

const RUN = randomUUID();
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(256)]);
const MINUTE = 60_000;
/** Long enough ago to be past the grace period. */
const LONG_AGO = -(CLEANUP_GRACE_MS + MINUTE);

afterAll(() => deletePrefix(`pending/tests-${RUN}/`));

async function context() {
  const staff = await createStaff();
  const student = await createStudent();
  const assessment = await createAssessment({
    moduleId: (await createModule()).id,
    createdById: staff.id,
  });
  return { assessmentId: assessment.id, studentId: student.id };
}

async function pending(
  ctx: { assessmentId: string; studentId: string },
  options: { expiresIn: number; confirmed?: boolean; withObject?: boolean; key?: string },
) {
  const objectKey = options.key ?? `pending/tests-${RUN}/${randomUUID()}.pdf`;
  if (options.withObject !== false) await putObject(objectKey, PDF, "application/pdf");
  const row = await db.pendingUpload.create({
    data: {
      ...ctx,
      objectKey,
      originalName: "essay.pdf",
      mimeType: "application/pdf",
      sizeBytes: PDF.length,
      expiresAt: new Date(Date.now() + options.expiresIn),
      confirmedAt: options.confirmed ? new Date() : null,
    },
  });
  return { row, objectKey };
}

/** Runs the cleanup against the app's own storage client. */
function run(now = new Date()) {
  return cleanupExpiredUploads({ prisma: db, storage: { deleteObject }, now });
}

describe("cleanupExpiredUploads", () => {
  it("removes expired unconfirmed uploads together with their objects", async () => {
    const ctx = await context();
    const a = await pending(ctx, { expiresIn: LONG_AGO });
    const b = await pending(ctx, { expiresIn: LONG_AGO - 10 * MINUTE });

    expect(await run()).toEqual({ expired: 2, removed: 2, failed: [] });
    expect(await db.pendingUpload.count()).toBe(0);
    expect(await headObject(a.objectKey)).toBeNull();
    expect(await headObject(b.objectKey)).toBeNull();
  });

  it("leaves uploads that are still valid, and confirmed ones, alone", async () => {
    const ctx = await context();
    const live = await pending(ctx, { expiresIn: 5 * MINUTE });
    const confirmed = await pending(ctx, { expiresIn: LONG_AGO, confirmed: true });
    const expired = await pending(ctx, { expiresIn: LONG_AGO });

    expect(await run()).toMatchObject({ expired: 1, removed: 1 });
    expect(await db.pendingUpload.count()).toBe(2);
    expect(await headObject(live.objectKey)).not.toBeNull();
    expect(await headObject(confirmed.objectKey)).not.toBeNull();
    expect(await headObject(expired.objectKey)).toBeNull();
  });

  it("treats an upload that expired exactly one grace period ago as expired", async () => {
    const ctx = await context();
    const edge = await pending(ctx, { expiresIn: 0 });
    const cutoff = new Date(edge.row.expiresAt.getTime() + CLEANUP_GRACE_MS);
    expect((await run(new Date(cutoff.getTime() - 1))).removed).toBe(0);
    expect((await run(cutoff)).removed).toBe(1);
  });

  it("leaves an upload alone while it is expired but still inside the grace period", async () => {
    const ctx = await context();
    const recent = await pending(ctx, { expiresIn: -MINUTE });
    expect(CLEANUP_GRACE_MS).toBeGreaterThan(5 * MINUTE - 1); // D-042: more than five minutes
    expect(await run()).toEqual({ expired: 0, removed: 0, failed: [] });
    expect(await db.pendingUpload.count()).toBe(1);
    expect(await headObject(recent.objectKey)).not.toBeNull();
  });

  it("never deletes an object outside the pending prefix, and reports it instead", async () => {
    const ctx = await context();
    const final = await pending(ctx, {
      expiresIn: LONG_AGO,
      key: `submissions/tests-${RUN}/${randomUUID()}.pdf`,
    });
    const report = await run();
    expect(report.removed).toBe(0);
    expect(report.failed).toEqual([
      { objectKey: final.objectKey, message: expect.stringMatching(/not a pending upload key/i) },
    ]);
    expect(await headObject(final.objectKey)).not.toBeNull();
    expect(await db.pendingUpload.count()).toBe(1);
    await deleteObject(final.objectKey);
  });

  it("removes the row of an upload whose file never arrived", async () => {
    const ctx = await context();
    await pending(ctx, { expiresIn: LONG_AGO, withObject: false });
    expect(await run()).toEqual({ expired: 1, removed: 1, failed: [] });
    expect(await db.pendingUpload.count()).toBe(0);
  });

  it("is idempotent: a second run finds nothing", async () => {
    const ctx = await context();
    await pending(ctx, { expiresIn: LONG_AGO });
    expect((await run()).removed).toBe(1);
    expect(await run()).toEqual({ expired: 0, removed: 0, failed: [] });
  });

  it("does nothing when there is nothing to clean", async () => {
    expect(await run()).toEqual({ expired: 0, removed: 0, failed: [] });
  });

  it("handles more rows than one batch", async () => {
    const ctx = await context();
    for (let i = 0; i < 7; i += 1) await pending(ctx, { expiresIn: LONG_AGO, withObject: false });
    const report = await cleanupExpiredUploads({
      prisma: db,
      storage: { deleteObject: async () => undefined },
      now: new Date(),
      batchSize: 3,
    });
    expect(report).toEqual({ expired: 7, removed: 7, failed: [] });
  });

  it("keeps the row and reports it when storage cannot delete the object, then succeeds on the next run", async () => {
    const ctx = await context();
    const stuck = await pending(ctx, { expiresIn: LONG_AGO });
    const other = await pending(ctx, { expiresIn: LONG_AGO });

    const flaky = await cleanupExpiredUploads({
      prisma: db,
      storage: {
        deleteObject: async (key) => {
          if (key === stuck.objectKey) throw new Error("storage unavailable");
          await deleteObject(key);
        },
      },
      now: new Date(),
    });
    expect(flaky.expired).toBe(2);
    expect(flaky.removed).toBe(1);
    expect(flaky.failed).toEqual([{ objectKey: stuck.objectKey, message: "storage unavailable" }]);
    expect(await db.pendingUpload.findMany({ select: { id: true } })).toEqual([
      { id: stuck.row.id },
    ]);
    expect(await headObject(other.objectKey)).toBeNull();

    expect(await run()).toEqual({ expired: 1, removed: 1, failed: [] });
    expect(await headObject(stuck.objectKey)).toBeNull();
  });

  it("works with a storage client built the way the command line builds it", async () => {
    const ctx = await context();
    const { row, objectKey } = await pending(ctx, { expiresIn: LONG_AGO });
    const storage = createTestStorage();
    expect((await cleanupExpiredUploads({ prisma: db, storage, now: new Date() })).removed).toBe(1);
    expect(await db.pendingUpload.findUnique({ where: { id: row.id } })).toBeNull();
    expect(await headObject(objectKey)).toBeNull();
  });
});
