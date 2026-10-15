import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { POST as confirmRoute } from "@/app/api/assessments/[id]/submission/confirm/route";
import { POST as uploadUrlRoute } from "@/app/api/assessments/[id]/submission/upload-url/route";
import { GET as downloadRoute } from "@/app/api/files/[fileId]/download/route";
import { GET as myAssessmentsRoute } from "@/app/api/me/assessments/route";
import { GET as mySubmissionRoute } from "@/app/api/me/assessments/[id]/submission/route";
import { db } from "@/lib/db";
import type {
  MyAssessmentDetail,
  MyAssessmentList,
  Receipt,
  UploadUrlResult,
} from "@/lib/services/submissions";
import { UPLOAD_URL_SECONDS } from "@/lib/services/submissions";
import { deletePrefix, headObject, putObject, submissionPrefix } from "@/lib/storage";
import { UPLOAD_MIME_TYPES } from "@/lib/validation/submissions";
import { asStaff, asStudent, call } from "../../support/api";
import {
  createAssessment,
  createExtension,
  createModule,
  createProgramme,
  createStaff,
  createStudent,
  createSubmission,
  createSubmissionFile,
  linkModule,
} from "../../support/factories";
import { isFilesystemRun } from "../../support/test-storage";
import { buildDocx, buildMacroDocx } from "../../support/zip";

// The student upload flow end to end (api.md "Submissions and files", D-013, D-023): real Postgres, real MinIO, the Route
// Handlers called directly, and the file PUT with plain `fetch` to the presigned URL using only the headers the API hands
// out, as a browser would. The routes use the real clock, so deadlines are set relative to now.

type ErrorBody = {
  error: { code: string; message: string; details?: Record<string, unknown> };
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MB = 1024 * 1024;
// Storage stamps arrival to the second and a moment passes between setting a deadline and uploading, so an offset that is
// asserted as "N hours late" carries a minute of slack to stay clear of the unit boundary.
const SLACK = 60_000;
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

const FIXTURES = path.resolve(import.meta.dirname, "../../../db/seed/fixtures");
const SAMPLE_PDF = readFileSync(path.join(FIXTURES, "sample.pdf"));
const SAMPLE_DOCX = readFileSync(path.join(FIXTURES, "sample.docx"));

/** A valid PDF whose bytes (and so SHA-256) are unique to this call. */
const pdf = () => Buffer.concat([SAMPLE_PDF, Buffer.from(`\n% ${randomUUID()}\n`)]);
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

// --- Helpers -------------------------------------------------------------------------------------------------------

type StudentStatus = "ENROLLED" | "DEFERRED" | "WITHDRAWN" | "COMPLETED";

async function setup(
  options: {
    /** Offset of the deadline from now; default one day ahead. */
    deadlineIn?: number;
    closed?: boolean;
    status?: StudentStatus;
    /** `false`: the module is not in the student's programme. */
    inProgramme?: boolean;
  } = {},
) {
  const staff = await createStaff();
  const programme = await createProgramme();
  const mod = await createModule();
  if (options.inProgramme !== false) await linkModule(programme.id, mod.id);
  const student = await createStudent({ programmeId: programme.id, status: options.status });
  const deadline = new Date(Date.now() + (options.deadlineIn ?? DAY));
  const assessment = await createAssessment({
    moduleId: mod.id,
    createdById: staff.id,
    deadline,
    closedAt: options.closed ? new Date(Date.now() - HOUR) : null,
  });
  return {
    staff,
    programme,
    mod,
    student,
    assessment,
    deadline,
    cookie: asStudent(student.id),
  };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

function issue(assessmentId: string, cookie: string | undefined, body: unknown) {
  return call<UploadUrlResult & ErrorBody>(uploadUrlRoute, {
    method: "POST",
    path: `/api/assessments/${assessmentId}/submission/upload-url`,
    params: { id: assessmentId },
    cookie,
    body,
  });
}

function confirm(assessmentId: string, cookie: string | undefined, body: unknown) {
  return call<Receipt & ErrorBody>(confirmRoute, {
    method: "POST",
    path: `/api/assessments/${assessmentId}/submission/confirm`,
    params: { id: assessmentId },
    cookie,
    body,
  });
}

/** PUTs bytes to a presigned URL with exactly the headers the API returned (unless overridden). */
function put(
  issued: UploadUrlResult,
  bytes: Buffer,
  headers: Record<string, string> = issued.headers,
) {
  return fetch(issued.uploadUrl, { method: "PUT", headers, body: new Uint8Array(bytes) });
}

const typeFor = (fileName: string) =>
  fileName.toLowerCase().endsWith(".docx") ? UPLOAD_MIME_TYPES.docx : UPLOAD_MIME_TYPES.pdf;

/** Step 1 for a file: asks for the URL, declaring the file's real name, type and size. */
async function request(ctx: Ctx, fileName: string, bytes: Buffer) {
  const result = await issue(ctx.assessment.id, ctx.cookie, {
    fileName,
    contentType: typeFor(fileName),
    sizeBytes: bytes.length,
  });
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  return result.body;
}

/** The whole flow: URL, PUT, confirm. Returns the confirm result. */
async function submit(ctx: Ctx, fileName: string, bytes: Buffer) {
  const issued = await request(ctx, fileName, bytes);
  const stored = await put(issued, bytes);
  expect(stored.status).toBe(200);
  return {
    issued,
    result: await confirm(ctx.assessment.id, ctx.cookie, {
      pendingUploadId: issued.pendingUploadId,
    }),
  };
}

const pendingRow = (id: string) => db.pendingUpload.findUniqueOrThrow({ where: { id } });

// --- POST .../submission/upload-url ---------------------------------------------------------------------------------

describe("POST /api/assessments/{id}/submission/upload-url", () => {
  it("issues a presigned PUT for a server-chosen key and records a pending upload", async () => {
    const ctx = await setup();
    const bytes = pdf();
    const before = Date.now();
    const issued = await request(ctx, "My Essay.pdf", bytes);

    expect(Object.keys(issued).sort()).toEqual([
      "expiresAt",
      "headers",
      "late",
      "pendingUploadId",
      "uploadUrl",
    ]);
    expect(issued.headers).toEqual({ "Content-Type": "application/pdf" });
    expect(issued.late).toBe(false);
    expect(UPLOAD_URL_SECONDS).toBe(900);
    const expiresIn = new Date(issued.expiresAt).getTime() - before;
    expect(expiresIn).toBeGreaterThan(14 * 60_000);
    expect(expiresIn).toBeLessThan(16 * 60_000);
    // S3 states the lifetime in the URL; the filesystem driver keeps it inside the signed token.
    if (!isFilesystemRun()) {
      expect(new URL(issued.uploadUrl).searchParams.get("X-Amz-Expires")).toBe("900");
    }

    const pending = await pendingRow(issued.pendingUploadId);
    expect(pending).toMatchObject({
      assessmentId: ctx.assessment.id,
      studentId: ctx.student.id,
      originalName: "My Essay.pdf",
      mimeType: "application/pdf",
      sizeBytes: bytes.length,
      confirmedAt: null,
    });
    expect(pending.expiresAt.toISOString()).toBe(issued.expiresAt);
    // The key is the server's: it never contains the student's file name. It is a pending key, not the final home of
    // the file: that one is made at confirm, and no URL is ever signed for it (D-042).
    expect(pending.objectKey).toMatch(
      new RegExp(`^pending/${ctx.assessment.id}/${ctx.student.id}/[0-9a-f-]{36}\\.pdf$`),
    );
    expect(pending.finalObjectKey).toBeNull();
    expect(issued.uploadUrl).not.toContain("Essay");

    const stored = await put(issued, bytes);
    expect(stored.status).toBe(200);
    expect((await headObject(pending.objectKey))?.sizeBytes).toBe(bytes.length);
  });

  it("makes storage itself refuse a different type or a body of a different length", async () => {
    const ctx = await setup();
    const bytes = pdf();
    const issued = await request(ctx, "essay.pdf", bytes);

    const wrongType = await put(issued, bytes, { "Content-Type": "text/html" });
    expect(wrongType.status).toBe(403);
    const longer = await put(issued, Buffer.concat([bytes, Buffer.from("extra")]));
    expect(longer.status).toBe(403);
    const shorter = await put(issued, bytes.subarray(0, bytes.length - 1));
    expect(shorter.status).toBe(403);

    expect(await headObject((await pendingRow(issued.pendingUploadId)).objectKey)).toBeNull();
  });

  it("accepts a DOCX and keeps a Bengali file name", async () => {
    const ctx = await setup();
    const issued = await request(ctx, "প্রতিবেদন.docx", SAMPLE_DOCX);
    expect((await pendingRow(issued.pendingUploadId)).originalName).toBe("প্রতিবেদন.docx");
    expect(issued.headers["Content-Type"]).toBe(UPLOAD_MIME_TYPES.docx);
  });

  it("tells the student a first upload after the deadline will be marked late", async () => {
    const ctx = await setup({ deadlineIn: -HOUR });
    expect((await request(ctx, "late.pdf", pdf())).late).toBe(true);
  });

  it("allows a late submission to be replaced, and an on-time one before the deadline", async () => {
    const lateCtx = await setup({ deadlineIn: -3 * HOUR });
    const lateSubmission = await createSubmission({
      assessmentId: lateCtx.assessment.id,
      studentId: lateCtx.student.id,
      submittedAt: new Date(Date.now() - HOUR), // after the deadline
    });
    expect(lateSubmission.id).toBeDefined();
    expect((await request(lateCtx, "again.pdf", pdf())).late).toBe(true);

    const openCtx = await setup({ deadlineIn: DAY });
    await createSubmission({
      assessmentId: openCtx.assessment.id,
      studentId: openCtx.student.id,
      submittedAt: new Date(Date.now() - HOUR),
    });
    expect((await request(openCtx, "again.pdf", pdf())).late).toBe(false);
  });

  describe("validation (400)", () => {
    const valid = { fileName: "essay.pdf", contentType: UPLOAD_MIME_TYPES.pdf, sizeBytes: 100 };

    it.each([
      ["a .docm file", { ...valid, fileName: "macros.docm" }, "fileName", /Macro-enabled/],
      ["a .exe file", { ...valid, fileName: "setup.exe" }, "fileName", /Only PDF/],
      ["a file with no extension", { ...valid, fileName: "essay" }, "fileName", /Only PDF/],
      [
        "a type that does not match the extension",
        { ...valid, contentType: UPLOAD_MIME_TYPES.docx },
        "contentType",
        /must be sent as/,
      ],
      ["an empty file", { ...valid, sizeBytes: 0 }, "sizeBytes", /empty/],
      ["a negative size", { ...valid, sizeBytes: -1 }, "sizeBytes", undefined],
      ["a fractional size", { ...valid, sizeBytes: 10.5 }, "sizeBytes", undefined],
      ["a missing body field", { fileName: "essay.pdf" }, "contentType", undefined],
      [
        "a file over the limit",
        { ...valid, sizeBytes: 20 * MB + 1 },
        "sizeBytes",
        /too large\. The limit is 20 MB/,
      ],
    ])("rejects %s", async (_name, body, field, message) => {
      const ctx = await setup();
      const result = await issue(ctx.assessment.id, ctx.cookie, body);
      expect(result.status).toBe(400);
      expect(result.body.error.code).toBe("VALIDATION_ERROR");
      const fieldErrors = result.body.error.details?.fieldErrors as Record<string, string[]>;
      expect(fieldErrors[field]).toBeDefined();
      if (message) expect(fieldErrors[field]?.[0]).toMatch(message);
      expect(await db.pendingUpload.count()).toBe(0);
    });

    it("accepts a file exactly at the limit", async () => {
      const ctx = await setup();
      const result = await issue(ctx.assessment.id, ctx.cookie, { ...valid, sizeBytes: 20 * MB });
      expect(result.status).toBe(200);
    });

    it("rejects a body that is not JSON", async () => {
      const ctx = await setup();
      const result = await issue(ctx.assessment.id, ctx.cookie, "not json");
      expect(result.status).toBe(400);
    });
  });

  describe("upload rules (422 BUSINESS_RULE)", () => {
    const body = { fileName: "essay.pdf", contentType: UPLOAD_MIME_TYPES.pdf, sizeBytes: 100 };

    it.each([
      ["a deferred student", { status: "DEFERRED" as const }, "NOT_ENROLLED"],
      ["a withdrawn student", { status: "WITHDRAWN" as const }, "NOT_ENROLLED"],
      ["a completed student", { status: "COMPLETED" as const }, "NOT_ENROLLED"],
      ["a module that is not in the programme", { inProgramme: false }, "MODULE_NOT_IN_PROGRAMME"],
      ["a closed assessment", { closed: true }, "CLOSED"],
      ["a closed assessment past its deadline", { closed: true, deadlineIn: -DAY }, "CLOSED"],
    ])("blocks %s", async (_name, options, rule) => {
      const ctx = await setup(options);
      const result = await issue(ctx.assessment.id, ctx.cookie, body);
      expect(result.status).toBe(422);
      expect(result.body.error.code).toBe("BUSINESS_RULE");
      expect(result.body.error.details?.rule).toBe(rule);
      expect(result.body.error.message.length).toBeGreaterThan(20);
      expect(await db.pendingUpload.count()).toBe(0); // nothing is issued
    });

    it("blocks replacing an on-time submission once the deadline has passed", async () => {
      const ctx = await setup({ deadlineIn: -2 * HOUR });
      await createSubmission({
        assessmentId: ctx.assessment.id,
        studentId: ctx.student.id,
        submittedAt: new Date(ctx.deadline.getTime() - HOUR),
      });
      const result = await issue(ctx.assessment.id, ctx.cookie, body);
      expect(result.status).toBe(422);
      expect(result.body.error.details?.rule).toBe("ON_TIME_LOCKED");
    });

    it("reports the first failing rule: not enrolled before closed", async () => {
      const ctx = await setup({ status: "WITHDRAWN", closed: true });
      const result = await issue(ctx.assessment.id, ctx.cookie, body);
      expect(result.body.error.details?.rule).toBe("NOT_ENROLLED");
    });

    it("honours an extension: a student with more time is not late yet", async () => {
      const ctx = await setup({ deadlineIn: -HOUR });
      await createExtension({
        assessmentId: ctx.assessment.id,
        studentId: ctx.student.id,
        newDeadline: new Date(Date.now() + DAY),
      });
      expect((await request(ctx, "essay.pdf", pdf())).late).toBe(false);
    });
  });

  describe("access", () => {
    const body = { fileName: "essay.pdf", contentType: UPLOAD_MIME_TYPES.pdf, sizeBytes: 100 };

    it("answers 401 without a session", async () => {
      const ctx = await setup();
      const result = await issue(ctx.assessment.id, undefined, body);
      expect(result.status).toBe(401);
      expect(result.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("answers 403 to staff, before looking at the body", async () => {
      const ctx = await setup();
      const forStaff = await issue(ctx.assessment.id, asStaff(ctx.staff.id), body);
      expect(forStaff.status).toBe(403);
      expect(forStaff.body.error.code).toBe("FORBIDDEN");
      expect((await issue(ctx.assessment.id, asStaff(ctx.staff.id), {})).status).toBe(403);
    });

    it("answers 401 for a student who no longer exists", async () => {
      const ctx = await setup();
      const gone = await createStudent();
      const cookie = asStudent(gone.id);
      await db.student.delete({ where: { id: gone.id } });
      expect((await issue(ctx.assessment.id, cookie, body)).status).toBe(401);
    });

    it("answers 404 for an unknown or malformed assessment id", async () => {
      const ctx = await setup();
      expect((await issue(UNKNOWN_ID, ctx.cookie, body)).status).toBe(404);
      expect((await issue("not-a-uuid", ctx.cookie, body)).status).toBe(404);
    });
  });
});

// --- POST .../submission/confirm -------------------------------------------------------------------------------------

describe("POST /api/assessments/{id}/submission/confirm", () => {
  it("records the file and answers a receipt with the fingerprint and arrival time", async () => {
    const ctx = await setup();
    const bytes = pdf();
    const { issued, result } = await submit(ctx, "Final report.pdf", bytes);

    expect(result.status).toBe(200);
    const receipt = result.body;
    expect(Object.keys(receipt).sort()).toEqual([
      "fileName",
      "late",
      "lateBy",
      "sha256",
      "sizeBytes",
      "submissionId",
      "uploadedAt",
    ]);
    expect(receipt).toMatchObject({
      fileName: "Final report.pdf",
      sizeBytes: bytes.length,
      sha256: sha(bytes),
      late: false,
      lateBy: null,
    });
    // Submission time is when the object arrived in storage, not when the URL was issued.
    expect(Math.abs(new Date(receipt.uploadedAt).getTime() - Date.now())).toBeLessThan(60_000);

    const submission = await db.submission.findUniqueOrThrow({
      where: { id: receipt.submissionId },
      include: { files: true },
    });
    expect(submission).toMatchObject({
      assessmentId: ctx.assessment.id,
      studentId: ctx.student.id,
    });
    expect(submission.firstSubmittedAt.toISOString()).toBe(receipt.uploadedAt);
    expect(submission.lastSubmittedAt.toISOString()).toBe(receipt.uploadedAt);
    expect(submission.files).toHaveLength(1);
    expect(submission.files[0]).toMatchObject({
      originalName: "Final report.pdf",
      mimeType: "application/pdf",
      sizeBytes: bytes.length,
      sha256: sha(bytes),
    });
    const confirmedPending = await pendingRow(issued.pendingUploadId);
    expect(confirmedPending.confirmedAt).not.toBeNull();
    // The file is recorded at its own server-only key; the staging object the URL wrote is gone (D-042).
    expect(submission.files[0]!.objectKey).toMatch(
      new RegExp(`^submissions/${ctx.assessment.id}/${ctx.student.id}/[0-9a-f-]{36}\\.pdf$`),
    );
    expect(confirmedPending.finalObjectKey).toBe(submission.files[0]!.objectKey);
    expect(submission.files[0]!.version).toBe(1);
    expect(await headObject(confirmedPending.objectKey)).toBeNull();

    // The student can download exactly what they uploaded.
    const fileId = submission.files[0]!.id;
    const link = await call<{ url: string }>(downloadRoute, {
      path: `/api/files/${fileId}/download`,
      params: { fileId },
      cookie: ctx.cookie,
    });
    expect(link.status).toBe(200);
    expect(sha(Buffer.from(await (await fetch(link.body.url)).arrayBuffer()))).toBe(sha(bytes));
  });

  it("accepts a real DOCX", async () => {
    const ctx = await setup();
    const { result } = await submit(ctx, "essay.docx", SAMPLE_DOCX);
    expect(result.status).toBe(200);
    expect(result.body.sha256).toBe(sha(SAMPLE_DOCX));
    expect(
      (
        await db.submissionFile.findFirstOrThrow({
          where: { submissionId: result.body.submissionId },
        })
      ).mimeType,
    ).toBe(UPLOAD_MIME_TYPES.docx);
  });

  it("answers the same receipt for a repeated confirm and creates one version (double click)", async () => {
    const ctx = await setup();
    const { issued, result } = await submit(ctx, "essay.pdf", pdf());
    const again = await confirm(ctx.assessment.id, ctx.cookie, {
      pendingUploadId: issued.pendingUploadId,
    });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(result.body);
    expect(await db.submissionFile.count()).toBe(1);
  });

  it("creates exactly one version when several confirms arrive at once", async () => {
    const ctx = await setup();
    const bytes = pdf();
    const issued = await request(ctx, "essay.pdf", bytes);
    await put(issued, bytes);

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        confirm(ctx.assessment.id, ctx.cookie, { pendingUploadId: issued.pendingUploadId }),
      ),
    );
    for (const r of results) expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(new Set(results.map((r) => JSON.stringify(r.body))).size).toBe(1);
    expect(await db.submissionFile.count()).toBe(1);
    expect(await db.submission.count()).toBe(1);
    // Each racing confirm made its own copy; all but the recorded one were deleted again (D-042).
    const file = await db.submissionFile.findFirstOrThrow();
    expect(await deletePrefix(submissionPrefix(ctx.assessment.id, ctx.student.id))).toBe(1);
    expect(file.objectKey.startsWith(submissionPrefix(ctx.assessment.id, ctx.student.id))).toBe(
      true,
    );
  });

  it("creates two versions, in order, when two different uploads are confirmed at once", async () => {
    const ctx = await setup();
    const [a, b] = [pdf(), pdf()];
    const issuedA = await request(ctx, "a.pdf", a);
    const issuedB = await request(ctx, "b.pdf", b);
    await Promise.all([put(issuedA, a), put(issuedB, b)]);

    const results = await Promise.all([
      confirm(ctx.assessment.id, ctx.cookie, { pendingUploadId: issuedA.pendingUploadId }),
      confirm(ctx.assessment.id, ctx.cookie, { pendingUploadId: issuedB.pendingUploadId }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(await db.submission.count()).toBe(1);
    // Versions have their own numbers: 1 and 2, whichever order the two confirms ran in, even in the same second.
    const files = await db.submissionFile.findMany({ orderBy: { version: "asc" } });
    expect(files.map((f) => f.version)).toEqual([1, 2]);
    expect(files.map((f) => f.originalName).sort()).toEqual(["a.pdf", "b.pdf"]);
    const submission = await db.submission.findFirstOrThrow();
    expect(submission.lastSubmittedAt.toISOString()).toBe(files[1]!.uploadedAt.toISOString());
  });

  it("adds a version when the student replaces their file, keeping the first time", async () => {
    const ctx = await setup();
    const first = await submit(ctx, "first.pdf", pdf());
    const second = await submit(ctx, "second.docx", SAMPLE_DOCX);

    expect(second.result.body.submissionId).toBe(first.result.body.submissionId);
    const submission = await db.submission.findUniqueOrThrow({
      where: { id: first.result.body.submissionId },
    });
    expect(submission.firstSubmittedAt.toISOString()).toBe(first.result.body.uploadedAt);
    expect(submission.lastSubmittedAt.toISOString()).toBe(second.result.body.uploadedAt);
    // Arrival times are kept exactly as storage gave them (one-second resolution), so two files can share a time.
    expect(new Date(second.result.body.uploadedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(first.result.body.uploadedAt).getTime(),
    );

    // Both versions are kept; the newer one is the current file, even if both arrived in the same second.
    const detail = await call<MyAssessmentDetail>(mySubmissionRoute, {
      path: `/api/me/assessments/${ctx.assessment.id}/submission`,
      params: { id: ctx.assessment.id },
      cookie: ctx.cookie,
    });
    const mine = detail.body.assessment.submission!;
    expect(mine.versions.map((v) => [v.version, v.fileName])).toEqual([
      [2, "second.docx"],
      [1, "first.pdf"],
    ]);
    expect(mine.currentFile.fileName).toBe("second.docx");
  });

  describe("lateness (D-023)", () => {
    it("accepts a first submission after the deadline and flags it late, with how late", async () => {
      const ctx = await setup({ deadlineIn: -(3 * HOUR + SLACK) });
      const { result } = await submit(ctx, "late.pdf", pdf());
      expect(result.status).toBe(200);
      expect(result.body.late).toBe(true);
      expect(result.body.lateBy).toBe("3 hours");
    });

    it("lets a late submission be replaced, and the replacement is late too", async () => {
      const ctx = await setup({ deadlineIn: -(2 * DAY + SLACK) });
      await submit(ctx, "late-1.pdf", pdf());
      const { result } = await submit(ctx, "late-2.pdf", pdf());
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ late: true, lateBy: "2 days" });
      expect(await db.submissionFile.count()).toBe(2);
    });

    it("measures lateness against the student's extension", async () => {
      const ctx = await setup({ deadlineIn: -5 * HOUR });
      await createExtension({
        assessmentId: ctx.assessment.id,
        studentId: ctx.student.id,
        newDeadline: new Date(Date.now() - (2 * HOUR + SLACK)),
      });
      const { result } = await submit(ctx, "late.pdf", pdf());
      expect(result.body).toMatchObject({ late: true, lateBy: "2 hours" });
    });

    it("counts the arrival time, not the time the URL was issued: URL issued before the deadline, file arrived after", async () => {
      const ctx = await setup({ deadlineIn: DAY });
      const bytes = pdf();
      const issued = await request(ctx, "essay.pdf", bytes);
      expect(issued.late).toBe(false);
      await put(issued, bytes);
      // The deadline falls between issue and arrival: move it into the past (before the object's arrival second).
      await db.assessment.update({
        where: { id: ctx.assessment.id },
        data: { deadline: new Date(Date.now() - 10_000) },
      });
      const result = await confirm(ctx.assessment.id, ctx.cookie, {
        pendingUploadId: issued.pendingUploadId,
      });
      expect(result.status).toBe(200);
      expect(result.body.late).toBe(true);
    });

    it("keeps an on-time submission on time when its replacement arrived before the deadline", async () => {
      const ctx = await setup({ deadlineIn: DAY });
      const first = await submit(ctx, "first.pdf", pdf());
      const second = await submit(ctx, "second.pdf", pdf());
      expect(first.result.body.late).toBe(false);
      expect(second.result.body.late).toBe(false);
    });
  });

  describe("rules are checked again at confirm, with the arrival time as now", () => {
    async function uploadedButNotConfirmed(ctx: Ctx) {
      const bytes = pdf();
      const issued = await request(ctx, "essay.pdf", bytes);
      await put(issued, bytes);
      const pending = await pendingRow(issued.pendingUploadId);
      return { issued, pending };
    }

    it("rejects and deletes the file when the assessment was closed after the URL was issued", async () => {
      const ctx = await setup();
      const { issued, pending } = await uploadedButNotConfirmed(ctx);
      await db.assessment.update({
        where: { id: ctx.assessment.id },
        data: { closedAt: new Date() },
      });

      const result = await confirm(ctx.assessment.id, ctx.cookie, {
        pendingUploadId: issued.pendingUploadId,
      });
      expect(result.status).toBe(422);
      expect(result.body.error.details?.rule).toBe("CLOSED");
      expect(await headObject(pending.objectKey)).toBeNull();
      expect(await db.pendingUpload.count()).toBe(0);
      expect(await db.submission.count()).toBe(0);
    });

    it("rejects when the student was deferred in the meantime", async () => {
      const ctx = await setup();
      const { issued, pending } = await uploadedButNotConfirmed(ctx);
      await db.student.update({ where: { id: ctx.student.id }, data: { status: "DEFERRED" } });

      const result = await confirm(ctx.assessment.id, ctx.cookie, {
        pendingUploadId: issued.pendingUploadId,
      });
      expect(result.status).toBe(422);
      expect(result.body.error.details?.rule).toBe("NOT_ENROLLED");
      expect(await headObject(pending.objectKey)).toBeNull();
    });

    it("rejects replacing an on-time submission when the deadline passed before the new file arrived", async () => {
      const ctx = await setup({ deadlineIn: DAY });
      await createSubmission({
        assessmentId: ctx.assessment.id,
        studentId: ctx.student.id,
        submittedAt: new Date(Date.now() - 2 * HOUR),
      });
      const { issued, pending } = await uploadedButNotConfirmed(ctx);
      await db.assessment.update({
        where: { id: ctx.assessment.id },
        data: { deadline: new Date(Date.now() - 30_000) },
      });

      const result = await confirm(ctx.assessment.id, ctx.cookie, {
        pendingUploadId: issued.pendingUploadId,
      });
      expect(result.status).toBe(422);
      expect(result.body.error.details?.rule).toBe("ON_TIME_LOCKED");
      expect(await headObject(pending.objectKey)).toBeNull();
      expect(await db.submissionFile.count()).toBe(0); // the original (file-less in this fixture) is untouched
      expect(await db.submission.count()).toBe(1);
    });
  });

  describe("file checks (400): the object is deleted and the pending upload dropped", () => {
    /** Stores `stored` under the pending upload's key (as a hostile client might) and confirms. */
    async function confirmWithStored(ctx: Ctx, fileName: string, declared: Buffer, stored: Buffer) {
      const issued = await request(ctx, fileName, declared);
      const pending = await pendingRow(issued.pendingUploadId);
      await putObject(pending.objectKey, stored, typeFor(fileName));
      const result = await confirm(ctx.assessment.id, ctx.cookie, {
        pendingUploadId: issued.pendingUploadId,
      });
      return { result, pending };
    }

    async function expectRejected(
      outcome: Awaited<ReturnType<typeof confirmWithStored>>,
      message: RegExp,
    ) {
      expect(outcome.result.status).toBe(400);
      expect(outcome.result.body.error.code).toBe("VALIDATION_ERROR");
      expect(outcome.result.body.error.message).toMatch(message);
      const fieldErrors = outcome.result.body.error.details?.fieldErrors as Record<
        string,
        string[]
      >;
      expect(fieldErrors.file?.[0]).toMatch(message);
      expect(await headObject(outcome.pending.objectKey)).toBeNull();
      expect(await db.pendingUpload.count({ where: { id: outcome.pending.id } })).toBe(0);
      expect(await db.submission.count()).toBe(0);
      // No copy of the rejected file is left under a final key.
      expect(
        await deletePrefix(
          submissionPrefix(outcome.pending.assessmentId, outcome.pending.studentId),
        ),
      ).toBe(0);
    }

    it("rejects text with a .pdf name (checked by content, not extension)", async () => {
      const ctx = await setup();
      const text = Buffer.from("This is just a text file renamed to .pdf, with enough bytes.");
      await expectRejected(
        await confirmWithStored(ctx, "essay.pdf", text, text),
        /not a valid PDF/,
      );
    });

    it("rejects a PDF uploaded with a .docx name", async () => {
      const ctx = await setup();
      const bytes = pdf();
      await expectRejected(
        await confirmWithStored(ctx, "essay.docx", bytes, bytes),
        /not a valid Word/,
      );
    });

    it("rejects a Word document uploaded with a .pdf name", async () => {
      const ctx = await setup();
      await expectRejected(
        await confirmWithStored(ctx, "essay.pdf", SAMPLE_DOCX, SAMPLE_DOCX),
        /not a valid PDF/,
      );
    });

    it("rejects a ZIP that is not a Word document", async () => {
      const ctx = await setup();
      const zip = buildDocx().subarray(0, 40); // right start, no directory
      await expectRejected(
        await confirmWithStored(ctx, "essay.docx", zip, zip),
        /not a valid Word/,
      );
    });

    it("rejects a macro-enabled document renamed .docx", async () => {
      const ctx = await setup();
      const macro = buildMacroDocx();
      await expectRejected(await confirmWithStored(ctx, "essay.docx", macro, macro), /macros/);
    });

    it("rejects an empty file", async () => {
      const ctx = await setup();
      const outcome = await confirmWithStored(ctx, "essay.pdf", pdf(), Buffer.alloc(0));
      await expectRejected(outcome, /empty/);
    });

    it("rejects a file whose size is not the announced size", async () => {
      const ctx = await setup();
      const declared = pdf();
      const other = Buffer.concat([declared, Buffer.from("more bytes than announced")]);
      await expectRejected(
        await confirmWithStored(ctx, "essay.pdf", declared, other),
        /not the size that was announced/,
      );
    });

    it("rejects a file over the size limit even when it was announced truthfully", async () => {
      const ctx = await setup();
      // A hostile client announces a small file (accepted), then stores a huge one with server credentials of its own.
      const big = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(21 * MB)]);
      await expectRejected(
        await confirmWithStored(ctx, "essay.pdf", pdf(), big),
        /too large\. The limit is 20 MB/,
      );
    });
  });

  describe("pending upload states", () => {
    it("answers 422 UPLOAD_NOT_FOUND when nothing was uploaded, and works once it has been", async () => {
      const ctx = await setup();
      const bytes = pdf();
      const issued = await request(ctx, "essay.pdf", bytes);

      const early = await confirm(ctx.assessment.id, ctx.cookie, {
        pendingUploadId: issued.pendingUploadId,
      });
      expect(early.status).toBe(422);
      expect(early.body.error.code).toBe("BUSINESS_RULE");
      expect(early.body.error.details?.rule).toBe("UPLOAD_NOT_FOUND");
      expect(await db.pendingUpload.count()).toBe(1); // kept: the upload may still be in flight

      await put(issued, bytes);
      const later = await confirm(ctx.assessment.id, ctx.cookie, {
        pendingUploadId: issued.pendingUploadId,
      });
      expect(later.status).toBe(200);
    });

    it("answers 422 UPLOAD_EXPIRED for an expired pending upload and cleans it up", async () => {
      const ctx = await setup();
      const bytes = pdf();
      const issued = await request(ctx, "essay.pdf", bytes);
      await put(issued, bytes);
      const pending = await pendingRow(issued.pendingUploadId);
      await db.pendingUpload.update({
        where: { id: pending.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const result = await confirm(ctx.assessment.id, ctx.cookie, {
        pendingUploadId: issued.pendingUploadId,
      });
      expect(result.status).toBe(422);
      expect(result.body.error.details?.rule).toBe("UPLOAD_EXPIRED");
      expect(await headObject(pending.objectKey)).toBeNull();
      expect(await db.pendingUpload.count()).toBe(0);
      expect(await db.submission.count()).toBe(0);
    });

    it("still returns the receipt for an upload that was confirmed before it expired", async () => {
      const ctx = await setup();
      const { issued, result } = await submit(ctx, "essay.pdf", pdf());
      await db.pendingUpload.update({
        where: { id: issued.pendingUploadId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const again = await confirm(ctx.assessment.id, ctx.cookie, {
        pendingUploadId: issued.pendingUploadId,
      });
      expect(again.status).toBe(200);
      expect(again.body).toEqual(result.body);
    });

    it("answers 404 for another student's pending upload, and for an unknown one", async () => {
      const ctx = await setup();
      const bytes = pdf();
      const issued = await request(ctx, "essay.pdf", bytes);
      await put(issued, bytes);

      const other = await createStudent({ programmeId: ctx.programme.id });
      const foreign = await confirm(ctx.assessment.id, asStudent(other.id), {
        pendingUploadId: issued.pendingUploadId,
      });
      const unknown = await confirm(ctx.assessment.id, asStudent(other.id), {
        pendingUploadId: UNKNOWN_ID,
      });
      expect(foreign.status).toBe(404);
      expect(foreign.body).toEqual(unknown.body); // nothing reveals that the upload exists
      // The owner's upload was not disturbed.
      expect(await headObject((await pendingRow(issued.pendingUploadId)).objectKey)).not.toBeNull();
      expect(await db.submission.count()).toBe(0);
    });

    it("answers 404 when the pending upload belongs to a different assessment", async () => {
      const ctx = await setup();
      const bytes = pdf();
      const issued = await request(ctx, "essay.pdf", bytes);
      await put(issued, bytes);
      const otherAssessment = await createAssessment({
        moduleId: ctx.mod.id,
        createdById: ctx.staff.id,
      });
      const result = await confirm(otherAssessment.id, ctx.cookie, {
        pendingUploadId: issued.pendingUploadId,
      });
      expect(result.status).toBe(404);
    });

    it("answers 400 for a pendingUploadId that is not an id, and 404 for a malformed assessment id", async () => {
      const ctx = await setup();
      expect(
        (await confirm(ctx.assessment.id, ctx.cookie, { pendingUploadId: "nope" })).status,
      ).toBe(400);
      expect((await confirm(ctx.assessment.id, ctx.cookie, {})).status).toBe(400);
      expect(
        (await confirm("not-a-uuid", ctx.cookie, { pendingUploadId: UNKNOWN_ID })).status,
      ).toBe(404);
    });
  });

  describe("access", () => {
    it("answers 401 without a session, and 403 to staff", async () => {
      const ctx = await setup();
      const body = { pendingUploadId: UNKNOWN_ID };
      const none = await confirm(ctx.assessment.id, undefined, body);
      expect(none.status).toBe(401);
      expect(none.body.error.code).toBe("UNAUTHENTICATED");
      const staff = await confirm(ctx.assessment.id, asStaff(ctx.staff.id), body);
      expect(staff.status).toBe(403);
      expect(staff.body.error.code).toBe("FORBIDDEN");
    });
  });
});

// --- GET /api/me/assessments and /api/me/assessments/{id}/submission -----------------------------------------------------

function myList(cookie: string | undefined) {
  return call<MyAssessmentList & ErrorBody>(myAssessmentsRoute, {
    path: "/api/me/assessments",
    cookie,
  });
}

function myDetail(id: string, cookie: string | undefined) {
  return call<MyAssessmentDetail & ErrorBody>(mySubmissionRoute, {
    path: `/api/me/assessments/${id}/submission`,
    params: { id },
    cookie,
  });
}

describe("GET /api/me/assessments", () => {
  it("lists the assessments of the programme's modules, nearest open deadline first, then the rest", async () => {
    const ctx = await setup({ deadlineIn: 3 * DAY });
    const soon = await createAssessment({
      moduleId: ctx.mod.id,
      createdById: ctx.staff.id,
      title: "Soon",
      deadline: new Date(Date.now() + DAY),
    });
    const past = await createAssessment({
      moduleId: ctx.mod.id,
      createdById: ctx.staff.id,
      title: "Past",
      deadline: new Date(Date.now() - DAY),
    });
    const older = await createAssessment({
      moduleId: ctx.mod.id,
      createdById: ctx.staff.id,
      title: "Older",
      deadline: new Date(Date.now() - 5 * DAY),
    });
    const closed = await createAssessment({
      moduleId: ctx.mod.id,
      createdById: ctx.staff.id,
      title: "Closed",
      deadline: new Date(Date.now() + 2 * DAY),
      closedAt: new Date(),
    });
    // Not theirs: a module in another programme.
    const foreignModule = await createModule();
    await createAssessment({ moduleId: foreignModule.id, createdById: ctx.staff.id });

    const result = await myList(ctx.cookie);
    expect(result.status).toBe(200);
    expect(Math.abs(new Date(result.body.now).getTime() - Date.now())).toBeLessThan(10_000);
    // Open ones by nearest deadline; then the rest, latest deadline first (a closed one counts as "the rest").
    expect(result.body.items.map((i) => i.id)).toEqual([
      soon.id,
      ctx.assessment.id,
      closed.id,
      past.id,
      older.id,
    ]);
  });

  it("describes each assessment: deadline, state, status and whether the student can upload", async () => {
    const ctx = await setup({ deadlineIn: DAY });
    const result = await myList(ctx.cookie);
    expect(result.body.items).toHaveLength(1);
    const item = result.body.items[0]!;
    expect(item).toMatchObject({
      id: ctx.assessment.id,
      title: ctx.assessment.title,
      module: { id: ctx.mod.id, code: ctx.mod.code, title: ctx.mod.title },
      deadline: ctx.deadline.toISOString(),
      extended: false,
      closedAt: null,
      state: "open",
      status: "NOT_SUBMITTED",
      lateBy: null,
      canUpload: { allowed: true, reason: null, message: null, late: false },
      submission: null,
    });
  });

  it("orders versions by their version number, not by arrival time (code review #4)", async () => {
    const ctx = await setup({ deadlineIn: DAY });
    const submission = await createSubmission({
      assessmentId: ctx.assessment.id,
      studentId: ctx.student.id,
      submittedAt: new Date(Date.now() - 2 * HOUR),
    });
    // Version 2 was confirmed after version 1 but its file reached storage earlier.
    await createSubmissionFile({
      submissionId: submission.id,
      version: 1,
      uploadedAt: new Date(Date.now() - HOUR),
      originalName: "one.pdf",
    });
    await createSubmissionFile({
      submissionId: submission.id,
      version: 2,
      uploadedAt: new Date(Date.now() - 2 * HOUR),
      originalName: "two.pdf",
    });

    const mine = (await myList(ctx.cookie)).body.items[0]!.submission!;
    expect(mine.versions.map((v) => [v.version, v.fileName])).toEqual([
      [2, "two.pdf"],
      [1, "one.pdf"],
    ]);
    expect(mine.currentFile.fileName).toBe("two.pdf");
  });

  it("shows the student's own deadline when they have an extension", async () => {
    const ctx = await setup({ deadlineIn: -HOUR });
    const extended = new Date(Date.now() + 2 * DAY);
    await createExtension({
      assessmentId: ctx.assessment.id,
      studentId: ctx.student.id,
      newDeadline: extended,
    });
    const item = (await myList(ctx.cookie)).body.items[0]!;
    expect(item).toMatchObject({
      deadline: extended.toISOString(),
      extended: true,
      state: "open",
      canUpload: { allowed: true, late: false },
    });
  });

  it("includes the student's submission with every version and its receipt", async () => {
    const ctx = await setup({ deadlineIn: DAY });
    const first = await submit(ctx, "one.pdf", pdf());
    await submit(ctx, "two.pdf", pdf());
    const item = (await myList(ctx.cookie)).body.items[0]!;
    expect(item.status).toBe("ON_TIME");
    expect(item.submission?.id).toBe(first.result.body.submissionId);
    expect(item.submission?.versions).toHaveLength(2);
    expect(item.submission?.currentFile).toMatchObject({
      version: 2,
      fileName: "two.pdf",
      late: false,
    });
    expect(item.submission?.versions[1]).toMatchObject({
      version: 1,
      fileName: "one.pdf",
      sha256: first.result.body.sha256,
      sizeBytes: first.result.body.sizeBytes,
    });
  });

  it("explains in words why a student cannot upload", async () => {
    const closed = await setup({ closed: true });
    expect((await myList(closed.cookie)).body.items[0]).toMatchObject({
      state: "closed",
      status: "CLOSED",
      canUpload: { allowed: false, reason: "CLOSED" },
    });

    const deferred = await setup({ status: "DEFERRED" });
    const deferredItem = (await myList(deferred.cookie)).body.items[0]!;
    expect(deferredItem.canUpload).toMatchObject({ allowed: false, reason: "NOT_ENROLLED" });
    expect(deferredItem.canUpload.message).toMatch(/not currently enrolled/);

    const locked = await setup({ deadlineIn: -2 * HOUR });
    const onTime = await createSubmission({
      assessmentId: locked.assessment.id,
      studentId: locked.student.id,
      submittedAt: new Date(locked.deadline.getTime() - HOUR),
    });
    await createSubmissionFile({ submissionId: onTime.id, uploadedAt: onTime.lastSubmittedAt });
    expect((await myList(locked.cookie)).body.items[0]).toMatchObject({
      state: "past-deadline",
      status: "ON_TIME",
      canUpload: { allowed: false, reason: "ON_TIME_LOCKED" },
    });
  });

  it("marks a late submission and says by how much", async () => {
    const ctx = await setup({ deadlineIn: -(3 * HOUR + SLACK) });
    await submit(ctx, "late.pdf", pdf());
    const item = (await myList(ctx.cookie)).body.items[0]!;
    expect(item).toMatchObject({ status: "LATE", lateBy: "3 hours", state: "past-deadline" });
    // A late submission can still be replaced.
    expect(item.canUpload).toMatchObject({ allowed: true, late: true });
  });

  it("keeps showing an assessment the student submitted to after their programme changed", async () => {
    const ctx = await setup();
    await submit(ctx, "essay.pdf", pdf());
    const otherProgramme = await createProgramme();
    await db.student.update({
      where: { id: ctx.student.id },
      data: { programmeId: otherProgramme.id },
    });
    const item = (await myList(ctx.cookie)).body.items[0]!;
    expect(item.id).toBe(ctx.assessment.id);
    expect(item.canUpload).toMatchObject({ allowed: false, reason: "MODULE_NOT_IN_PROGRAMME" });
    expect(item.submission).not.toBeNull();
  });

  it("never shows another student's submissions", async () => {
    const ctx = await setup();
    const other = await createStudent({ programmeId: ctx.programme.id });
    const submission = await createSubmission({
      assessmentId: ctx.assessment.id,
      studentId: other.id,
      submittedAt: new Date(),
    });
    await createSubmissionFile({ submissionId: submission.id, uploadedAt: new Date() });
    const item = (await myList(ctx.cookie)).body.items[0]!;
    expect(item.submission).toBeNull();
    expect(item.status).toBe("NOT_SUBMITTED");
    expect(JSON.stringify(item)).not.toContain(other.id);
  });

  it("is empty for a student whose programme has no assessments", async () => {
    const student = await createStudent();
    expect((await myList(asStudent(student.id))).body).toMatchObject({ items: [] });
  });

  it("answers 401 without a session and 403 to staff", async () => {
    const ctx = await setup();
    expect((await myList(undefined)).status).toBe(401);
    const staff = await myList(asStaff(ctx.staff.id));
    expect(staff.status).toBe(403);
    expect(staff.body.error.code).toBe("FORBIDDEN");
  });
});

describe("GET /api/me/assessments/{id}/submission", () => {
  it("answers the assessment with the student's own submission, versions and receipts", async () => {
    const ctx = await setup();
    const bytes = pdf();
    const { result } = await submit(ctx, "essay.pdf", bytes);
    const detail = await myDetail(ctx.assessment.id, ctx.cookie);
    expect(detail.status).toBe(200);
    expect(Math.abs(new Date(detail.body.now).getTime() - Date.now())).toBeLessThan(10_000);
    const { assessment } = detail.body;
    expect(assessment.id).toBe(ctx.assessment.id);
    expect(assessment.submission?.versions).toEqual([
      expect.objectContaining({
        version: 1,
        fileName: "essay.pdf",
        mimeType: "application/pdf",
        sizeBytes: bytes.length,
        sha256: sha(bytes),
        uploadedAt: result.body.uploadedAt,
        late: false,
        lateBy: null,
      }),
    ]);
  });

  it("answers an assessment without a submission yet", async () => {
    const ctx = await setup();
    const detail = await myDetail(ctx.assessment.id, ctx.cookie);
    expect(detail.status).toBe(200);
    expect(detail.body.assessment.submission).toBeNull();
    expect(detail.body.assessment.canUpload.allowed).toBe(true);
  });

  it("answers 404 for an assessment that is not in the student's programme, unknown, or malformed", async () => {
    const ctx = await setup({ inProgramme: false });
    const foreign = await myDetail(ctx.assessment.id, ctx.cookie);
    const unknown = await myDetail(UNKNOWN_ID, ctx.cookie);
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(unknown.body);
    expect((await myDetail("not-a-uuid", ctx.cookie)).status).toBe(404);
  });

  it("never shows another student's submission of the same assessment", async () => {
    const ctx = await setup();
    const other = await createStudent({ programmeId: ctx.programme.id });
    await submit({ ...ctx, student: other, cookie: asStudent(other.id) }, "theirs.pdf", pdf());
    const detail = await myDetail(ctx.assessment.id, ctx.cookie);
    expect(detail.status).toBe(200);
    expect(detail.body.assessment.submission).toBeNull();
  });

  it("answers 401 without a session and 403 to staff", async () => {
    const ctx = await setup();
    expect((await myDetail(ctx.assessment.id, undefined)).status).toBe(401);
    const staff = await myDetail(ctx.assessment.id, asStaff(ctx.staff.id));
    expect(staff.status).toBe(403);
    expect(staff.body.error.code).toBe("FORBIDDEN");
  });
});
