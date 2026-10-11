import type { DateOnly } from "./types";

// Duplicate detection for new students (edge-cases.md "Enrolment"): same name and date of birth, different email.
// The comparison ignores case, accents and extra spaces, so "  José   GARCÍA " matches "Jose Garcia". Database
// search uses unaccent(lower(...)) (DB-021); this is the equivalent for in-process comparison.

// Combining diacritics (U+0300-U+036F). Other combining marks, such as Bengali vowel signs, belong to the letters.
const DIACRITICS = /[̀-ͯ]/g;

/** Lower-cases, strips accents (after NFKD decomposition) and collapses runs of whitespace. */
export function normaliseName(name: string): string {
  return name.normalize("NFKD").replace(DIACRITICS, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export interface DuplicateCandidate {
  fullName: string;
  dateOfBirth: DateOnly;
}

/** True when two people share a normalised name and the same date of birth. */
export function isProbableDuplicate(a: DuplicateCandidate, b: DuplicateCandidate): boolean {
  return a.dateOfBirth === b.dateOfBirth && normaliseName(a.fullName) === normaliseName(b.fullName);
}
