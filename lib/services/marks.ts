import { db } from "@/lib/db";
import {
  BusinessRuleError,
  NotFoundError,
  ValidationError,
  VersionConflictError,
} from "@/lib/api/errors";
import { Prisma } from "@/lib/generated/prisma/client";
import {
  eligibleStudentWhere,
  STUDENT_SELECT,
  type SubmissionStatus,
} from "@/lib/services/assessments";
import { systemClock } from "@/lib/services/clock";
import type { Clock } from "@/lib/services/clock";
import { loadFeeSummaries } from "@/lib/services/fee-summary";
import { assertKnownId } from "@/lib/services/ids";
import type { ModuleRef } from "@/lib/services/programmes";
import { effectiveDeadline, isLate, lateBy } from "@/lib/services/rules/deadlines";
import { normaliseName } from "@/lib/services/rules/duplicates";
import { classify, validateMark } from "@/lib/services/rules/marks";
import { toApiString } from "@/lib/services/rules/money";
import { buildPublishPreview } from "@/lib/services/rules/publish";
import type { ExpectedMark, PublishMark } from "@/lib/services/rules/publish";
import { todayIn } from "@/lib/services/rules/time";
import type { Classification, EnrolmentStatus, ReleaseStatus } from "@/lib/services/rules/types";
import type { PublishScope, PutMarkInput } from "@/lib/validation/marks";

// Marks and results for staff (api.md "Marks and results", pages.md Marksheet tab and the student record's Results
// section). The rules are the M04 ones (DB-019 rounding and classification, DB-012 overdue-fee warning); this file
// loads rows, applies them and writes the audit trail. Nothing derived is stored: the classification is computed on
// every read (DB-003).
//
//   - Who is on a marksheet (D-035): Enrolled students whose programme includes the module, plus anyone who submitted
//     or already has a mark, whatever their status now.
//   - A first mark is a DRAFT and writes no MARK_CHANGE row. Every later change to the mark writes one (`MARK`, with the
//     old and new value; a non-submission is a null mark). Publish, withhold and unpublish write `PUBLISH`, `WITHHOLD`
//     and `UNPUBLISH` rows (DB-020, DB-023). Changing a PUBLISHED mark needs a reason and leaves it published.
//   - Marks are optimistic (`version`, DB-016): an update names the version it read; the write is conditional on it.
//   - Release changes are single conditional UPDATE ... RETURNING statements, so two staff acting on the same marks can
//     never both flip one, and a history row exists exactly for each row that really changed.

// --- Shapes ---------------------------------------------------------------------------------------------------------

export interface PersonRef {
  id: string;
  studentNumber: string;
  fullName: string;
}

export interface MarkAssessmentRef {
  id: string;
  title: string;
  module: ModuleRef;
}

/** The facts about one mark, shared by the marksheet, the student results and the write answers. */
export interface MarkFacts {
  /** `"67.5"`: one decimal, always; `null` for a non-submission. */
  mark: string | null;
  isNonSubmission: boolean;
  /** Computed on read from the rounded mark (DB-019). A non-submission is `FAIL` (shown as "NS"). */
  classification: Classification;
  releaseStatus: ReleaseStatus;
  /** Why the result is held back; `null` unless WITHHELD. */
  withheldReason: string | null;
  /** When it was published (ISO); `null` unless PUBLISHED. */
  publishedAt: string | null;
  version: number;
  updatedAt: string;
}

export interface MarkDto extends MarkFacts {
  markId: string;
  assessmentId: string;
  studentId: string;
}

export interface MarksheetRow {
  student: {
    id: string;
    studentNumber: string;
    fullName: string;
    status: EnrolmentStatus;
    programme: { id: string; code: string; name: string };
  };
  /** Enrolled in a programme that includes the module; `false` for a student who submitted or was marked but is not. */
  eligible: boolean;
  submission: {
    status: SubmissionStatus;
    /** How late the latest file is ("2 days"); `null` unless late. Measured against `deadline`. */
    lateBy: string | null;
    /** This student's effective deadline (ISO): their extension if they have one, else the assessment's. */
    deadline: string;
    lastSubmittedAt: string | null;
  };
  /** The mark's id, or `null` when none has been entered. The fields below are `null`/false then. */
  markId: string | null;
  mark: string | null;
  isNonSubmission: boolean;
  classification: Classification | null;
  releaseStatus: ReleaseStatus | null;
  withheldReason: string | null;
  publishedAt: string | null;
  version: number | null;
  updatedAt: string | null;
}

export interface Marksheet {
  assessmentId: string;
  total: number;
  summary: { entered: number; missing: number; draft: number; published: number; withheld: number };
  items: MarksheetRow[];
}

export interface MarkWarning {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface PublishResult {
  dryRun: boolean;
  /** Marks this request really published (0 for a dry run). */
  published: number;
  /** DRAFT and WITHHELD marks in scope: what a real run publishes. */
  toPublish: number;
  alreadyPublished: number;
  missingMarks: { student: PersonRef; assessment: MarkAssessmentRef }[];
  overdueStudents: { student: PersonRef; overdueAmount: string; marksToPublish: number }[];
  overdueTotal: string;
  /** "Publish 18 marks - 2 students have overdue fees, 3 marks missing". */
  summary: string;
}

export interface PublishOutcome {
  result: PublishResult;
  warnings: MarkWarning[];
}

export interface ReleaseChangeResult {
  /** Marks that changed. */
  changed: number;
  /** Marks named in the request that were not in a state this action applies to (left as they are). */
  skipped: number;
  markIds: string[];
}

export interface MarkHistoryEntry {
  id: string;
  change: "MARK" | "PUBLISH" | "WITHHOLD" | "UNPUBLISH";
  /** For `MARK` rows: the value before and after; `null` means a non-submission. Always `null` on release rows. */
  oldMark: string | null;
  newMark: string | null;
  reason: string | null;
  changedBy: { id: string; fullName: string };
  changedAt: string;
}

export interface StudentResultItem extends MarkFacts {
  markId: string;
  assessment: MarkAssessmentRef & { deadline: string };
  enteredBy: { id: string; fullName: string };
  /** Newest first. */
  history: MarkHistoryEntry[];
}

export interface StudentResults {
  student: PersonRef;
  summary: { total: number; draft: number; published: number; withheld: number };
  items: StudentResultItem[];
}

/** What a student sees of one assessment: the published result, or nothing but "not available" (D-035, DB-010). */
export type MyResultItem =
  | {
      status: "PUBLISHED";
      assessment: MarkAssessmentRef;
      mark: string | null;
      isNonSubmission: boolean;
      classification: Classification;
      publishedAt: string;
    }
  | { status: "NOT_AVAILABLE"; assessment: MarkAssessmentRef };

export interface MyResults {
  items: MyResultItem[];
}

// --- Helpers --------------------------------------------------------------------------------------------------------

type Client = Prisma.TransactionClient;

const MODULE_SELECT = { select: { id: true, code: true, title: true } } as const;
const PERSON_SELECT = { select: { id: true, fullName: true } } as const;

type MarkRow = {
  mark: Prisma.Decimal | null;
  isNonSubmission: boolean;
  releaseStatus: ReleaseStatus;
  withheldReason: string | null;
  publishedAt: Date | null;
  version: number;
  updatedAt: Date;
};

/** `"67.5"`: marks always carry one decimal in the API. */
export function markToApi(mark: Prisma.Decimal | null): string | null {
  return mark === null ? null : mark.toFixed(1);
}

function toFacts(row: MarkRow): MarkFacts {
  return {
    mark: markToApi(row.mark),
    isNonSubmission: row.isNonSubmission,
    classification: classify(row),
    releaseStatus: row.releaseStatus,
    withheldReason: row.releaseStatus === "WITHHELD" ? row.withheldReason : null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toMarkDto(
  row: MarkRow & { id: string; assessmentId: string; studentId: string },
): MarkDto {
  return {
    markId: row.id,
    assessmentId: row.assessmentId,
    studentId: row.studentId,
    ...toFacts(row),
  };
}

const MARK_SELECT = {
  id: true,
  assessmentId: true,
  studentId: true,
  mark: true,
  isNonSubmission: true,
  releaseStatus: true,
  withheldReason: true,
  publishedAt: true,
  version: true,
  updatedAt: true,
} as const;

function byNameThenNumber(
  a: { fullName: string; studentNumber: string },
  b: { fullName: string; studentNumber: string },
): number {
  return (
    normaliseName(a.fullName).localeCompare(normaliseName(b.fullName)) ||
    a.studentNumber.localeCompare(b.studentNumber)
  );
}

// --- The marksheet --------------------------------------------------------------------------------------------------

/**
 * One row per student on the marksheet (see the header comment), by name ignoring case and accents, then Student ID:
 * the submission status and lateness against the student's own deadline, and the mark with its classification and
 * release status when one has been entered. A fixed number of queries.
 */
export async function getMarksheet(assessmentId: string): Promise<Marksheet> {
  assertKnownId(assessmentId, "Assessment");
  const assessment = await db.assessment.findUnique({
    where: { id: assessmentId },
    select: { id: true, moduleId: true, deadline: true },
  });
  if (!assessment) throw new NotFoundError("Assessment not found.");

  const [eligibleStudents, submissions, extensions, marks] = await Promise.all([
    db.student.findMany({
      where: eligibleStudentWhere(assessment.moduleId),
      select: STUDENT_SELECT,
    }),
    db.submission.findMany({
      where: { assessmentId },
      select: { studentId: true, lastSubmittedAt: true, student: { select: STUDENT_SELECT } },
    }),
    db.extension.findMany({
      where: { assessmentId },
      select: { studentId: true, newDeadline: true },
    }),
    db.mark.findMany({
      where: { assessmentId },
      select: { ...MARK_SELECT, student: { select: STUDENT_SELECT } },
    }),
  ]);

  type StudentRow = (typeof eligibleStudents)[number];
  const eligibleIds = new Set(eligibleStudents.map((s) => s.id));
  const students = new Map<string, StudentRow>(eligibleStudents.map((s) => [s.id, s]));
  for (const { student } of submissions) students.set(student.id, student);
  for (const { student } of marks) students.set(student.id, student);

  const submissionOf = new Map(submissions.map((s) => [s.studentId, s]));
  const extensionOf = new Map(extensions.map((e) => [e.studentId, e]));
  const markOf = new Map(marks.map((m) => [m.studentId, m]));

  const summary = { entered: 0, missing: 0, draft: 0, published: 0, withheld: 0 };
  const items = [...students.values()].sort(byNameThenNumber).map((student): MarksheetRow => {
    const submission = submissionOf.get(student.id) ?? null;
    const deadline = effectiveDeadline(assessment.deadline, extensionOf.get(student.id));
    const mark = markOf.get(student.id) ?? null;

    let status: SubmissionStatus = "NOT_SUBMITTED";
    let late: string | null = null;
    if (submission) {
      status = isLate(submission.lastSubmittedAt, deadline) ? "LATE" : "ON_TIME";
      late = lateBy(submission.lastSubmittedAt, deadline);
    }

    if (mark) {
      summary.entered += 1;
      if (mark.releaseStatus === "DRAFT") summary.draft += 1;
      else if (mark.releaseStatus === "PUBLISHED") summary.published += 1;
      else summary.withheld += 1;
    } else {
      summary.missing += 1;
    }
    const facts = mark ? toFacts(mark) : null;

    return {
      student: {
        id: student.id,
        studentNumber: student.studentNumber,
        fullName: student.fullName,
        status: student.status,
        programme: student.programme,
      },
      eligible: eligibleIds.has(student.id),
      submission: {
        status,
        lateBy: late,
        deadline: deadline.toISOString(),
        lastSubmittedAt: submission?.lastSubmittedAt.toISOString() ?? null,
      },
      markId: mark?.id ?? null,
      mark: facts?.mark ?? null,
      isNonSubmission: facts?.isNonSubmission ?? false,
      classification: facts?.classification ?? null,
      releaseStatus: facts?.releaseStatus ?? null,
      withheldReason: facts?.withheldReason ?? null,
      publishedAt: facts?.publishedAt ?? null,
      version: facts?.version ?? null,
      updatedAt: facts?.updatedAt ?? null,
    };
  });

  return { assessmentId, total: items.length, summary, items };
}

// --- Entering a mark ------------------------------------------------------------------------------------------------

export interface PutMarkResult {
  mark: MarkDto;
  /** `true` when this request created the mark (HTTP 201). */
  created: boolean;
  /** `false` when the request matched what was stored, so nothing was written and the version did not move. */
  changed: boolean;
}

/** Whether `studentId` may be marked on this assessment: on the eligible list, or has submitted (D-035). */
async function assertOnMarksheet(
  client: Client,
  assessment: { id: string; moduleId: string },
  studentId: string,
): Promise<void> {
  const [eligible, submitted] = await Promise.all([
    client.student.count({
      where: { id: studentId, ...eligibleStudentWhere(assessment.moduleId) },
    }),
    client.submission.count({ where: { assessmentId: assessment.id, studentId } }),
  ]);
  if (eligible === 0 && submitted === 0) {
    throw new BusinessRuleError(
      "STUDENT_NOT_ELIGIBLE",
      "This student is not on the marksheet: they are not enrolled in a programme with this module and have not submitted.",
    );
  }
}

/**
 * Enters or changes one student's mark. Exactly one of a mark (0-100, one decimal) or a non-submission (the mark is then
 * null). First entry: a DRAFT, no history row. Changing a stored mark needs the `version` that was read (stale or
 * missing: 409), writes a `MARK` history row with the old and new value, and, if the mark is PUBLISHED, needs a
 * `reason` (400 on `reason`) and leaves it published. Entering exactly what is stored changes nothing.
 */
export async function putMark(
  assessmentId: string,
  studentId: string,
  input: PutMarkInput,
  actorId: string,
): Promise<PutMarkResult> {
  assertKnownId(assessmentId, "Assessment");
  assertKnownId(studentId, "Student");

  const isNonSubmission = input.isNonSubmission === true;
  // The schema already checked the mark; this turns it into the value that is stored.
  let value: Prisma.Decimal | null = null;
  if (!isNonSubmission) {
    const checked = validateMark(input.mark!);
    if (!checked.ok) throw ValidationError.field("mark", "Enter a mark from 0 to 100.");
    value = new Prisma.Decimal(checked.value.toFixed(1));
  }

  const [assessment, student] = await Promise.all([
    db.assessment.findUnique({ where: { id: assessmentId }, select: { id: true, moduleId: true } }),
    db.student.findUnique({ where: { id: studentId }, select: { id: true } }),
  ]);
  if (!assessment) throw new NotFoundError("Assessment not found.");
  if (!student) throw new NotFoundError("Student not found.");

  const where = { assessmentId_studentId: { assessmentId, studentId } };
  const existing = await db.mark.findUnique({ where, select: { id: true } });

  if (!existing) {
    await assertOnMarksheet(db, assessment, studentId);
    try {
      const created = await db.mark.create({
        data: {
          assessmentId,
          studentId,
          mark: value,
          isNonSubmission,
          enteredById: actorId,
        },
        select: MARK_SELECT,
      });
      return { mark: toMarkDto(created), created: true, changed: true };
    } catch (error) {
      // Someone entered a mark for this student a moment ago: this request did not know about it.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const now = await db.mark.findUnique({ where, select: { version: true } });
        throw new VersionConflictError(now?.version ?? 1);
      }
      throw error;
    }
  }

  return db.$transaction(async (tx) => {
    const current = await tx.mark.findUniqueOrThrow({ where, select: MARK_SELECT });
    if (input.version === undefined || input.version !== current.version) {
      throw new VersionConflictError(current.version);
    }

    const same =
      current.isNonSubmission === isNonSubmission &&
      (value === null
        ? current.mark === null
        : current.mark !== null && current.mark.equals(value));
    if (same) return { mark: toMarkDto(current), created: false, changed: false };

    if (current.releaseStatus === "PUBLISHED" && !input.reason) {
      throw ValidationError.field("reason", "Enter a reason for changing a published mark.");
    }

    const updated = await tx.mark.updateMany({
      where: { id: current.id, version: current.version },
      data: { mark: value, isNonSubmission, version: { increment: 1 } },
    });
    if (updated.count === 0) {
      const now = await tx.mark.findUnique({
        where: { id: current.id },
        select: { version: true },
      });
      throw new VersionConflictError(now?.version ?? current.version + 1);
    }
    await tx.markChange.create({
      data: {
        markId: current.id,
        change: "MARK",
        oldMark: current.mark,
        newMark: value,
        reason: input.reason ?? null,
        changedById: actorId,
      },
    });
    const fresh = await tx.mark.findUniqueOrThrow({ where, select: MARK_SELECT });
    return { mark: toMarkDto(fresh), created: false, changed: true };
  });
}

// --- Publishing -----------------------------------------------------------------------------------------------------

interface ScopeData {
  marks: PublishMark[];
  expected: ExpectedMark[];
}

/**
 * The marks in a publish scope, and the (student, assessment) pairs that should have one (for the "missing" count).
 * Assessment scope expects every student on its marksheet. Student scope expects each assessment the student is
 * enrolled for whose deadline has passed or that is closed, plus any they submitted to. A list of mark ids expects
 * nothing, since the staff member picked marks that exist.
 */
async function loadScope(client: Client, scope: PublishScope, now: Date): Promise<ScopeData> {
  if ("assessmentId" in scope) {
    assertKnownId(scope.assessmentId, "Assessment");
    const assessment = await client.assessment.findUnique({
      where: { id: scope.assessmentId },
      select: { id: true, moduleId: true },
    });
    if (!assessment) throw new NotFoundError("Assessment not found.");
    const [marks, eligible, submissions] = await Promise.all([
      client.mark.findMany({
        where: { assessmentId: assessment.id },
        select: { id: true, studentId: true, assessmentId: true, releaseStatus: true },
      }),
      client.student.findMany({
        where: eligibleStudentWhere(assessment.moduleId),
        select: { id: true },
      }),
      client.submission.findMany({
        where: { assessmentId: assessment.id },
        select: { studentId: true },
      }),
    ]);
    const studentIds = new Set([
      ...eligible.map((s) => s.id),
      ...submissions.map((s) => s.studentId),
    ]);
    return {
      marks: marks.map(toPublishMark),
      expected: [...studentIds].map((studentId) => ({ studentId, assessmentId: assessment.id })),
    };
  }

  if ("studentId" in scope) {
    assertKnownId(scope.studentId, "Student");
    const student = await client.student.findUnique({
      where: { id: scope.studentId },
      select: { id: true, status: true, programmeId: true },
    });
    if (!student) throw new NotFoundError("Student not found.");
    const [marks, due, submissions] = await Promise.all([
      client.mark.findMany({
        where: { studentId: student.id },
        select: { id: true, studentId: true, assessmentId: true, releaseStatus: true },
      }),
      student.status === "ENROLLED"
        ? client.assessment.findMany({
            where: {
              module: { programmes: { some: { programmeId: student.programmeId } } },
              OR: [{ deadline: { lt: now } }, { closedAt: { not: null } }],
            },
            select: { id: true },
          })
        : Promise.resolve([]),
      client.submission.findMany({
        where: { studentId: student.id },
        select: { assessmentId: true },
      }),
    ]);
    const assessmentIds = new Set([
      ...due.map((a) => a.id),
      ...submissions.map((s) => s.assessmentId),
    ]);
    return {
      marks: marks.map(toPublishMark),
      expected: [...assessmentIds].map((assessmentId) => ({ studentId: student.id, assessmentId })),
    };
  }

  const marks = await client.mark.findMany({
    where: { id: { in: scope.markIds } },
    select: { id: true, studentId: true, assessmentId: true, releaseStatus: true },
  });
  if (marks.length !== scope.markIds.length)
    throw new NotFoundError("One or more marks were not found.");
  return { marks: marks.map(toPublishMark), expected: [] };
}

function toPublishMark(row: {
  id: string;
  studentId: string;
  assessmentId: string;
  releaseStatus: ReleaseStatus;
}): PublishMark {
  return {
    markId: row.id,
    studentId: row.studentId,
    assessmentId: row.assessmentId,
    releaseStatus: row.releaseStatus,
  };
}

/**
 * Publishes the DRAFT and WITHHELD marks in `scope` (already-published ones are left alone), or, with `dryRun`, only
 * says what that would do: the counts, the missing marks, and the students who owe overdue fees (DB-012: a warning,
 * never a block). The same figures and warnings come back either way. A real run clears any withheld reason, stamps
 * `publishedAt` and writes one `PUBLISH` history row per mark it really changed.
 */
export async function publishMarks(
  scope: PublishScope,
  options: { dryRun: boolean },
  actorId: string,
  clock: Clock = systemClock,
): Promise<PublishOutcome> {
  const now = clock();
  return db.$transaction(async (tx) => {
    const { marks, expected } = await loadScope(tx, scope, now);
    const publishable = marks.filter((m) => m.releaseStatus !== "PUBLISHED");

    // Overdue fees are judged for the students who actually have something to publish.
    const studentIds = [...new Set(publishable.map((m) => m.studentId))];
    const summaries = await loadFeeSummaries(studentIds, todayIn(now), tx);
    const overdue = [...summaries]
      .filter(([, summary]) => summary.overdueAmount.greaterThan(0))
      .map(([studentId, summary]) => ({ studentId, overdueAmount: summary.overdueAmount }));

    const preview = buildPublishPreview({ marks, expected, overdueStudents: overdue });

    let published = 0;
    if (!options.dryRun && publishable.length > 0) {
      const ids = publishable.map((m) => m.markId);
      const rows = await tx.$queryRaw<{ id: string }[]>`
        UPDATE marks
        SET release_status = 'PUBLISHED', published_at = ${now}, withheld_reason = NULL,
            version = version + 1, updated_at = ${now}
        WHERE id = ANY(${ids}::uuid[]) AND release_status <> 'PUBLISHED'
        RETURNING id::text AS id`;
      published = rows.length;
      if (rows.length > 0) {
        await tx.markChange.createMany({
          data: rows.map((row) => ({
            markId: row.id,
            change: "PUBLISH" as const,
            changedById: actorId,
            changedAt: now,
          })),
        });
      }
    }

    // Names for the people and assessments the preview mentions.
    const personIds = [
      ...new Set([
        ...preview.overdueStudents.map((s) => s.studentId),
        ...preview.missingMarks.map((m) => m.studentId),
      ]),
    ];
    const assessmentIds = [...new Set(preview.missingMarks.map((m) => m.assessmentId))];
    const [people, assessments] = await Promise.all([
      tx.student.findMany({
        where: { id: { in: personIds } },
        select: { id: true, studentNumber: true, fullName: true },
      }),
      tx.assessment.findMany({
        where: { id: { in: assessmentIds } },
        select: { id: true, title: true, module: MODULE_SELECT },
      }),
    ]);
    const personOf = new Map(people.map((p) => [p.id, p]));
    const assessmentOf = new Map(assessments.map((a) => [a.id, a]));

    const missingMarks = preview.missingMarks
      .map((m) => ({
        student: personOf.get(m.studentId)!,
        assessment: assessmentOf.get(m.assessmentId)!,
      }))
      .sort(
        (a, b) =>
          byNameThenNumber(a.student, b.student) ||
          a.assessment.title.localeCompare(b.assessment.title),
      );
    const overdueStudents = preview.overdueStudents
      .map((s) => ({
        student: personOf.get(s.studentId)!,
        overdueAmount: toApiString(s.overdueAmount),
        marksToPublish: s.marksToPublish,
        amount: s.overdueAmount,
      }))
      .sort((a, b) => b.amount.comparedTo(a.amount) || byNameThenNumber(a.student, b.student))
      .map(({ student, overdueAmount, marksToPublish }) => ({
        student,
        overdueAmount,
        marksToPublish,
      }));

    const warnings: MarkWarning[] = preview.warnings.map((warning) =>
      warning.code === "OVERDUE_FEES"
        ? {
            ...warning,
            details: {
              students: overdueStudents.length,
              amount: toApiString(preview.overdueTotal),
            },
          }
        : { ...warning, details: { count: missingMarks.length } },
    );

    return {
      result: {
        dryRun: options.dryRun,
        published,
        toPublish: preview.toPublish,
        alreadyPublished: preview.alreadyPublished,
        missingMarks,
        overdueStudents,
        overdueTotal: toApiString(preview.overdueTotal),
        summary: preview.summary,
      },
      warnings,
    };
  });
}

// --- Withholding and unpublishing -----------------------------------------------------------------------------------

async function assertMarksExist(client: Client, markIds: readonly string[]): Promise<void> {
  const found = await client.mark.count({ where: { id: { in: [...markIds] } } });
  if (found !== markIds.length) throw new NotFoundError("One or more marks were not found.");
}

/**
 * Holds results back: DRAFT or PUBLISHED marks become WITHHELD with the reason (and stop being published). Marks that
 * are already WITHHELD are left as they are, with their original reason. One `WITHHOLD` row per mark that changed.
 */
export async function withholdMarks(
  markIds: readonly string[],
  reason: string,
  actorId: string,
  clock: Clock = systemClock,
): Promise<ReleaseChangeResult> {
  const now = clock();
  return db.$transaction(async (tx) => {
    await assertMarksExist(tx, markIds);
    const ids = [...markIds];
    const rows = await tx.$queryRaw<{ id: string }[]>`
      UPDATE marks
      SET release_status = 'WITHHELD', withheld_reason = ${reason}, published_at = NULL,
          version = version + 1, updated_at = ${now}
      WHERE id = ANY(${ids}::uuid[]) AND release_status IN ('DRAFT', 'PUBLISHED')
      RETURNING id::text AS id`;
    if (rows.length > 0) {
      await tx.markChange.createMany({
        data: rows.map((row) => ({
          markId: row.id,
          change: "WITHHOLD" as const,
          reason,
          changedById: actorId,
          changedAt: now,
        })),
      });
    }
    return {
      changed: rows.length,
      skipped: ids.length - rows.length,
      markIds: rows.map((r) => r.id),
    };
  });
}

/**
 * Takes published results back to DRAFT, with a reason. Only PUBLISHED marks change; DRAFT and WITHHELD ones are left
 * as they are. One `UNPUBLISH` row per mark that changed.
 */
export async function unpublishMarks(
  markIds: readonly string[],
  reason: string,
  actorId: string,
  clock: Clock = systemClock,
): Promise<ReleaseChangeResult> {
  const now = clock();
  return db.$transaction(async (tx) => {
    await assertMarksExist(tx, markIds);
    const ids = [...markIds];
    const rows = await tx.$queryRaw<{ id: string }[]>`
      UPDATE marks
      SET release_status = 'DRAFT', published_at = NULL, version = version + 1, updated_at = ${now}
      WHERE id = ANY(${ids}::uuid[]) AND release_status = 'PUBLISHED'
      RETURNING id::text AS id`;
    if (rows.length > 0) {
      await tx.markChange.createMany({
        data: rows.map((row) => ({
          markId: row.id,
          change: "UNPUBLISH" as const,
          reason,
          changedById: actorId,
          changedAt: now,
        })),
      });
    }
    return {
      changed: rows.length,
      skipped: ids.length - rows.length,
      markIds: rows.map((r) => r.id),
    };
  });
}

// --- Results --------------------------------------------------------------------------------------------------------

/**
 * Every mark a student has, newest assessment deadline first, with its release status and full history (who changed
 * what, when and why). For staff only: it includes drafts and withheld reasons.
 */
export async function getStudentResults(studentId: string): Promise<StudentResults> {
  assertKnownId(studentId, "Student");
  const student = await db.student.findUnique({
    where: { id: studentId },
    select: { id: true, studentNumber: true, fullName: true },
  });
  if (!student) throw new NotFoundError("Student not found.");

  const marks = await db.mark.findMany({
    where: { studentId },
    select: {
      ...MARK_SELECT,
      enteredBy: PERSON_SELECT,
      assessment: { select: { id: true, title: true, deadline: true, module: MODULE_SELECT } },
      changes: {
        orderBy: [{ changedAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          change: true,
          oldMark: true,
          newMark: true,
          reason: true,
          changedAt: true,
          changedBy: PERSON_SELECT,
        },
      },
    },
  });
  marks.sort(
    (a, b) =>
      b.assessment.deadline.getTime() - a.assessment.deadline.getTime() ||
      a.assessment.title.localeCompare(b.assessment.title),
  );

  const summary = { total: marks.length, draft: 0, published: 0, withheld: 0 };
  const items = marks.map((row): StudentResultItem => {
    if (row.releaseStatus === "DRAFT") summary.draft += 1;
    else if (row.releaseStatus === "PUBLISHED") summary.published += 1;
    else summary.withheld += 1;
    return {
      markId: row.id,
      assessment: {
        id: row.assessment.id,
        title: row.assessment.title,
        deadline: row.assessment.deadline.toISOString(),
        module: row.assessment.module,
      },
      ...toFacts(row),
      enteredBy: row.enteredBy,
      history: row.changes.map((change) => ({
        id: change.id,
        change: change.change,
        oldMark: markToApi(change.oldMark),
        newMark: markToApi(change.newMark),
        reason: change.reason,
        changedBy: change.changedBy,
        changedAt: change.changedAt.toISOString(),
      })),
    };
  });

  return { student, summary, items };
}

/**
 * The signed-in student's results (api.md "Student self-service"). One entry per assessment that is theirs: those of
 * their programme's modules, any they submitted to, and any they were marked on. PUBLISHED marks carry the mark and
 * classification; everything else (draft, withheld, or no mark yet) is `{ status: "NOT_AVAILABLE" }` with the
 * assessment's name and nothing else, so a student cannot tell a withheld mark from one not entered, and never sees a
 * withheld reason.
 */
export async function getMyResults(studentId: string): Promise<MyResults> {
  const student = await db.student.findUnique({
    where: { id: studentId },
    select: { id: true, programmeId: true },
  });
  if (!student) throw new NotFoundError("Student not found.");

  const assessmentSelect = {
    id: true,
    title: true,
    deadline: true,
    module: MODULE_SELECT,
  } as const;
  const [programmeAssessments, marks, submissions] = await Promise.all([
    db.assessment.findMany({
      where: { module: { programmes: { some: { programmeId: student.programmeId } } } },
      select: assessmentSelect,
    }),
    db.mark.findMany({
      where: { studentId },
      select: {
        mark: true,
        isNonSubmission: true,
        releaseStatus: true,
        publishedAt: true,
        assessment: { select: assessmentSelect },
      },
    }),
    db.submission.findMany({
      where: { studentId },
      select: { assessment: { select: assessmentSelect } },
    }),
  ]);

  const assessments = new Map<string, (typeof programmeAssessments)[number]>();
  for (const assessment of programmeAssessments) assessments.set(assessment.id, assessment);
  for (const { assessment } of submissions) assessments.set(assessment.id, assessment);
  for (const { assessment } of marks) assessments.set(assessment.id, assessment);
  const markOf = new Map(marks.map((m) => [m.assessment.id, m]));

  const items = [...assessments.values()]
    .sort((a, b) => b.deadline.getTime() - a.deadline.getTime() || a.title.localeCompare(b.title))
    .map((assessment): MyResultItem => {
      const ref = { id: assessment.id, title: assessment.title, module: assessment.module };
      const mark = markOf.get(assessment.id);
      if (!mark || mark.releaseStatus !== "PUBLISHED" || !mark.publishedAt) {
        return { status: "NOT_AVAILABLE", assessment: ref };
      }
      return {
        status: "PUBLISHED",
        assessment: ref,
        mark: markToApi(mark.mark),
        isNonSubmission: mark.isNonSubmission,
        classification: classify(mark),
        publishedAt: mark.publishedAt.toISOString(),
      };
    });
  return { items };
}
