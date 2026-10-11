import { Decimal, toDecimal, type MoneyValue } from "./money";
import type { Classification } from "./types";

// Marks (DB-019): 0-100 with at most one decimal place. Classification rounds the mark half-up to a whole number
// first, then applies the thresholds. The stored and displayed mark is never changed by the rounding.

export const MIN_MARK = new Decimal(0);
export const MAX_MARK = new Decimal(100);

export type MarkError = "NOT_A_NUMBER" | "OUT_OF_RANGE" | "TOO_MANY_DECIMALS";

export type MarkValidation = { ok: true; value: Decimal } | { ok: false; code: MarkError };

// Digits with an optional sign and fraction. No exponents, no thousands separators, no "NaN" or "Infinity".
const MARK_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/**
 * Validates marksheet input: a number from 0 to 100 inclusive with at most one decimal place. Strings are trimmed
 * ("67.50" is accepted as 67.5; "40.25" is rejected). Range is checked before decimals, so 100.25 is out of range.
 */
export function validateMark(input: string | number): MarkValidation {
  // Numbers that print in exponent form (1e-7) or are not finite fail the pattern, which is right: never valid marks.
  const text = typeof input === "number" ? String(input) : input.trim();
  if (!MARK_PATTERN.test(text)) return { ok: false, code: "NOT_A_NUMBER" };
  const value = new Decimal(text);
  if (value.lessThan(MIN_MARK) || value.greaterThan(MAX_MARK))
    return { ok: false, code: "OUT_OF_RANGE" };
  if (value.decimalPlaces() > 1) return { ok: false, code: "TOO_MANY_DECIMALS" };
  return { ok: true, value: value.isZero() ? MIN_MARK : value }; // avoids a negative zero from "-0"
}

/** Rounds a mark half-up to a whole number (39.5 -> 40, 69.4 -> 69). */
export function roundMark(mark: MoneyValue): Decimal {
  return toDecimal(mark).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
}

export interface Markable {
  mark: MoneyValue | null;
  isNonSubmission: boolean;
}

/**
 * Fail below 40, Pass from 40, Merit from 60, Distinction from 70, judged on the rounded mark. A non-submission is
 * Fail. A row with no mark that is not a non-submission cannot exist (database check constraint), so it throws.
 */
export function classify({ mark, isNonSubmission }: Markable): Classification {
  if (isNonSubmission) return "FAIL";
  if (mark === null) throw new Error("A mark is required unless the work is a non-submission");
  const rounded = roundMark(mark);
  if (rounded.greaterThanOrEqualTo(70)) return "DISTINCTION";
  if (rounded.greaterThanOrEqualTo(60)) return "MERIT";
  if (rounded.greaterThanOrEqualTo(40)) return "PASS";
  return "FAIL";
}
