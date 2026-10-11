import { Decimal, ZERO, sum, toDecimal, type MoneyValue } from "./money";
import { daysBetween, toDateOnly } from "./time";
import type { DateOnly, FeeChargeKind } from "./types";

// Fee summary (db/README.md "Calculated values", DB-003, DB-011, DB-018). Nothing here is stored.
//
//   charged       sum of PROGRAMME_FEE and ADJUSTMENT charges
//   waived        sum of WAIVER charges as a positive figure (waivers are stored negative)
//   paid          sum of payments that are not voided (voided payments are ignored everywhere)
//   balance       charged - waived - paid; negative means the student is in credit
//   overdueAmount charges with a dueDate before today (waivers included), minus paid; never below zero
//
// Allocation rule: payments are applied to the OLDEST due charges first (first in, first out by due date). A charge
// is therefore "unpaid" once the running total of charges, taken in due-date order, exceeds everything paid. The
// oldest overdue age is measured from the due date of the first unpaid charge that is already past due, and the
// next due date is the first unpaid charge due today or later. Charges sharing a due date are settled together.

export const AGEING_BUCKETS = ["1-30", "31-60", "60+"] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];

export type FeeState = "overdue" | "outstanding" | "credit" | "paid";

export interface FeeChargeInput {
  kind: FeeChargeKind;
  /** Negative for a WAIVER (enforced by a database check constraint). */
  amount: MoneyValue;
  /** A calendar date; a `Date` is read in UTC (see `toDateOnly`). */
  dueDate: Date | DateOnly;
}

export interface PaymentInput {
  amount: MoneyValue;
  voidedAt?: Date | null;
}

export interface FeeSummary {
  charged: Decimal;
  waived: Decimal;
  paid: Decimal;
  /** Negative when the student is in credit. */
  balance: Decimal;
  /** The credit as a positive amount (zero when the balance is not negative). */
  credit: Decimal;
  overdueAmount: Decimal;
  /** Whole days since the oldest unpaid overdue charge fell due; `null` when nothing is overdue. */
  oldestOverdueDays: number | null;
  ageingBucket: AgeingBucket | null;
  /** First unpaid charge due today or later; `null` when there is none. */
  nextDueDate: DateOnly | null;
  feeState: FeeState;
}

/** The ageing bucket for days overdue: 1-30, 31-60, or 60+ (61 days and over). `null` below one day. */
export function ageingBucketFor(daysOverdue: number): AgeingBucket | null {
  if (daysOverdue < 1) return null;
  if (daysOverdue <= 30) return "1-30";
  if (daysOverdue <= 60) return "31-60";
  return "60+";
}

/**
 * Computes the fee summary. `today` is the calendar date in the Registry's zone (`todayIn(now)`); a charge due today
 * is not yet overdue.
 */
export function feeSummary(
  charges: readonly FeeChargeInput[],
  payments: readonly PaymentInput[],
  today: DateOnly,
): FeeSummary {
  const dated = charges.map((charge) => ({
    kind: charge.kind,
    amount: toDecimal(charge.amount),
    due: toDateOnly(charge.dueDate),
  }));

  const charged = sum(dated.filter((c) => c.kind !== "WAIVER").map((c) => c.amount));
  const waived = sum(dated.filter((c) => c.kind === "WAIVER").map((c) => c.amount)).negated();
  const paid = sum(payments.filter((p) => !p.voidedAt).map((p) => p.amount));
  const balance = charged.minus(waived).minus(paid);
  const credit = balance.lessThan(0) ? balance.negated() : ZERO;

  // Running total of charges per due date, oldest first (YYYY-MM-DD sorts as text).
  const byDueDate = new Map<DateOnly, Decimal>();
  for (const charge of dated) {
    byDueDate.set(charge.due, (byDueDate.get(charge.due) ?? ZERO).plus(charge.amount));
  }

  let running = ZERO;
  let dueBeforeToday = ZERO;
  let oldestUnpaidOverdue: DateOnly | null = null;
  let nextDueDate: DateOnly | null = null;
  const dueDates = [...byDueDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  for (const [due, amount] of dueDates) {
    running = running.plus(amount);
    const unpaid = running.greaterThan(paid);
    if (due < today) {
      dueBeforeToday = running;
      if (unpaid && oldestUnpaidOverdue === null) oldestUnpaidOverdue = due;
    } else if (unpaid && nextDueDate === null) {
      nextDueDate = due;
    }
  }

  const rawOverdue = dueBeforeToday.minus(paid);
  const overdueAmount = rawOverdue.greaterThan(0) ? rawOverdue : ZERO;
  const oldestOverdueDays =
    overdueAmount.isZero() || oldestUnpaidOverdue === null
      ? null
      : daysBetween(oldestUnpaidOverdue, today);

  return {
    charged,
    waived,
    paid,
    balance,
    credit,
    overdueAmount,
    oldestOverdueDays,
    ageingBucket: oldestOverdueDays === null ? null : ageingBucketFor(oldestOverdueDays),
    nextDueDate,
    feeState: feeStateOf(balance, overdueAmount),
  };
}

function feeStateOf(balance: Decimal, overdueAmount: Decimal): FeeState {
  if (overdueAmount.greaterThan(0)) return "overdue";
  if (balance.lessThan(0)) return "credit";
  if (balance.greaterThan(0)) return "outstanding";
  return "paid";
}
