import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { POST as confirmRoute } from "@/app/api/assessments/[id]/submission/confirm/route";
import { POST as uploadUrlRoute } from "@/app/api/assessments/[id]/submission/upload-url/route";
import { GET as downloadRoute } from "@/app/api/files/[fileId]/download/route";
import { db } from "@/lib/db";
import type { Receipt, UploadUrlResult } from "@/lib/services/submissions";
import { confirmUpload } from "@/lib/services/submissions";
import { cleanupExpiredUploads } from "@/lib/services/upload-cleanup";
import { deleteObject, deletePrefix, headObject, putObject, submissionPrefix } from "@/lib/storage";
import { asStudent, call } from "../../support/api";
import {
  createAssessment,
  createModule,
  createProgramme,
  createStaff,
  createStudent,
  linkModule,
} from "../../support/factories";

// Regression tests for the independent code review of 12 October 2026 (docs/code-reviews/): findings #1 (a confirmed
// file could be overwritten through its upload URL), #2 (cleanup could delete a confirmed file) and #4 (the arrival time
// was nudged by a millisecond and could turn a second on-time file late). Real Postgres and real MinIO.
//
// Two things are simulated, because they cannot be timed reliably from a test:
//   - what storage reports as a file's arrival time (it has one-second resolution), through `hooks.arrival`;
//   - the student re-uploading to their still-valid URL at an exact moment of the confirm, through `hooks.beforeCopy`
//     and `hooks.afterHash`.
// Everything else is the real flow: Route Handlers, services, Postgres, MinIO and plain `fetch` for the PUT.

const hooks = vi.hoisted(() => ({
  /** Object key -> the arrival time storage should report for it. */
  arrival: new Map<string, Date>(),
  beforeCopy: null as null | (() => Promise<void>),
  afterHash: null as null | (() => Promise<void>),
}));

vi.mock("@/lib/storage", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/storage")>();
  return {
    ...real,
    headObject: async (key: string) => {
      const info = await real.headObject(key);
      const arrived = hooks.arrival.get(key);
      return info && arrived ? { ...info, lastModified: arrived } : info;
    },
    sha256: async (key: string) => {
      const digest = await real.sha256(key);
      await hooks.afterHash?.();
      return digest;
    },
    // `copyObject` is the storage layer's server-side copy; the code the review looked at did not have it.
    ...("copyObject" in real
      ? {
          copyObject: async (...args: Parameters<typeof real.copyObject>) => {
            await hooks.beforeCopy?.();
            return real.copyObject(...args);
          },
        }
      : {}),
  };
});

type ErrorBody = { error: { code: string; message: string } };

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const FIXTURES = path.resolve(import.meta.dirname, "../../../db/seed/fixtures");
const SAMPLE_PDF = readFileSync(path.join(FIXTURES, "sample.pdf"));

/** A valid PDF whose bytes are unique to this call. */
const pdf = () => Buffer.concat([SAMPLE_PDF, Buffer.from(`\n% ${randomUUID()}\n`)]);
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Same length, different content: what the signed PUT allows. */
function tampered(bytes: Buffer): Buffer {
  const copy = Buffer.from(bytes);
  copy[copy.length - 3] = copy[copy.length - 3]! ^ 0xff;
  return copy;
}

async function setup(options: { deadline?: Date } = {}) {
  const staff = await createStaff();
  const programme = await createProgramme();
  const mod = await createModule();
  await linkModule(programme.id, mod.id);
  const student = await createStudent({ programmeId: programme.id });
  const assessment = await createAssessment({
    moduleId: mod.id,
    createdById: staff.id,
    deadline: options.deadline ?? new Date(Date.now() + DAY),
  });
  return { student, assessment, cookie: asStudent(student.id) };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

/** Step 1 and 2: URL, then PUT. Returns what the student holds before confirming. */
async function upload(ctx: Ctx, bytes: Buffer, fileName = "essay.pdf") {
  const result = await call<UploadUrlResult & ErrorBody>(uploadUrlRoute, {
    method: "POST",
    path: `/api/assessments/${ctx.assessment.id}/submission/upload-url`,
    params: { id: ctx.assessment.id },
    cookie: ctx.cookie,
    body: { fileName, contentType: "application/pdf", sizeBytes: bytes.length },
  });
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  const issued = result.body;
  const stored = await fetch(issued.uploadUrl, {
    method: "PUT",
    headers: issued.headers,
    body: new Uint8Array(bytes),
  });
  expect(stored.status).toBe(200);
  const pending = await db.pendingUpload.findUniqueOrThrow({
    where: { id: issued.pendingUploadId },
  });
  return { issued, pending };
}

function confirm(ctx: Ctx, pendingUploadId: string) {
  return call<Receipt & ErrorBody>(confirmRoute, {
    method: "POST",
    path: `/api/assessments/${ctx.assessment.id}/submission/confirm`,
    params: { id: ctx.assessment.id },
    cookie: ctx.cookie,
    body: { pendingUploadId },
  });
}

/** The bytes a download of the file returns right now. */
async function download(ctx: Ctx, fileId: string): Promise<Buffer> {
  const link = await call<{ url: string }>(downloadRoute, {
    path: `/api/files/${fileId}/download`,
    params: { fileId },
    cookie: ctx.cookie,
  });
  expect(link.status).toBe(200);
  const response = await fetch(link.body.url);
  expect(response.status).toBe(200);
  return Buffer.from(await response.arrayBuffer());
}

describe("finding #1: a confirmed file cannot be changed through its upload URL", () => {
  it("keeps the confirmed bytes, fingerprint and key after a later PUT to the same URL", async () => {
    const ctx = await setup();
    const bytes = pdf();
    const { issued, pending } = await upload(ctx, bytes);
    const confirmed = await confirm(ctx, issued.pendingUploadId);
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);

    const file = await db.submissionFile.findFirstOrThrow({
      where: { submission: { studentId: ctx.student.id } },
    });
    // The student reuses the URL (still valid for 15 minutes) with other bytes of the same size.
    await fetch(issued.uploadUrl, {
      method: "PUT",
      headers: issued.headers,
      body: new Uint8Array(tampered(bytes)),
    });

    const after = await download(ctx, file.id);
    expect(sha(after)).toBe(sha(bytes));
    expect(file.sha256).toBe(sha(bytes));
    expect(confirmed.body.sha256).toBe(sha(bytes));
    expect((await db.submissionFile.findUniqueOrThrow({ where: { id: file.id } })).sha256).toBe(
      sha(bytes),
    );
    // The recorded file is not at the key the signed URL writes.
    expect(file.objectKey).not.toBe(pending.objectKey);
  });

  it("records the file that was hashed even when the URL is used again right after the copy", async () => {
    const ctx = await setup();
    const bytes = pdf();
    const { issued, pending } = await upload(ctx, bytes);
    // The moment the fingerprint has been computed, the student overwrites the URL's object.
    hooks.afterHash = async () => {
      hooks.afterHash = null;
      await putObject(pending.objectKey, tampered(bytes), "application/pdf");
    };
    try {
      const confirmed = await confirm(ctx, issued.pendingUploadId);
      expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
      expect(confirmed.body.sha256).toBe(sha(bytes));
      const file = await db.submissionFile.findFirstOrThrow({
        where: { submission: { studentId: ctx.student.id } },
      });
      expect(sha(await download(ctx, file.id))).toBe(sha(bytes));
    } finally {
      hooks.afterHash = null;
    }
  });

  it("refuses to record a file that was replaced between being checked and being copied", async () => {
    const ctx = await setup();
    const bytes = pdf();
    const { issued, pending } = await upload(ctx, bytes);
    hooks.beforeCopy = async () => {
      hooks.beforeCopy = null;
      await putObject(pending.objectKey, tampered(bytes), "application/pdf");
    };
    try {
      const confirmed = await confirm(ctx, issued.pendingUploadId);
      expect(confirmed.status).toBe(400);
      expect(confirmed.body.error.message).toMatch(/changed while it was being checked/);
      expect(await db.submissionFile.count()).toBe(0);
      expect(await db.submission.count()).toBe(0);
    } finally {
      hooks.beforeCopy = null;
    }
  });
});

describe("confirm after the copy (D-042)", () => {
  it("answers the first confirm's receipt to a second one that it overtook", async () => {
    const ctx = await setup();
    const bytes = pdf();
    const { issued } = await upload(ctx, bytes);
    // The second confirm has read the pending upload (unconfirmed) when the first one runs to the end, deleting the
    // staging object the second one is about to copy: the second must answer with the recorded receipt.
    let first: Receipt | undefined;
    hooks.beforeCopy = async () => {
      hooks.beforeCopy = null;
      first = await confirmUpload(ctx.student.id, ctx.assessment.id, issued.pendingUploadId);
    };
    try {
      const second = await confirm(ctx, issued.pendingUploadId);
      expect(second.status, JSON.stringify(second.body)).toBe(200);
      expect(second.body).toEqual(first);
      expect(await db.submissionFile.count()).toBe(1);
    } finally {
      hooks.beforeCopy = null;
    }
  });

  it("removes the copy, the staging object and the row when the upload expires during the check", async () => {
    const ctx = await setup();
    const { issued, pending } = await upload(ctx, pdf());
    // The first reading of the clock is just before the expiry; by the time the file has been copied and read, it is past.
    let reads = 0;
    const clock = () => new Date(pending.expiresAt.getTime() + (reads++ === 0 ? -1000 : 1000));

    await expect(
      confirmUpload(ctx.student.id, ctx.assessment.id, issued.pendingUploadId, clock),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE", details: { rule: "UPLOAD_EXPIRED" } });

    expect(reads).toBeGreaterThan(1);
    expect(await db.submissionFile.count()).toBe(0);
    expect(await db.submission.count()).toBe(0);
    expect(await db.pendingUpload.count()).toBe(0);
    expect(await headObject(pending.objectKey)).toBeNull();
    expect(await deletePrefix(submissionPrefix(ctx.assessment.id, ctx.student.id))).toBe(0);
  });
});

describe("finding #2: cleanup cannot delete a confirmed submission", () => {
  it("keeps the file when a confirm that began before expiry commits after cleanup selected the row", async () => {
    const ctx = await setup();
    const bytes = pdf();
    const { issued, pending } = await upload(ctx, bytes);
    const expiresAt = pending.expiresAt.getTime();

    // The confirm started a second before the upload expired; cleanup runs well after. Cleanup has already selected
    // the row (still unconfirmed) when the confirm commits: the review's interleaving.
    let raced = false;
    const racing = {
      pendingUpload: {
        findMany: async (args: Parameters<typeof db.pendingUpload.findMany>[0]) => {
          const rows = await db.pendingUpload.findMany(args);
          if (!raced && rows.length > 0) {
            raced = true;
            await confirmUpload(
              ctx.student.id,
              ctx.assessment.id,
              issued.pendingUploadId,
              () => new Date(expiresAt - 1000),
            );
          }
          return rows;
        },
        deleteMany: (args: Parameters<typeof db.pendingUpload.deleteMany>[0]) =>
          db.pendingUpload.deleteMany(args),
      },
    };
    await cleanupExpiredUploads({
      prisma: racing as unknown as Parameters<typeof cleanupExpiredUploads>[0]["prisma"],
      storage: { deleteObject },
      now: new Date(expiresAt + 10 * MINUTE),
    });

    expect(raced).toBe(true);
    const file = await db.submissionFile.findFirstOrThrow({
      where: { submission: { studentId: ctx.student.id } },
    });
    expect(sha(await download(ctx, file.id))).toBe(sha(bytes));
  });
});

describe("finding #4: arrival times are kept as they were, and versions have their own order", () => {
  it("keeps both files of the deadline's final second on time", async () => {
    // Storage reports whole seconds, so a file that arrives in the last second reads as exactly the deadline.
    const deadline = new Date(Math.floor((Date.now() + DAY) / 1000) * 1000);
    const ctx = await setup({ deadline });
    const first = await upload(ctx, pdf(), "first.pdf");
    const second = await upload(ctx, pdf(), "second.pdf");
    hooks.arrival.set(first.pending.objectKey, deadline);
    hooks.arrival.set(second.pending.objectKey, deadline);

    const one = await confirm(ctx, first.issued.pendingUploadId);
    const two = await confirm(ctx, second.issued.pendingUploadId);

    expect(one.status, JSON.stringify(one.body)).toBe(200);
    expect(two.status, JSON.stringify(two.body)).toBe(200);
    expect(one.body).toMatchObject({ late: false, uploadedAt: deadline.toISOString() });
    // The second receipt keeps the real arrival time too, instead of being pushed a millisecond past the deadline.
    expect(two.body).toMatchObject({ late: false, uploadedAt: deadline.toISOString() });

    const files = await db.submissionFile.findMany({ orderBy: { version: "asc" } });
    expect(files.map((f) => [f.version, f.originalName, f.uploadedAt.toISOString()])).toEqual([
      [1, "first.pdf", deadline.toISOString()],
      [2, "second.pdf", deadline.toISOString()],
    ]);
    const submission = await db.submission.findFirstOrThrow();
    expect(submission.lastSubmittedAt.toISOString()).toBe(deadline.toISOString());
  });
});
