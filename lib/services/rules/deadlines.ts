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
