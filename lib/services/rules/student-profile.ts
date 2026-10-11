import { parseDateOnly, sessionLabel } from "./time";
import type { DateOnly } from "./types";

// Plausibility rules for a student's profile (edge-cases.md "Enrolment"): the date of birth must not be in the
// future and the age must be 16-100, and the session label must be a real `YYYY-YY` session. Pure: "today" is a
// parameter, so the same checks run in the form, the API and the tests.

export const MIN_STUDENT_AGE = 16;
export const MAX_STUDENT_AGE = 100;

export type DateOfBirthProblem = "FUTURE" | "TOO_YOUNG" | "TOO_OLD";

/** Whole years between a date of birth and `today` (both `YYYY-MM-DD`); negative for a date in the future. */
export function ageOn(dateOfBirth: DateOnly, today: DateOnly): number {
  const birth = parseDateOnly(dateOfBirth);
  const now = parseDateOnly(today);
  const birthdayPassed =
    now.month > birth.month || (now.month === birth.month && now.day >= birth.day);
  return now.year - birth.year - (birthdayPassed ? 0 : 1);
}

/**
 * What is wrong with a date of birth, or `null` when it is fine. A student turning 16 today is accepted, and so is
 * one turning 100 today; a student turning 101 today is the first rejected.
 */
export function dateOfBirthProblem(
  dateOfBirth: DateOnly,
  today: DateOnly,
): DateOfBirthProblem | null {
  if (dateOfBirth > today) return "FUTURE"; // YYYY-MM-DD sorts as text
  const age = ageOn(dateOfBirth, today);
  if (age < MIN_STUDENT_AGE) return "TOO_YOUNG";
  if (age > MAX_STUDENT_AGE) return "TOO_OLD";
  return null;
}

/** The message shown next to the date of birth field for each problem. */
export const DATE_OF_BIRTH_MESSAGES: Record<DateOfBirthProblem, string> = {
  FUTURE: "Date of birth cannot be in the future.",
  TOO_YOUNG: `Students must be at least ${MIN_STUDENT_AGE} years old.`,
  TOO_OLD: `Students must be at most ${MAX_STUDENT_AGE} years old.`,
};

// Sessions are labelled `2026-27`: the start year, then the last two digits of the next year. A technical guard keeps
// the start year inside what `formatStudentNumber` accepts and what a Registry could plausibly hold.
const SESSION_PATTERN = /^(\d{4})-(\d{2})$/;
export const MIN_SESSION_START_YEAR = 2000;
export const MAX_SESSION_START_YEAR = 2099;

/** The start year of a session label such as `2026-27`; `null` when the label is not a valid session. */
export function sessionStartYearOf(label: string): number | null {
  const match = SESSION_PATTERN.exec(label);
  if (!match) return null;
  const start = Number(match[1]);
  if (start < MIN_SESSION_START_YEAR || start > MAX_SESSION_START_YEAR) return null;
  return sessionLabel(start) === label ? start : null;
}
