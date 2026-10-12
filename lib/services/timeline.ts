import { NotFoundError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { assertKnownId } from "@/lib/services/ids";
import { effectiveDeadline, isLate, lateBy } from "@/lib/services/rules/deadlines";
import { formatBdt, toApiString } from "@/lib/services/rules/money";
import { toDateOnly } from "@/lib/services/rules/time";
import { PAYMENT_METHOD_LABEL } from "@/lib/validation/fees";
import { TIMELINE_DEFAULT_LIMIT } from "@/lib/validation/timeline";

// The activity timeline of one student (api.md "Students", pages.md `/staff/students/[id]`): everything that was done to
// or for the student, merged and newest first. It reads the audit rows the earlier milestones already write (DB-005,
// DB-020, DB-024) and stores nothing of its own:
//
//   STATUS_CHANGE        status_changes    (the first row is the enrolment)
//   FEE_CHARGE           fee_charges       (programme fees, adjustments, waivers; who added it)
//   PAYMENT_RECORDED     payments          (when it was recorded, not the payment date)
//   PAYMENT_VOIDED       payments          (a second event for the same row, when it was voided)
//   SUBMISSION           submission_files  (one event per uploaded version, with its late flag)
//   MARK_CHANGED         mark_changes MARK (old -> new and the reason; the first entry of a mark writes no row, DB-023)
//   MARK_PUBLISHED / MARK_WITHHELD / MARK_UNPUBLISHED   mark_changes PUBLISH / WITHHOLD / UNPUBLISH
//
// Paging is by cursor: `before` is the previous page's `nextBefore`, and an event is "older" when its time is strictly
// earlier. Each source is queried once with `LIMIT limit + 1` (six fixed queries, plus one for the student's extensions),
// the rows are merged, and the first `limit` are the page. Events that share a timestamp (a publish writes one row per
// mark at the same instant) are never split across pages: the page grows to take the whole tie.

export const TIMELINE_EVENT_TYPES = [
  "STATUS_CHANGE",
  "FEE_CHARGE",
  "PAYMENT_RECORDED",
  "PAYMENT_VOIDED",
  "SUBMISSION",
  "MARK_CHANGED",
  "MARK_PUBLISHED",
  "MARK_WITHHELD",
  "MARK_UNPUBLISHED",
] as const;
export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];

export interface TimelineActor {
  id: string;
  fullName: string;
}

export type TimelineDetails = Record<string, string | number | boolean | null>;

export interface TimelineEvent {
  /** Unique across the timeline: `<kind>:<row id>`. */
  id: string;
  type: TimelineEventType;
  /** When it happened (ISO 8601 UTC). */
  at: string;
  /** The staff member who did it; `null` for a student's own upload (the student is the subject of the timeline). */
  actor: TimelineActor | null;
  /** One plain sentence, without the actor ("Payment recorded: ৳40,000.00 by bank transfer"). */
  summary: string;
  /** The facts behind the sentence, per type (api.md "Students"). */
  details: TimelineDetails;
  /** A page that shows the thing the event is about (the assessment), when there is one. */
  href?: string;
}

export interface StudentTimeline {
  items: TimelineEvent[];
  /** Pass as `before` for the next (older) page; `null` when there is nothing older. */
  nextBefore: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  ENROLLED: "Enrolled",
  DEFERRED: "Deferred",
  WITHDRAWN: "Withdrawn",
  COMPLETED: "Completed",
};

const PERSON = { select: { id: true, fullName: true } } as const;
const ASSESSMENT = {
  select: { id: true, title: true, deadline: true, module: { select: { code: true } } },
} as const;

/** How a source is asked for rows: older than a time (a page), or exactly at one (finishing a tie). */
type Bound = { lt: Date } | { equals: Date } | undefined;

/** Fetches one source's events within the bound, newest first, at most `take` of them (all when omitted). */
type Source = (bound: Bound, take?: number) => Promise<TimelineEvent[]>;

const order = <K extends string>(field: K) =>
  [{ [field]: "desc" }, { id: "desc" }] as { [P in K | "id"]: "desc" }[];

function assessmentHref(assessmentId: string): string {
  return `/staff/assessments/${assessmentId}`;
}

function markText(mark: Prisma.Decimal | null): string {
  return mark === null ? "NS" : mark.toFixed(1);
}

function buildSources(studentId: string, deadlines: ExtensionDeadlines): Source[] {
  const statusChanges: Source = async (bound, take) => {
    const rows = await db.statusChange.findMany({
      where: { studentId, changedAt: bound },
      orderBy: order("changedAt"),
      take,
      select: {
        id: true,
        fromStatus: true,
        toStatus: true,
        reason: true,
        changedAt: true,
        changedBy: PERSON,
      },
    });
    return rows.map((row) => ({
      id: `status:${row.id}`,
      type: "STATUS_CHANGE",
      at: row.changedAt.toISOString(),
      actor: row.changedBy,
      summary: row.fromStatus
        ? `Status changed from ${STATUS_LABEL[row.fromStatus]} to ${STATUS_LABEL[row.toStatus]}`
        : `Enrolled as a new student (${STATUS_LABEL[row.toStatus]})`,
      details: { fromStatus: row.fromStatus, toStatus: row.toStatus, reason: row.reason },
    }));
  };

  const charges: Source = async (bound, take) => {
    const rows = await db.feeCharge.findMany({
      where: { studentId, createdAt: bound },
      orderBy: order("createdAt"),
      take,
      select: {
        id: true,
        kind: true,
        academicYear: true,
        description: true,
        amount: true,
        dueDate: true,
        createdAt: true,
        createdBy: PERSON,
      },
    });
    return rows.map((row) => {
      const label =
        row.kind === "WAIVER"
          ? "Waiver applied"
          : row.kind === "ADJUSTMENT"
            ? "Adjustment added"
            : "Fee charged";
      return {
        id: `charge:${row.id}`,
        type: "FEE_CHARGE",
        at: row.createdAt.toISOString(),
        actor: row.createdBy,
        summary: `${label}: ${row.description} (${formatBdt(row.amount)})`,
        details: {
          chargeId: row.id,
          kind: row.kind,
          description: row.description,
          amount: toApiString(row.amount),
          dueDate: toDateOnly(row.dueDate),
          academicYear: row.academicYear,
        },
      };
    });
  };

  const paymentsRecorded: Source = async (bound, take) => {
    const rows = await db.payment.findMany({
      where: { studentId, recordedAt: bound },
      orderBy: order("recordedAt"),
      take,
      select: {
        id: true,
        amount: true,
        method: true,
        paidAt: true,
        reference: true,
        recordedAt: true,
        recordedBy: PERSON,
      },
    });
    return rows.map((row) => ({
      id: `payment:${row.id}`,
      type: "PAYMENT_RECORDED",
      at: row.recordedAt.toISOString(),
      actor: row.recordedBy,
      summary: `Payment recorded: ${formatBdt(row.amount)} by ${PAYMENT_METHOD_LABEL[row.method].toLowerCase()}, reference ${row.reference}`,
      details: {
        paymentId: row.id,
        amount: toApiString(row.amount),
        method: row.method,
        paidAt: toDateOnly(row.paidAt),
        reference: row.reference,
      },
    }));
  };

  const paymentsVoided: Source = async (bound, take) => {
    const rows = await db.payment.findMany({
      // Without a bound, still only the rows that were voided (a bound on the column already excludes the rest).
      where: { studentId, voidedAt: bound ?? { not: null } },
      orderBy: order("voidedAt"),
      take,
      select: {
        id: true,
        amount: true,
        method: true,
        reference: true,
        voidedAt: true,
        voidReason: true,
        voidedBy: PERSON,
      },
    });
    return rows.flatMap((row): TimelineEvent[] =>
      row.voidedAt
        ? [
            {
              id: `void:${row.id}`,
              type: "PAYMENT_VOIDED",
              at: row.voidedAt.toISOString(),
              actor: row.voidedBy,
              summary: `Payment voided: ${formatBdt(row.amount)}, reference ${row.reference}`,
              details: {
                paymentId: row.id,
                amount: toApiString(row.amount),
                method: row.method,
                reference: row.reference,
                reason: row.voidReason,
              },
            },
          ]
        : [],
    );
  };

  const submissions: Source = async (bound, take) => {
    const rows = await db.submissionFile.findMany({
      where: { submission: { studentId }, uploadedAt: bound },
      orderBy: order("uploadedAt"),
      take,
      select: {
        id: true,
        originalName: true,
        sizeBytes: true,
        uploadedAt: true,
        submission: { select: { assessment: ASSESSMENT } },
      },
    });
    return rows.map((row) => {
      const { assessment } = row.submission;
      // Late is judged against this student's own deadline (their extension, if any), as everywhere else (DB-014).
      const deadline = effectiveDeadline(
        assessment.deadline,
        deadlines.get(assessment.id) ? { newDeadline: deadlines.get(assessment.id)! } : null,
      );
      const late = isLate(row.uploadedAt, deadline);
      return {
        id: `submission:${row.id}`,
        type: "SUBMISSION",
        at: row.uploadedAt.toISOString(),
        actor: null,
        summary: `Submitted ${assessment.title} (${row.originalName})${late ? `, late by ${lateBy(row.uploadedAt, deadline)}` : ""}`,
        details: {
          assessmentId: assessment.id,
          assessmentTitle: assessment.title,
          moduleCode: assessment.module.code,
          fileName: row.originalName,
          sizeBytes: row.sizeBytes,
          late,
          lateBy: lateBy(row.uploadedAt, deadline),
          deadline: deadline.toISOString(),
        },
        href: assessmentHref(assessment.id),
      };
    });
  };

  const markChanges: Source = async (bound, take) => {
    const rows = await db.markChange.findMany({
      where: { mark: { studentId }, changedAt: bound },
      orderBy: order("changedAt"),
      take,
      select: {
        id: true,
        change: true,
        oldMark: true,
        newMark: true,
        reason: true,
        changedAt: true,
        changedBy: PERSON,
        mark: { select: { id: true, assessment: ASSESSMENT } },
      },
    });
    return rows.map((row) => {
      const { assessment } = row.mark;
      const common = {
        markId: row.mark.id,
        assessmentId: assessment.id,
        assessmentTitle: assessment.title,
        moduleCode: assessment.module.code,
        reason: row.reason,
      };
      const base = {
        id: `mark:${row.id}`,
        at: row.changedAt.toISOString(),
        actor: row.changedBy,
        href: assessmentHref(assessment.id),
      };
      switch (row.change) {
        case "MARK":
          return {
            ...base,
            type: "MARK_CHANGED",
            summary: `Mark changed for ${assessment.title}: ${markText(row.oldMark)} to ${markText(row.newMark)}`,
            // `null` is a non-submission, as in the results history.
            details: {
              ...common,
              oldMark: row.oldMark === null ? null : row.oldMark.toFixed(1),
              newMark: row.newMark === null ? null : row.newMark.toFixed(1),
            },
          } satisfies TimelineEvent;
        case "PUBLISH":
          return {
            ...base,
            type: "MARK_PUBLISHED",
            summary: `Result published: ${assessment.title}`,
            details: common,
          } satisfies TimelineEvent;
        case "WITHHOLD":
          return {
            ...base,
            type: "MARK_WITHHELD",
            summary: `Result withheld: ${assessment.title}`,
            details: common,
          } satisfies TimelineEvent;
        case "UNPUBLISH":
          return {
            ...base,
            type: "MARK_UNPUBLISHED",
            summary: `Result unpublished: ${assessment.title}`,
            details: common,
          } satisfies TimelineEvent;
      }
    });
  };

  return [statusChanges, charges, paymentsRecorded, paymentsVoided, submissions, markChanges];
}

/** Assessment id -> the student's extended deadline. */
type ExtensionDeadlines = Map<string, Date>;

/** Newest first; events at the same instant fall back to their id so the order is the same on every request. */
function newestFirst(a: TimelineEvent, b: TimelineEvent): number {
  // ISO strings of one format (UTC, milliseconds) sort chronologically as text.
  if (a.at !== b.at) return a.at < b.at ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * One page of a student's activity, newest first. `limit` events are returned (more when the last ones share a time
 * with the next, so a page never ends inside a tie), and `nextBefore` is the cursor for the page after. An unknown or
 * malformed student id is a 404.
 */
export async function getStudentTimeline(
  studentId: string,
  { before, limit = TIMELINE_DEFAULT_LIMIT }: { before?: Date; limit?: number } = {},
): Promise<StudentTimeline> {
  assertKnownId(studentId, "Student");
  const [student, extensions] = await Promise.all([
    db.student.findUnique({ where: { id: studentId }, select: { id: true } }),
    db.extension.findMany({
      where: { studentId },
      select: { assessmentId: true, newDeadline: true },
    }),
  ]);
  if (!student) throw new NotFoundError("Student not found.");

  const sources = buildSources(
    studentId,
    new Map(extensions.map((row) => [row.assessmentId, row.newDeadline])),
  );
  const bound: Bound = before ? { lt: before } : undefined;

  const merged = (await Promise.all(sources.map((source) => source(bound, limit + 1))))
    .flat()
    .sort(newestFirst);
  if (merged.length <= limit) return { items: merged, nextBefore: null };

  let page = merged.slice(0, limit);
  const boundary = page[limit - 1]!.at;
  let more = true;

  if (merged[limit]!.at === boundary) {
    // The page ends inside a tie: take every event at that instant, whichever source it came from.
    const ties = (await Promise.all(sources.map((source) => source({ equals: new Date(boundary) }))))
      .flat();
    page = [...merged.filter((event) => event.at > boundary), ...ties].sort(newestFirst);
    // Only the tie was left over, so look for anything older before promising another page.
    more =
      merged.some((event) => event.at < boundary) ||
      (await Promise.all(sources.map((source) => source({ lt: new Date(boundary) }, 1)))).some(
        (events) => events.length > 0,
      );
  }

  return { items: page, nextBefore: more ? page[page.length - 1]!.at : null };
}
