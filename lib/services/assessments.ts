import { db } from "@/lib/db";
import {
  BusinessRuleError,
  NotFoundError,
  ValidationError,
  VersionConflictError,
} from "@/lib/api/errors";
import type { Prisma, PrismaClient } from "@/lib/generated/prisma/client";
import { systemClock } from "@/lib/services/clock";
import type { Clock } from "@/lib/services/clock";
import { assertKnownId } from "@/lib/services/ids";
import type { ModuleRef } from "@/lib/services/programmes";
import {
  assessmentState,
  countLateFlagChanges,
  effectiveDeadline,
  isLate,
  isPastDeadline,
  lateBy,
} from "@/lib/services/rules/deadlines";
import type { AssessmentState } from "@/lib/services/rules/deadlines";
import { normaliseName } from "@/lib/services/rules/duplicates";
import type { EnrolmentStatus } from "@/lib/services/rules/types";
import type {
  AssessmentListQuery,
  CreateAssessmentInput,
  UpdateAssessmentInput,
} from "@/lib/validation/assessments";

// Assessments for staff (api.md "Assessments", pages.md `/staff/assessments*`): list with counts, create, read,
// edit, close and reopen, and the submissions of every eligible student. Business rules live here; the Route Handlers
// only validate and call these functions (tech-stack.md "Application layering").
//
//   - Late is derived, never stored (D-023, DB-003): a submission is late when its latest file arrived after the
//     student's effective deadline (their extension if they have one, else the assessment's). Changing the deadline
//     therefore changes the flags at once; `updateAssessment` reports how many flipped.
//   - Who is eligible: students who are Enrolled in a programme that includes the module, plus anyone who already
//     submitted whatever their status now, so a work already handed in never disappears from the list.
//   - Edits are optimistic (`version`, DB-016). Closing and reopening also move the version, so an edit form opened
//     before someone closed the assessment is told the record changed.
//   - The list is a fixed number of queries however many assessments or students there are: the counts come from
//     batch queries over the page's assessments and an in-memory pass (tests/integration/api/assessments.test.ts).

// --- Shapes ---------------------------------------------------------------------------------------------------------

export type { AssessmentState };

/** Counts shown beside an assessment. `eligible` is the number of rows its submissions list has. */
export interface AssessmentCounts {
  /** Enrolled students whose programme includes the module, plus non-eligible students who submitted anyway. */
  eligible: number;
  /** Students who have submitted (one per student, whatever the number of file versions). */
  submitted: number;
  /** Submissions whose latest file arrived after the student's effective deadline. */
  late: number;
  /** Marks entered (a non-submission counts); draft, published and withheld alike. */
  marked: number;
  /** Marks published to students. */
  published: number;
}

export interface AssessmentSummary {
  id: string;
  title: string;
  module: ModuleRef;
  /** The assessment's deadline (ISO, UTC); students with an extension have their own. */
  deadline: string;
  /** When staff closed it (ISO), or `null` while it accepts uploads. */
  closedAt: string | null;
  state: AssessmentState;
  version: number;
  counts: AssessmentCounts;
}

export interface AssessmentDetail extends AssessmentSummary {
  createdBy: { id: string; fullName: string };
}

export interface AssessmentList {
  items: AssessmentSummary[];
  page: number;
  pageSize: number;
  total: number;
}

/** A success that deserves attention (api.md "Warnings"); the handler attaches it to the response. */
export interface AssessmentWarning {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface AssessmentResult {
  assessment: AssessmentDetail;
  warnings: AssessmentWarning[];
}

/** One stored file version of a submission. */
export interface SubmissionFileDto {
  id: string;
  /** 1 for the first file the student uploaded, counting up. */
  version: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  /** When the file arrived in storage (ISO); this is the submission time (D-023). */
  uploadedAt: string;
}

export type SubmissionStatus = "ON_TIME" | "LATE" | "NOT_SUBMITTED";

export interface SubmissionRow {
  student: {
    id: string;
    studentNumber: string;
    fullName: string;
    status: EnrolmentStatus;
    programme: { id: string; code: string; name: string };
  };
  /** Enrolled in a programme that includes the module. `false` for a student who submitted but no longer is. */
  eligible: boolean;
  status: SubmissionStatus;
  /** How late the latest file is, in the largest whole unit ("5 hours", "2 days"); `null` unless late. */
  lateBy: string | null;
  /** This student's effective deadline (ISO): their extension if they have one, else the assessment's. */
  deadline: string;
  extension: { newDeadline: string; reason: string } | null;
  submission: { id: string; firstSubmittedAt: string; lastSubmittedAt: string } | null;
  /** The latest file, or `null` when nothing was submitted. */
  currentFile: SubmissionFileDto | null;
  /** Every version, newest first (the current file is the first). */
  versions: SubmissionFileDto[];
}

export interface AssessmentSubmissions {
  assessmentId: string;
  total: number;
  summary: { onTime: number; late: number; notSubmitted: number };
  items: SubmissionRow[];
}

// --- Helpers --------------------------------------------------------------------------------------------------------

type Client = Pick<
  PrismaClient,
  "assessment" | "submission" | "extension" | "programmeModule" | "student" | "mark"
>;

const MODULE_SELECT = { select: { id: true, code: true, title: true } } as const;
const CREATED_BY_SELECT = { select: { id: true, fullName: true } } as const;

type AssessmentRow = {
  id: string;
  title: string;
  moduleId: string;
  deadline: Date;
  closedAt: Date | null;
  version: number;
  module: ModuleRef;
};

const NO_COUNTS: AssessmentCounts = { eligible: 0, submitted: 0, late: 0, marked: 0, published: 0 };

function toSummary(row: AssessmentRow, counts: AssessmentCounts, now: Date): AssessmentSummary {
  return {
    id: row.id,
    title: row.title,
    module: row.module,
    deadline: row.deadline.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    state: assessmentState(row, now),
    version: row.version,
    counts,
  };
}

/** `${assessmentId}:${studentId}` - the key extensions are looked up by. */
const extensionKey = (assessmentId: string, studentId: string) => `${assessmentId}:${studentId}`;

/**
 * The counts for a set of assessments in five batch queries (submissions with their students, extensions, which
 * programmes include each module, enrolled students per programme, marks by release status), then one pass in memory.
 */
async function loadCounts(
  client: Client,
  rows: Pick<AssessmentRow, "id" | "moduleId" | "deadline">[],
): Promise<Map<string, AssessmentCounts>> {
  const result = new Map<string, AssessmentCounts>();
  if (rows.length === 0) return result;
  const ids = rows.map((row) => row.id);
  const moduleIds = [...new Set(rows.map((row) => row.moduleId))];

  const [submissions, extensions, links, enrolled, marks] = await Promise.all([
    client.submission.findMany({
      where: { assessmentId: { in: ids } },
      select: {
        assessmentId: true,
        studentId: true,
        lastSubmittedAt: true,
        student: { select: { status: true, programmeId: true } },
      },
    }),
    client.extension.findMany({
      where: { assessmentId: { in: ids } },
      select: { assessmentId: true, studentId: true, newDeadline: true },
    }),
    client.programmeModule.findMany({
      where: { moduleId: { in: moduleIds } },
      select: { moduleId: true, programmeId: true },
    }),
    client.student.groupBy({
      by: ["programmeId"],
      where: { status: "ENROLLED" },
      _count: { _all: true },
    }),
    client.mark.groupBy({
      by: ["assessmentId", "releaseStatus"],
      where: { assessmentId: { in: ids } },
      _count: { _all: true },
    }),
  ]);

  const programmesOf = new Map<string, Set<string>>();
  for (const link of links) {
    const set = programmesOf.get(link.moduleId) ?? new Set<string>();
    set.add(link.programmeId);
    programmesOf.set(link.moduleId, set);
  }
  const enrolledIn = new Map(enrolled.map((group) => [group.programmeId, group._count._all]));
  const extensionOf = new Map(
    extensions.map((e) => [extensionKey(e.assessmentId, e.studentId), e.newDeadline]),
  );

  for (const row of rows) {
    const programmes = programmesOf.get(row.moduleId) ?? new Set<string>();
    let eligible = 0;
    for (const programmeId of programmes) eligible += enrolledIn.get(programmeId) ?? 0;
    result.set(row.id, { ...NO_COUNTS, eligible });
  }

  const rowById = new Map(rows.map((row) => [row.id, row]));
  for (const submission of submissions) {
    const row = rowById.get(submission.assessmentId)!; // selected by these ids
    const counts = result.get(row.id)!;
    counts.submitted += 1;
    const programmes = programmesOf.get(row.moduleId);
    const eligible =
      submission.student.status === "ENROLLED" &&
      (programmes?.has(submission.student.programmeId) ?? false);
    // An eligible student is already in the enrolled count; anyone else who submitted is added on top.
    if (!eligible) counts.eligible += 1;
    const extension = extensionOf.get(extensionKey(row.id, submission.studentId));
    const deadline = effectiveDeadline(row.deadline, extension ? { newDeadline: extension } : null);
    if (isLate(submission.lastSubmittedAt, deadline)) counts.late += 1;
  }

  for (const group of marks) {
    const counts = result.get(group.assessmentId)!;
    counts.marked += group._count._all;
    if (group.releaseStatus === "PUBLISHED") counts.published += group._count._all;
  }
  return result;
}

async function loadDetail(client: Client, id: string, now: Date): Promise<AssessmentDetail> {
  assertKnownId(id, "Assessment");
  const row = await client.assessment.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      moduleId: true,
      deadline: true,
      closedAt: true,
      version: true,
      module: MODULE_SELECT,
      createdBy: CREATED_BY_SELECT,
    },
  });
  if (!row) throw new NotFoundError("Assessment not found.");
  const counts = (await loadCounts(client, [row])).get(row.id)!;
  return { ...toSummary(row, counts, now), createdBy: row.createdBy };
}

async function assertModuleExists(client: Pick<PrismaClient, "module">, moduleId: string) {
  const found = await client.module.findUnique({ where: { id: moduleId }, select: { id: true } });
  if (!found) throw ValidationError.field("moduleId", "Choose a module.");
}

// --- List -----------------------------------------------------------------------------------------------------------

function listWhere(query: AssessmentListQuery, now: Date): Prisma.AssessmentWhereInput {
  const where: Prisma.AssessmentWhereInput = {};
  if (query.moduleId) where.moduleId = query.moduleId;
  if (query.state === "closed") where.closedAt = { not: null };
  // Open means not closed and the deadline has not gone by (arriving exactly at it is still on time).
  if (query.state === "open") Object.assign(where, { closedAt: null, deadline: { gte: now } });
  if (query.state === "past-deadline") {
    Object.assign(where, { closedAt: null, deadline: { lt: now } });
  }
  return where;
}

function listOrder(sort: AssessmentListQuery["sort"]): Prisma.AssessmentOrderByWithRelationInput[] {
  const direction = sort?.direction ?? "desc";
  const tail: Prisma.AssessmentOrderByWithRelationInput[] = [{ id: "asc" }];
  switch (sort?.field ?? "deadline") {
    case "title":
      return [{ title: direction }, { deadline: "desc" }, ...tail];
    case "module":
      return [{ module: { code: direction } }, { deadline: "desc" }, ...tail];
    default:
      return [{ deadline: direction }, ...tail];
  }
}

/**
 * Assessments with their counts, newest deadline first by default. `moduleId` narrows to one module; `state` is
 * `open`, `past-deadline` (deadline gone by, not closed) or `closed`. A fixed number of queries.
 */
export async function listAssessments(
  query: AssessmentListQuery,
  clock: Clock = systemClock,
  client: Client = db,
): Promise<AssessmentList> {
  const now = clock();
  const where = listWhere(query, now);
  const [total, rows] = await Promise.all([
    client.assessment.count({ where }),
    client.assessment.findMany({
      where,
      orderBy: listOrder(query.sort),
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        title: true,
        moduleId: true,
        deadline: true,
        closedAt: true,
        version: true,
        module: MODULE_SELECT,
      },
    }),
  ]);
  const counts = await loadCounts(client, rows);
  return {
    items: rows.map((row) => toSummary(row, counts.get(row.id)!, now)),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

// --- Create, read, update -------------------------------------------------------------------------------------------

/**
 * Creates an assessment. The module must exist. A deadline that is already in the past is allowed (staff may enter an
 * older assessment) but answers with the warning `DEADLINE_IN_PAST`.
 */
export async function createAssessment(
  input: CreateAssessmentInput,
  actorId: string,
  clock: Clock = systemClock,
): Promise<AssessmentResult> {
  await assertModuleExists(db, input.moduleId);
  const created = await db.assessment.create({
    data: {
      moduleId: input.moduleId,
      title: input.title,
      deadline: input.deadline,
      createdById: actorId,
    },
    select: { id: true },
  });

  const warnings: AssessmentWarning[] = isPastDeadline(clock(), input.deadline)
    ? [
        {
          code: "DEADLINE_IN_PAST",
          message:
            "The deadline is already in the past, so every submission will be marked late until you change it.",
        },
      ]
    : [];
  return { assessment: await loadDetail(db, created.id, clock()), warnings };
}

export async function getAssessment(
  id: string,
  clock: Clock = systemClock,
): Promise<AssessmentDetail> {
  return loadDetail(db, id, clock());
}

/**
 * Edits the title, the deadline and (only while nobody has submitted and no mark exists) the module. The caller sends the `version` it
 * read (DB-016); a stale one throws `VersionConflictError`. Moving the deadline recalculates every late flag, because
 * they are derived: the result carries `LATE_FLAGS_RECALCULATED` with how many submissions changed between on time and
 * late (not added when the assessment has no submissions). Nothing is written, and the version does not move, when no
 * field actually changes.
 */
export async function updateAssessment(
  id: string,
  input: UpdateAssessmentInput,
  clock: Clock = systemClock,
): Promise<AssessmentResult> {
  assertKnownId(id, "Assessment");
  const warnings: AssessmentWarning[] = [];

  await db.$transaction(async (tx) => {
    const current = await tx.assessment.findUnique({
      where: { id },
      select: { title: true, moduleId: true, deadline: true, version: true },
    });
    if (!current) throw new NotFoundError("Assessment not found.");
    if (current.version !== input.version) throw new VersionConflictError(current.version);

    const data: Prisma.AssessmentUncheckedUpdateManyInput = {};
    if (input.title !== undefined && input.title !== current.title) data.title = input.title;

    if (input.moduleId !== undefined && input.moduleId !== current.moduleId) {
      await assertModuleExists(tx, input.moduleId);
      const [submissions, marks] = await Promise.all([
        tx.submission.count({ where: { assessmentId: id } }),
        tx.mark.count({ where: { assessmentId: id } }),
      ]);
      if (submissions > 0 || marks > 0) {
        throw new BusinessRuleError(
          "ASSESSMENT_HAS_ACTIVITY",
          "The module cannot be changed because students have already submitted work or marks have been entered for this assessment.",
          { submissions, marks },
        );
      }
      data.moduleId = input.moduleId;
    }

    const deadlineChanged =
      input.deadline !== undefined && input.deadline.getTime() !== current.deadline.getTime();
    if (deadlineChanged) data.deadline = input.deadline;

    if (Object.keys(data).length === 0) return;

    let flagWarning: AssessmentWarning | null = null;
    if (deadlineChanged) {
      const [submissions, extensions] = await Promise.all([
        tx.submission.findMany({
          where: { assessmentId: id },
          select: { studentId: true, lastSubmittedAt: true },
        }),
        tx.extension.findMany({
          where: { assessmentId: id },
          select: { studentId: true, newDeadline: true },
        }),
      ]);
      if (submissions.length > 0) {
        const changed = countLateFlagChanges(
          submissions,
          new Map(extensions.map((e) => [e.studentId, e.newDeadline])),
          current.deadline,
          input.deadline!,
        );
        flagWarning = {
          code: "LATE_FLAGS_RECALCULATED",
          message:
            changed === 0
              ? "The deadline moved. No submission changed between on time and late."
              : `The deadline moved. ${changed} ${changed === 1 ? "submission" : "submissions"} changed between on time and late.`,
          details: { changed, submissions: submissions.length },
        };
      }
    }

    const updated = await tx.assessment.updateMany({
      where: { id, version: input.version },
      data: { ...data, version: { increment: 1 } },
    });
    if (updated.count === 0) {
      const now = await tx.assessment.findUnique({ where: { id }, select: { version: true } });
      throw new VersionConflictError(now?.version ?? input.version + 1);
    }
    if (flagWarning) warnings.push(flagWarning);
  });

  return { assessment: await loadDetail(db, id, clock()), warnings };
}

// --- Close and reopen -----------------------------------------------------------------------------------------------

/**
 * Stops all uploads, including late ones (`closedAt = now`). Closing an assessment that is already closed is a 422
 * `ALREADY_CLOSED` and changes nothing; of two simultaneous closes exactly one succeeds.
 */
export async function closeAssessment(
  id: string,
  clock: Clock = systemClock,
): Promise<AssessmentDetail> {
  assertKnownId(id, "Assessment");
  const now = clock();
  const updated = await db.assessment.updateMany({
    where: { id, closedAt: null },
    data: { closedAt: now, version: { increment: 1 } },
  });
  if (updated.count === 0) {
    const exists = await db.assessment.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundError("Assessment not found.");
    throw new BusinessRuleError("ALREADY_CLOSED", "This assessment is already closed.");
  }
  return loadDetail(db, id, now);
}

/** Clears `closedAt` so uploads are accepted again. Reopening one that is not closed is a 422 `NOT_CLOSED`. */
export async function reopenAssessment(
  id: string,
  clock: Clock = systemClock,
): Promise<AssessmentDetail> {
  assertKnownId(id, "Assessment");
  const updated = await db.assessment.updateMany({
    where: { id, closedAt: { not: null } },
    data: { closedAt: null, version: { increment: 1 } },
  });
  if (updated.count === 0) {
    const exists = await db.assessment.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundError("Assessment not found.");
    throw new BusinessRuleError("NOT_CLOSED", "This assessment is not closed.");
  }
  return loadDetail(db, id, clock());
}

// --- Submissions ----------------------------------------------------------------------------------------------------

function toFileDto(file: {
  id: string;
  version: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  uploadedAt: Date;
}): SubmissionFileDto {
  return {
    id: file.id,
    version: file.version,
    fileName: file.originalName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    uploadedAt: file.uploadedAt.toISOString(),
  };
}

/** The student fields every marksheet and submissions row shows. */
export const STUDENT_SELECT = {
  id: true,
  studentNumber: true,
  fullName: true,
  status: true,
  programme: { select: { id: true, code: true, name: true } },
} as const;

/** Enrolled students whose programme includes the module: the base of "eligible" (D-035). */
export function eligibleStudentWhere(moduleId: string): Prisma.StudentWhereInput {
  return { status: "ENROLLED", programme: { modules: { some: { moduleId } } } };
}

/**
 * Every eligible student with their submission status, lateness and file versions: Enrolled students whose programme
 * includes the module, plus anyone who already submitted whatever their status (shown with their current status, and
 * `eligible: false`). Ordered by name, ignoring case and accents. Three queries (students, submissions with files,
 * extensions) after the assessment itself.
 */
export async function listSubmissions(id: string): Promise<AssessmentSubmissions> {
  assertKnownId(id, "Assessment");
  const assessment = await db.assessment.findUnique({
    where: { id },
    select: { id: true, moduleId: true, deadline: true },
  });
  if (!assessment) throw new NotFoundError("Assessment not found.");

  const [eligibleStudents, submissions, extensions] = await Promise.all([
    db.student.findMany({
      where: eligibleStudentWhere(assessment.moduleId),
      select: STUDENT_SELECT,
    }),
    db.submission.findMany({
      where: { assessmentId: id },
      select: {
        id: true,
        studentId: true,
        firstSubmittedAt: true,
        lastSubmittedAt: true,
        student: { select: STUDENT_SELECT },
        files: {
          orderBy: { version: "asc" },
          select: {
            id: true,
            version: true,
            originalName: true,
            mimeType: true,
            sizeBytes: true,
            sha256: true,
            uploadedAt: true,
          },
        },
      },
    }),
    db.extension.findMany({
      where: { assessmentId: id },
      select: { studentId: true, newDeadline: true, reason: true },
    }),
  ]);

  const eligibleIds = new Set(eligibleStudents.map((student) => student.id));
  const submissionOf = new Map(submissions.map((s) => [s.studentId, s]));
  const extensionOf = new Map(extensions.map((e) => [e.studentId, e]));

  const students = [...eligibleStudents];
  for (const submission of submissions) {
    if (!eligibleIds.has(submission.studentId)) students.push(submission.student);
  }
  students.sort(
    (a, b) =>
      normaliseName(a.fullName).localeCompare(normaliseName(b.fullName)) ||
      a.studentNumber.localeCompare(b.studentNumber),
  );

  const summary = { onTime: 0, late: 0, notSubmitted: 0 };
  const items = students.map((student): SubmissionRow => {
    const submission = submissionOf.get(student.id) ?? null;
    const extension = extensionOf.get(student.id) ?? null;
    const deadline = effectiveDeadline(assessment.deadline, extension);

    const files = (submission?.files ?? []).map(toFileDto);
    const versions = [...files].reverse();

    let status: SubmissionStatus = "NOT_SUBMITTED";
    let late: string | null = null;
    if (submission) {
      status = isLate(submission.lastSubmittedAt, deadline) ? "LATE" : "ON_TIME";
      late = lateBy(submission.lastSubmittedAt, deadline);
    }
    if (status === "ON_TIME") summary.onTime += 1;
    else if (status === "LATE") summary.late += 1;
    else summary.notSubmitted += 1;

    return {
      student: {
        id: student.id,
        studentNumber: student.studentNumber,
        fullName: student.fullName,
        status: student.status,
        programme: student.programme,
      },
      eligible: eligibleIds.has(student.id),
      status,
      lateBy: late,
      deadline: deadline.toISOString(),
      extension: extension
        ? { newDeadline: extension.newDeadline.toISOString(), reason: extension.reason }
        : null,
      submission: submission
        ? {
            id: submission.id,
            firstSubmittedAt: submission.firstSubmittedAt.toISOString(),
            lastSubmittedAt: submission.lastSubmittedAt.toISOString(),
          }
        : null,
      currentFile: versions[0] ?? null,
      versions,
    };
  });

  return { assessmentId: id, total: items.length, summary, items };
}
