import Decimal from "decimal.js";

// Money is always an exact decimal, never a float (DB-002). We use `decimal.js` directly: it is the library behind
// Prisma's `Decimal`, it is pure JavaScript, and it keeps these rules free of the generated Prisma client. Values
// read from the database (Prisma `Decimal`) are accepted through the structural `DecimalLike` type.

export { Decimal };

/** Anything with an exact `toFixed()`: decimal.js and Prisma `Decimal` values both qualify. */
export interface DecimalLike {
  toFixed(decimalPlaces?: number): string;
}

export type MoneyValue = string | number | DecimalLike;

export const ZERO = new Decimal(0);

/** Largest amount a `numeric(12,2)` column holds (DB-002). */
export const MAX_MONEY = new Decimal("9999999999.99");

const CURRENCY_SYMBOL = "৳";

/** Converts any accepted value to a `Decimal`. Throws on text that is not a number. */
export function toDecimal(value: MoneyValue): Decimal {
  if (value instanceof Decimal) return value;
  if (typeof value === "string" || typeof value === "number") return new Decimal(value);
  return new Decimal(value.toFixed());
}

export function sum(values: readonly MoneyValue[]): Decimal {
  return values.reduce<Decimal>((total, value) => total.plus(toDecimal(value)), ZERO);
}

/** The API form of an amount: a string with exactly two decimals, e.g. `"160000.00"` (api.md). */
export function toApiString(value: MoneyValue): string {
  return toDecimal(value).toFixed(2, Decimal.ROUND_HALF_UP);
}

/**
 * Groups the integer digits the South Asian way: the last three digits, then pairs (`1,25,00,000`).
 * Built by hand rather than with `Intl` because ICU's `en-BD` does not group in lakhs and its currency format
 * prints `BDT 1,25,000.00` instead of `৳`.
 */
function groupLakh(digits: string): string {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3);
  const tail = digits.slice(-3);
  return `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${tail}`;
}

/** Formats an amount as `৳1,25,000.00`; negative amounts as `-৳1,25,000.00`. */
export function formatBdt(value: MoneyValue): string {
  const fixed = toDecimal(value).toFixed(2, Decimal.ROUND_HALF_UP);
  const negative = fixed.startsWith("-");
  const [whole = "0", fraction = "00"] = (negative ? fixed.slice(1) : fixed).split(".");
  return `${negative ? "-" : ""}${CURRENCY_SYMBOL}${groupLakh(whole)}.${fraction}`;
}

export type ParseMoneyError = "EMPTY" | "INVALID" | "NEGATIVE" | "TOO_MANY_DECIMALS" | "TOO_LARGE";

export type ParseMoneyResult = { ok: true; value: Decimal } | { ok: false; code: ParseMoneyError };

// Plain digits, lakh grouping (1,25,000) or Western grouping (125,000); an optional fraction after the point.
const AMOUNT_PATTERN = /^(\d+|\d{1,2}(,\d{2})*,\d{3}|\d{1,3}(,\d{3})+)(\.\d+)?$/;

/**
 * Parses what a person types into an amount field: `125000`, `1,25,000.50`, `৳1,25,000`, `BDT 5,000`.
 * Accepts only non-negative amounts with at most two decimals that fit `numeric(12,2)`. Zero is parsed (whether it
 * is allowed is up to the caller).
 */
export function parseMoneyInput(text: string): ParseMoneyResult {
  let cleaned = text.trim();
  if (cleaned === "") return { ok: false, code: "EMPTY" };
  const negative = cleaned.startsWith("-");
  if (negative) cleaned = cleaned.slice(1).trim();
  cleaned = cleaned.replace(/^(৳|BDT|Tk\.?)\s*/i, "");
  if (!AMOUNT_PATTERN.test(cleaned)) return { ok: false, code: "INVALID" };
  if (negative) return { ok: false, code: "NEGATIVE" };
  const value = new Decimal(cleaned.replace(/,/g, ""));
  if (value.decimalPlaces() > 2) return { ok: false, code: "TOO_MANY_DECIMALS" };
  if (value.greaterThan(MAX_MONEY)) return { ok: false, code: "TOO_LARGE" };
  return { ok: true, value };
}
