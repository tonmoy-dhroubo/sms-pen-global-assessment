import { formatDuration } from "./time";

// Deadlines (DB-003, DB-014, D-023). Late is derived, never stored, so changing a deadline or granting an extension
// takes effect immediately. Times are instants; they are compared in UTC, so no time zone is involved.

/**
 * The deadline that applies to one student: their extension's `newDeadline` if they have one, else the assessment's
 * deadline (db/README.md). An extension is used as given, even if it is earlier than the assessment deadline.
 */
export function effectiveDeadline(
  assessmentDeadline: Date,
  extension?: { newDeadline: Date } | null,
): Date {
  return extension ? extension.newDeadline : assessmentDeadline;
}

/** A file is late when it arrived strictly after the deadline; arriving at the deadline instant is on time. */
export function isLate(uploadedAt: Date, deadline: Date): boolean {
  return uploadedAt.getTime() > deadline.getTime();
}

/** Whether `now` is past the deadline (the same strict comparison as `isLate`). */
export function isPastDeadline(now: Date, deadline: Date): boolean {
  return isLate(now, deadline);
}

/**
 * How late a file is, in its largest whole unit rounded down ("5 hours", "2 days", "12 minutes", "less than a
 * minute"), or `null` when it is on time.
 */
export function lateBy(uploadedAt: Date, deadline: Date): string | null {
  if (!isLate(uploadedAt, deadline)) return null;
  return formatDuration(uploadedAt.getTime() - deadline.getTime());
}

// --- Assessment state and deadline changes (M12) ------------------------------------------------------------------

/** Where an assessment stands for staff: accepting on-time work, accepting late work, or closed to uploads. */
export type AssessmentState = "open" | "past-deadline" | "closed";

/**
 * `closed` once staff have closed it (no uploads at all); otherwise `past-deadline` when the deadline has gone by
 * (uploads are still accepted and flagged late); otherwise `open`.
 */
export function assessmentState(
  assessment: { deadline: Date; closedAt?: Date | null },
  now: Date,
): AssessmentState {
  if (assessment.closedAt) return "closed";
  return isPastDeadline(now, assessment.deadline) ? "past-deadline" : "open";
}

/**
 * How many submissions change between on time and late when an assessment's deadline moves from `oldDeadline` to
 * `newDeadline` (edge-cases.md: late flags are derived, so they follow the deadline). A student with an extension has
 * their own deadline, which the assessment's does not touch, so they never flip. `extensions` maps a student id to
 * their extension's new deadline.
 */
export function countLateFlagChanges(
  submissions: readonly { studentId: string; lastSubmittedAt: Date }[],
  extensions: ReadonlyMap<string, Date>,
  oldDeadline: Date,
  newDeadline: Date,
): number {
  let changed = 0;
  for (const submission of submissions) {
    if (extensions.has(submission.studentId)) continue;
    if (
      isLate(submission.lastSubmittedAt, oldDeadline) !==
      isLate(submission.lastSubmittedAt, newDeadline)
    ) {
      changed += 1;
    }
  }
  return changed;
}
