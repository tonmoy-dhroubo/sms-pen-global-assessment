import { sessionStartYear } from "./time";

// Student IDs look like `SMS-2026-0042` (DB-004, DB-015): the start year of the student's first session, then a
// per-year sequence padded to four digits. Past 9999 the sequence simply grows (`SMS-2026-10000`), so old and new
// numbers stay unique and parseable.

const PREFIX = "SMS";
const MIN_SEQUENCE_DIGITS = 4;
const PATTERN = /^SMS-(\d{4})-(\d{4,})$/;

export interface ParsedStudentNumber {
  year: number;
  sequence: number;
}

/** Formats a student number. Throws a `RangeError` for a year outside 1000-9999 or a sequence below 1. */
export function formatStudentNumber(year: number, sequence: number): string {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new RangeError(`Student number year must be four digits, got ${year}`);
  }
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new RangeError(`Student number sequence must be a positive integer, got ${sequence}`);
  }
  return `${PREFIX}-${year}-${String(sequence).padStart(MIN_SEQUENCE_DIGITS, "0")}`;
}

/** Reads a student number back into its parts; `null` if the text is not a valid number. */
export function parseStudentNumber(value: string): ParsedStudentNumber | null {
  const match = PATTERN.exec(value.trim());
  if (!match) return null;
  const sequence = Number(match[2]);
  if (!Number.isSafeInteger(sequence) || sequence < 1) return null;
  return { year: Number(match[1]), sequence };
}

/**
 * The year used in a new student's number: the start year of the session they first enrol in (DB-015). Enrolling
 * in January 2027 into session 2026-27 gives 2026. Pass the date the session is judged on, in Dhaka time.
 */
export function studentNumberYear(enrolmentDate: Date): number {
  return sessionStartYear(enrolmentDate);
}
