import { db } from "@/lib/db";
import { BusinessRuleError, NotFoundError, ValidationError } from "@/lib/api/errors";
import { env } from "@/lib/env";
import type { Prisma } from "@/lib/generated/prisma/client";
import { logError } from "@/lib/logger";
import { systemClock } from "@/lib/services/clock";
import type { Clock } from "@/lib/services/clock";
import { inspectUpload } from "@/lib/services/file-inspection";
import { assertKnownId } from "@/lib/services/ids";
import type { ModuleRef } from "@/lib/services/programmes";
import { assessmentState, effectiveDeadline, isLate, lateBy } from "@/lib/services/rules/deadlines";
import type { AssessmentState } from "@/lib/services/rules/deadlines";
import { canUpload, uploadBlockMessage } from "@/lib/services/rules/submission-rules";
import type { UploadBlockReason } from "@/lib/services/rules/submission-rules";
import {
  buildSubmissionKey,
  deleteObject,
  headObject,
  presignPut,
  readRange,
  sha256,
} from "@/lib/storage";
import { UPLOAD_MIME_TYPES, formatLimit, uploadExtensionOf } from "@/lib/validation/submissions";
import type { UploadExtension, UploadUrlInput } from "@/lib/validation/submissions";

// The student side of submissions (api.md "Submissions and files", "Student self-service"; D-013, D-023, DB-017).
//
//   1. `issueUploadUrl`  checks the rules, records a PENDING_UPLOAD (15 minutes) and signs a PUT for a key the server
//      chose. The signature covers the declared type and size, so storage itself refuses anything else.
//   2. The browser PUTs the file straight to the bucket (it never passes through this server).
//   3. `confirmUpload`   reads the stored object, checks it, re-runs the rules with the moment the file ARRIVED as "now"
//      (D-023: submission time is when the upload finishes, not when it started), and records the version.
//
// Confirm is idempotent (a second call returns the same receipt) and safe against two confirms at once: everything that
// writes runs inside one transaction that first takes a per-student, per-assessment lock, so one version is created.
// Invalid files are deleted from storage and their pending row dropped.

/** How long an upload URL, and the pending upload behind it, stay valid (DB-017). */
export const UPLOAD_URL_SECONDS = 15 * 60;

// --- Shapes ---------------------------------------------------------------------------------------------------------

/** What the student keeps as proof of what they handed in and when (edge-cases.md, the "S" receipt). */
export interface Receipt {
  submissionId: string;
  fileName: string;
  sizeBytes: number;
  /** Lower-case hex SHA-256 of the file. */
  sha256: string;
  /** When the file arrived in storage (ISO); this is the submission time. */
  uploadedAt: string;
  late: boolean;
  /** How late ("2 days", "5 hours"), or `null` when on time. */
  lateBy: string | null;
}

export interface UploadUrlResult {
  pendingUploadId: string;
  /** Presigned PUT URL. */
  uploadUrl: string;
  /** Headers the PUT must send exactly as given (the URL signs them). */
  headers: Record<string, string>;
  /** When the URL (and the pending upload) stop working (ISO). */
  expiresAt: string;
  /** The file will arrive after the deadline and be marked late if uploaded now. */
  late: boolean;
}

/** One stored version of the student's own submission, with its receipt facts. */
export interface MyFileVersion {
  id: string;
  /** 1 for the first file, counting up. */
  version: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  uploadedAt: string;
  /** This file arrived after the student's deadline (derived against the current deadline). */
  late: boolean;
  lateBy: string | null;
}

export interface MySubmission {
  id: string;
  firstSubmittedAt: string;
  lastSubmittedAt: string;
  /** Whether the latest file is on time or late. */
  status: "ON_TIME" | "LATE";
  lateBy: string | null;
  currentFile: MyFileVersion;
  /** Every version, newest first. */
  versions: MyFileVersion[];
}

export interface MyCanUpload {
  allowed: boolean;
  reason: UploadBlockReason | null;
  /** Plain-words explanation when blocked. */
  message: string | null;
  /** An upload made now would be accepted but marked late. */
  late: boolean;
}

export type MySubmissionStatus = "ON_TIME" | "LATE" | "NOT_SUBMITTED" | "CLOSED";

export interface MyAssessment {
  id: string;
  title: string;
  module: ModuleRef;
  /** This student's deadline (ISO): their extension if they have one, else the assessment's. */
  deadline: string;
  /** The student has an extension, so `deadline` differs from the assessment's. */
  extended: boolean;
  closedAt: string | null;
  state: AssessmentState;
  /** `CLOSED` only when nothing was submitted and uploads are closed. */
  status: MySubmissionStatus;
  lateBy: string | null;
  canUpload: MyCanUpload;
  submission: MySubmission | null;
}

export interface MyAssessmentList {
  /** The server's "now" (ISO), for countdowns that do not trust the visitor's clock. */
  now: string;
  items: MyAssessment[];
}

export interface MyAssessmentDetail {
  now: string;
  assessment: MyAssessment;
}

// --- Limits ---------------------------------------------------------------------------------------------------------

/** The upload size limit in bytes (`MAX_UPLOAD_MB`). */
export function maxUploadBytes(): number {
  return env.MAX_UPLOAD_MB * 1024 * 1024;
}

// --- Context --------------------------------------------------------------------------------------------------------

type Client = Pick<
  Prisma.TransactionClient,
  "assessment" | "student" | "extension" | "submission" | "submissionFile"
>;

interface UploadContext {
  student: { status: "ENROLLED" | "DEFERRED" | "WITHDRAWN" | "COMPLETED"; moduleIds: string[] };
  assessment: { moduleId: string; deadline: Date; closedAt: Date | null };
  extensionDeadline: Date | null;
  existing: { id: string; lastSubmittedAt: Date } | null;
}

/** Everything `canUpload` needs for one student and assessment. An unknown assessment is a 404. */
async function loadUploadContext(
  client: Client,
  studentId: string,
  assessmentId: string,
): Promise<UploadContext> {
  const [assessment, student, extension, existing] = await Promise.all([
    client.assessment.findUnique({
      where: { id: assessmentId },
      select: { moduleId: true, deadline: true, closedAt: true },
    }),
    client.student.findUnique({
      where: { id: studentId },
      select: {
        status: true,
        programme: { select: { modules: { select: { moduleId: true } } } },
      },
    }),
    client.extension.findUnique({
      where: { assessmentId_studentId: { assessmentId, studentId } },
      select: { newDeadline: true },
    }),
    client.submission.findUnique({
      where: { assessmentId_studentId: { assessmentId, studentId } },
      select: { id: true, lastSubmittedAt: true },
    }),
  ]);
  if (!assessment) throw new NotFoundError("Assessment not found.");
  if (!student) throw new NotFoundError("Student not found.");
  return {
    student: {
      status: student.status,
      moduleIds: student.programme.modules.map((link) => link.moduleId),
    },
    assessment,
    extensionDeadline: extension?.newDeadline ?? null,
    existing,
  };
}

function decide(context: UploadContext, now: Date) {
  return canUpload(
    { status: context.student.status, programmeModuleIds: context.student.moduleIds },
    { ...context.assessment, extensionDeadline: context.extensionDeadline },
    context.existing,
    now,
  );
}

function blocked(reason: UploadBlockReason): BusinessRuleError {
  return new BusinessRuleError(reason, uploadBlockMessage(reason));
}

// --- Step 1: the upload URL -----------------------------------------------------------------------------------------

/**
 * Checks the size limit and the upload rules, records a pending upload and signs a PUT for it. The body's shape
 * (name, extension, type matching the extension, size above zero) was already validated by the handler's schema.
 * Errors: 400 for a size over `MAX_UPLOAD_MB`; 404 for an unknown assessment; 422 `BUSINESS_RULE` with
 * `details.rule` = `NOT_ENROLLED`, `MODULE_NOT_IN_PROGRAMME`, `CLOSED` or `ON_TIME_LOCKED`.
 */
export async function issueUploadUrl(
  studentId: string,
  assessmentId: string,
  input: UploadUrlInput,
  clock: Clock = systemClock,
): Promise<UploadUrlResult> {
  assertKnownId(assessmentId, "Assessment");
  const limit = maxUploadBytes();
  if (input.sizeBytes > limit) {
    throw ValidationError.field(
      "sizeBytes",
      `This file is too large. The limit is ${formatLimit(limit)}.`,
    );
  }

  const now = clock();
  const decision = decide(await loadUploadContext(db, studentId, assessmentId), now);
  if (!decision.allowed) throw blocked(decision.reason);

  const extension = uploadExtensionOf(input.fileName)!; // the schema only lets .pdf and .docx through
  const mimeType = UPLOAD_MIME_TYPES[extension];
  const objectKey = buildSubmissionKey(assessmentId, studentId, extension);
  const expiresAt = new Date(now.getTime() + UPLOAD_URL_SECONDS * 1000);

  const presigned = await presignPut(objectKey, mimeType, input.sizeBytes, UPLOAD_URL_SECONDS);
  const pending = await db.pendingUpload.create({
    data: {
      assessmentId,
      studentId,
      objectKey,
      originalName: input.fileName,
      mimeType,
      sizeBytes: input.sizeBytes,
      expiresAt,
    },
    select: { id: true },
  });

  return {
    pendingUploadId: pending.id,
    uploadUrl: presigned.url,
    headers: presigned.headers,
    expiresAt: expiresAt.toISOString(),
    late: decision.late,
  };
}

// --- Step 3: confirm ------------------------------------------------------------------------------------------------

interface PendingRow {
  id: string;
  assessmentId: string;
  studentId: string;
  objectKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  expiresAt: Date;
  confirmedAt: Date | null;
}

/**
 * Removes a pending upload that will never be confirmed: the object first, then the row. If storage cannot be reached
 * the row stays, so `npm run uploads:cleanup` finds it later; the caller's error is not replaced by this one.
 */
async function discardPending(pending: Pick<PendingRow, "id" | "objectKey">): Promise<void> {
  try {
    await deleteObject(pending.objectKey);
  } catch (error) {
    logError("Could not delete a rejected upload from storage", error, {
      pendingUploadId: pending.id,
      objectKey: pending.objectKey,
    });
    return;
  }
  await db.pendingUpload.deleteMany({ where: { id: pending.id, confirmedAt: null } });
}

/** Deletes the pending upload and answers 400: the stored file is not an acceptable submission. */
async function rejectFile(pending: PendingRow, message: string): Promise<never> {
  await discardPending(pending);
  throw new ValidationError({ fieldErrors: { file: [message] } }, message);
}

function receiptFrom(
  file: { originalName: string; sizeBytes: number; sha256: string; uploadedAt: Date },
  submissionId: string,
  deadline: Date,
): Receipt {
  return {
    submissionId,
    fileName: file.originalName,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    uploadedAt: file.uploadedAt.toISOString(),
    late: isLate(file.uploadedAt, deadline),
    lateBy: lateBy(file.uploadedAt, deadline),
  };
}

/** The receipt of a file that was already recorded for this pending upload (a repeated confirm). */
async function existingReceipt(
  client: Client,
  pending: Pick<PendingRow, "objectKey" | "assessmentId" | "studentId">,
): Promise<Receipt> {
  const file = await client.submissionFile.findUnique({
    where: { objectKey: pending.objectKey },
    select: {
      originalName: true,
      sizeBytes: true,
      sha256: true,
      uploadedAt: true,
      submissionId: true,
    },
  });
  if (!file) throw new NotFoundError("Upload not found.");
  const [assessment, extension] = await Promise.all([
    client.assessment.findUniqueOrThrow({
      where: { id: pending.assessmentId },
      select: { deadline: true },
    }),
    client.extension.findUnique({
      where: {
        assessmentId_studentId: {
          assessmentId: pending.assessmentId,
          studentId: pending.studentId,
        },
      },
      select: { newDeadline: true },
    }),
  ]);
  return receiptFrom(file, file.submissionId, effectiveDeadline(assessment.deadline, extension));
}

function kindOf(mimeType: string): UploadExtension {
  return mimeType === UPLOAD_MIME_TYPES.pdf ? "pdf" : "docx";
}

type Outcome =
  | { kind: "created"; receipt: Receipt }
  | { kind: "already" }
  | { kind: "gone" }
  | { kind: "blocked"; reason: UploadBlockReason };

/**
 * Turns an uploaded object into a recorded submission version and returns the receipt.
 *
 * Checks, in order: the pending upload is this student's for this assessment (404 otherwise) -> already confirmed
 * (the same receipt again) -> not expired (422 `UPLOAD_EXPIRED`, the object and row are removed) -> the object exists
 * (422 `UPLOAD_NOT_FOUND`) -> not empty, within `MAX_UPLOAD_MB`, exactly the declared size, and a real PDF / macro-free
 * DOCX by content (otherwise the object and row are removed and the answer is 400) -> the upload rules again, with the
 * moment the file arrived as "now" (422 with the rule, object removed). Then one transaction records the version.
 */
export async function confirmUpload(
  studentId: string,
  assessmentId: string,
  pendingUploadId: string,
  clock: Clock = systemClock,
): Promise<Receipt> {
  assertKnownId(assessmentId, "Assessment");
  const pending: PendingRow | null = await db.pendingUpload.findFirst({
    where: { id: pendingUploadId, assessmentId, studentId },
  });
  if (!pending) throw new NotFoundError("Upload not found.");
  if (pending.confirmedAt) return existingReceipt(db, pending);

  const now = clock();
  if (pending.expiresAt.getTime() <= now.getTime()) {
    await discardPending(pending);
    throw new BusinessRuleError(
      "UPLOAD_EXPIRED",
      "This upload took too long and has expired. Choose the file and upload it again.",
    );
  }

  const head = await headObject(pending.objectKey);
  if (!head) {
    throw new BusinessRuleError(
      "UPLOAD_NOT_FOUND",
      "We could not find your uploaded file. Upload it again.",
    );
  }

  const limit = maxUploadBytes();
  if (head.sizeBytes === 0) {
    return rejectFile(pending, "The uploaded file is empty. Choose a file that has content.");
  }
  if (head.sizeBytes > limit) {
    return rejectFile(
      pending,
      `The uploaded file is too large. The limit is ${formatLimit(limit)}.`,
    );
  }
  if (head.sizeBytes !== pending.sizeBytes) {
    return rejectFile(
      pending,
      "The uploaded file is not the size that was announced. Upload it again.",
    );
  }

  const inspection = await inspectUpload(
    kindOf(pending.mimeType),
    head.sizeBytes,
    (offset, length) => readRange(pending.objectKey, offset, length),
  );
  if (!inspection.ok) return rejectFile(pending, inspection.message);

  const digest = await sha256(pending.objectKey);
  // The signed URL stays valid for 15 minutes, so the object could have been replaced while it was being read. If it
  // changed, the fingerprint no longer describes the stored file: refuse rather than record a wrong receipt.
  const after = await headObject(pending.objectKey);
  if (
    !after ||
    after.etag !== head.etag ||
    after.lastModified.getTime() !== head.lastModified.getTime()
  ) {
    return rejectFile(pending, "The file changed while it was being checked. Upload it again.");
  }

  const outcome: Outcome = await db.$transaction(async (tx) => {
    // One confirm at a time per student and assessment: a second one waits here, then finds the first one's work.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`submission:${assessmentId}:${studentId}`}, 0))`;

    const fresh = await tx.pendingUpload.findUnique({
      where: { id: pending.id },
      select: { confirmedAt: true },
    });
    if (!fresh) return { kind: "gone" };
    if (fresh.confirmedAt) return { kind: "already" };

    // The rules again, now with the arrival time as "now" (D-023, D-030): the assessment may have been closed, or the
    // student's status changed, since the URL was issued; a file that arrived after the deadline cannot replace an
    // on-time one.
    const context = await loadUploadContext(tx, studentId, assessmentId);
    const decision = decide(context, head.lastModified);
    if (!decision.allowed) return { kind: "blocked", reason: decision.reason };

    // Versions are ordered by arrival time, which has a one-second resolution in storage. A newer file must sort after
    // the one it replaces even when both arrived in the same second, so it is nudged by a millisecond if needed.
    const latest = context.existing
      ? await tx.submissionFile.findFirst({
          where: { submissionId: context.existing.id },
          orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
          select: { uploadedAt: true },
        })
      : null;
    const uploadedAt =
      latest && head.lastModified.getTime() <= latest.uploadedAt.getTime()
        ? new Date(latest.uploadedAt.getTime() + 1)
        : head.lastModified;

    const submission = context.existing
      ? await tx.submission.update({
          where: { id: context.existing.id },
          data: { lastSubmittedAt: uploadedAt },
          select: { id: true },
        })
      : await tx.submission.create({
          data: {
            assessmentId,
            studentId,
            firstSubmittedAt: uploadedAt,
            lastSubmittedAt: uploadedAt,
          },
          select: { id: true },
        });
    const file = await tx.submissionFile.create({
      data: {
        submissionId: submission.id,
        objectKey: pending.objectKey,
        originalName: pending.originalName,
        mimeType: pending.mimeType,
        sizeBytes: head.sizeBytes,
        sha256: digest,
        uploadedAt,
      },
      select: { originalName: true, sizeBytes: true, sha256: true, uploadedAt: true },
    });
    await tx.pendingUpload.update({ where: { id: pending.id }, data: { confirmedAt: now } });

    const deadline = effectiveDeadline(
      context.assessment.deadline,
      context.extensionDeadline ? { newDeadline: context.extensionDeadline } : null,
    );
    return { kind: "created", receipt: receiptFrom(file, submission.id, deadline) };
  });

  switch (outcome.kind) {
    case "created":
      return outcome.receipt;
    case "already":
      return existingReceipt(db, pending);
    case "gone":
      throw new NotFoundError("Upload not found.");
    case "blocked":
      await discardPending(pending);
      throw blocked(outcome.reason);
  }
}

// --- The student's own view -----------------------------------------------------------------------------------------

const MY_ASSESSMENT_SELECT = (studentId: string) =>
  ({
    id: true,
    title: true,
    moduleId: true,
    deadline: true,
    closedAt: true,
    module: { select: { id: true, code: true, title: true } },
    extensions: { where: { studentId }, select: { newDeadline: true } },
    submissions: {
      where: { studentId },
      select: {
        id: true,
        firstSubmittedAt: true,
        lastSubmittedAt: true,
        files: {
          orderBy: [{ uploadedAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            originalName: true,
            mimeType: true,
            sizeBytes: true,
            sha256: true,
            uploadedAt: true,
          },
        },
      },
    },
  }) satisfies Prisma.AssessmentSelect;

type MyAssessmentRow = Prisma.AssessmentGetPayload<{
  select: ReturnType<typeof MY_ASSESSMENT_SELECT>;
}>;

interface Me {
  status: UploadContext["student"]["status"];
  moduleIds: string[];
}

async function loadMe(studentId: string): Promise<Me> {
  const student = await db.student.findUnique({
    where: { id: studentId },
    select: { status: true, programme: { select: { modules: { select: { moduleId: true } } } } },
  });
  if (!student) throw new NotFoundError("Student not found.");
  return { status: student.status, moduleIds: student.programme.modules.map((l) => l.moduleId) };
}

function toMyAssessment(row: MyAssessmentRow, me: Me, now: Date): MyAssessment {
  const extension = row.extensions[0] ?? null;
  const submission = row.submissions[0] ?? null;
  const deadline = effectiveDeadline(row.deadline, extension);

  const versions: MyFileVersion[] = (submission?.files ?? [])
    .map((file, index) => ({
      id: file.id,
      version: index + 1,
      fileName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
      uploadedAt: file.uploadedAt.toISOString(),
      late: isLate(file.uploadedAt, deadline),
      lateBy: lateBy(file.uploadedAt, deadline),
    }))
    .reverse();
  const current = versions[0] ?? null;

  const state = assessmentState({ deadline, closedAt: row.closedAt }, now);
  const decision = canUpload(
    { status: me.status, programmeModuleIds: me.moduleIds },
    {
      moduleId: row.moduleId,
      deadline: row.deadline,
      closedAt: row.closedAt,
      extensionDeadline: extension?.newDeadline,
    },
    submission ? { lastSubmittedAt: submission.lastSubmittedAt } : null,
    now,
  );

  let status: MySubmissionStatus = state === "closed" ? "CLOSED" : "NOT_SUBMITTED";
  if (submission && current) status = current.late ? "LATE" : "ON_TIME";

  return {
    id: row.id,
    title: row.title,
    module: row.module,
    deadline: deadline.toISOString(),
    extended: extension !== null,
    closedAt: row.closedAt?.toISOString() ?? null,
    state,
    status,
    lateBy: current?.lateBy ?? null,
    canUpload: decision.allowed
      ? { allowed: true, reason: null, message: null, late: decision.late }
      : {
          allowed: false,
          reason: decision.reason,
          message: uploadBlockMessage(decision.reason),
          late: false,
        },
    submission:
      submission && current
        ? {
            id: submission.id,
            firstSubmittedAt: submission.firstSubmittedAt.toISOString(),
            lastSubmittedAt: submission.lastSubmittedAt.toISOString(),
            status: current.late ? "LATE" : "ON_TIME",
            lateBy: current.lateBy,
            currentFile: current,
            versions,
          }
        : null,
  };
}

/** Assessments the student can see: those of their programme's modules, plus any they have already submitted to. */
function visibleTo(studentId: string, me: Me): Prisma.AssessmentWhereInput {
  return {
    OR: [{ moduleId: { in: me.moduleIds } }, { submissions: { some: { studentId } } }],
  };
}

/**
 * The signed-in student's assessments, ordered for use: those still accepting uploads with the nearest deadline first,
 * then the rest with the latest deadline first. Each carries the student's own deadline (their extension if any),
 * whether they may upload now (with the reason in plain words if not), and their submission with every version.
 */
export async function listMyAssessments(
  studentId: string,
  clock: Clock = systemClock,
): Promise<MyAssessmentList> {
  const now = clock();
  const me = await loadMe(studentId);
  const rows = await db.assessment.findMany({
    where: visibleTo(studentId, me),
    select: MY_ASSESSMENT_SELECT(studentId),
  });

  const items = rows.map((row) => toMyAssessment(row, me, now));
  const active = (item: MyAssessment) => item.state !== "closed" && new Date(item.deadline) >= now;
  items.sort((a, b) => {
    const aActive = active(a);
    const bActive = active(b);
    if (aActive !== bActive) return aActive ? -1 : 1;
    const byDeadline = new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
    return (aActive ? byDeadline : -byDeadline) || a.id.localeCompare(b.id);
  });
  return { now: now.toISOString(), items };
}

/**
 * One assessment as the signed-in student sees it, with their submission, every version and its receipt. An unknown
 * assessment, or one that is neither in their programme nor already submitted to, is a 404.
 */
export async function getMyAssessment(
  studentId: string,
  assessmentId: string,
  clock: Clock = systemClock,
): Promise<MyAssessmentDetail> {
  assertKnownId(assessmentId, "Assessment");
  const now = clock();
  const me = await loadMe(studentId);
  const row = await db.assessment.findFirst({
    where: { id: assessmentId, ...visibleTo(studentId, me) },
    select: MY_ASSESSMENT_SELECT(studentId),
  });
  if (!row) throw new NotFoundError("Assessment not found.");
  return { now: now.toISOString(), assessment: toMyAssessment(row, me, now) };
}
