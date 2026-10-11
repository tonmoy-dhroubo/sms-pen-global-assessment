import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { cleanupExpiredUploads } from "@/lib/services/upload-cleanup";
import { createStorage } from "@/lib/storage-core";
import { deleteObject, deletePrefix, headObject, putObject } from "@/lib/storage";
import {
  createAssessment,
  createModule,
  createStaff,
  createStudent,
} from "../../support/factories";

// `npm run uploads:cleanup` (DB-017): expired, unconfirmed pending uploads and their stray objects are removed; confirmed
// ones and ones still within their 15 minutes are never touched. Real Postgres and MinIO.

const RUN = randomUUID();
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(256)]);
const MINUTE = 60_000;

afterAll(() => deletePrefix(`tests/${RUN}/`));

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
  options: { expiresIn: number; confirmed?: boolean; withObject?: boolean },
) {
  const objectKey = `tests/${RUN}/${randomUUID()}.pdf`;
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
    const a = await pending(ctx, { expiresIn: -MINUTE });
    const b = await pending(ctx, { expiresIn: -10 * MINUTE });

    expect(await run()).toEqual({ expired: 2, removed: 2, failed: [] });
    expect(await db.pendingUpload.count()).toBe(0);
    expect(await headObject(a.objectKey)).toBeNull();
    expect(await headObject(b.objectKey)).toBeNull();
  });

  it("leaves uploads that are still valid, and confirmed ones, alone", async () => {
    const ctx = await context();
    const live = await pending(ctx, { expiresIn: 5 * MINUTE });
    const confirmed = await pending(ctx, { expiresIn: -MINUTE, confirmed: true });
    const expired = await pending(ctx, { expiresIn: -MINUTE });

    expect(await run()).toMatchObject({ expired: 1, removed: 1 });
    expect(await db.pendingUpload.count()).toBe(2);
    expect(await headObject(live.objectKey)).not.toBeNull();
    expect(await headObject(confirmed.objectKey)).not.toBeNull();
    expect(await headObject(expired.objectKey)).toBeNull();
  });

  it("treats an upload that expires exactly now as expired", async () => {
    const ctx = await context();
    const edge = await pending(ctx, { expiresIn: 0 });
    expect((await run(new Date(edge.row.expiresAt))).removed).toBe(1);
  });

  it("removes the row of an upload whose file never arrived", async () => {
    const ctx = await context();
    await pending(ctx, { expiresIn: -MINUTE, withObject: false });
    expect(await run()).toEqual({ expired: 1, removed: 1, failed: [] });
    expect(await db.pendingUpload.count()).toBe(0);
  });

  it("is idempotent: a second run finds nothing", async () => {
    const ctx = await context();
    await pending(ctx, { expiresIn: -MINUTE });
    expect((await run()).removed).toBe(1);
    expect(await run()).toEqual({ expired: 0, removed: 0, failed: [] });
  });

  it("does nothing when there is nothing to clean", async () => {
    expect(await run()).toEqual({ expired: 0, removed: 0, failed: [] });
  });

  it("handles more rows than one batch", async () => {
    const ctx = await context();
    for (let i = 0; i < 7; i += 1) await pending(ctx, { expiresIn: -MINUTE, withObject: false });
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
    const stuck = await pending(ctx, { expiresIn: -MINUTE });
    const other = await pending(ctx, { expiresIn: -MINUTE });

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
    const { row, objectKey } = await pending(ctx, { expiresIn: -MINUTE });
    const storage = createStorage({
      endpoint: process.env.S3_ENDPOINT!,
      region: process.env.S3_REGION!,
      bucket: process.env.S3_BUCKET!,
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      forcePathStyle: true,
    });
    expect((await cleanupExpiredUploads({ prisma: db, storage, now: new Date() })).removed).toBe(1);
    expect(await db.pendingUpload.findUnique({ where: { id: row.id } })).toBeNull();
    expect(await headObject(objectKey)).toBeNull();
  });
});
