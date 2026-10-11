import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { feeSummary } from "@/lib/services/rules/fees";
import type { AgeingBucket, FeeState, FeeSummary } from "@/lib/services/rules/fees";
import { toApiString } from "@/lib/services/rules/money";
import type { DateOnly } from "@/lib/services/rules/types";

// The fee summary in its API form, and a loader that computes it for many students at once. The arithmetic is the
// M04 rule (`feeSummary`, D-028: payments settle the oldest charge first); this file only fetches the rows and
// shapes the result. Nothing is stored (DB-003).

/** What the API sends for a student's fees: money as two-decimal strings, `balance` negative when in credit. */
export interface FeeSummaryDto {
  charged: string;
  waived: string;
  paid: string;
  balance: string;
  /** The credit as a positive amount ("0.00" when the balance is not negative). */
  credit: string;
  overdueAmount: string;
  oldestOverdueDays: number | null;
  ageingBucket: AgeingBucket | null;
  nextDueDate: DateOnly | null;
  feeState: FeeState;
}

export function toFeeSummaryDto(summary: FeeSummary): FeeSummaryDto {
  return {
    charged: toApiString(summary.charged),
    waived: toApiString(summary.waived),
    paid: toApiString(summary.paid),
    balance: toApiString(summary.balance),
    credit: toApiString(summary.credit),
    overdueAmount: toApiString(summary.overdueAmount),
    oldestOverdueDays: summary.oldestOverdueDays,
    ageingBucket: summary.ageingBucket,
    nextDueDate: summary.nextDueDate,
    feeState: summary.feeState,
  };
}

/** Any Prisma client or transaction client. */
type Client = Pick<Prisma.TransactionClient, "feeCharge" | "payment">;

// Keeps `IN (...)` lists well under Postgres' bind-parameter limit when a large set of students is summarised.
const CHUNK_SIZE = 5000;

/**
 * Fee summaries for the given students as of `today` (a Dhaka calendar date). Two queries per chunk, one for charges
 * and one for payments, then the M04 rule per student in memory. Students with no charges get an all-zero summary.
 */
export async function loadFeeSummaries(
  studentIds: readonly string[],
  today: DateOnly,
  client: Client = db,
): Promise<Map<string, FeeSummary>> {
  const charges = new Map<
    string,
    { kind: "PROGRAMME_FEE" | "ADJUSTMENT" | "WAIVER"; amount: Prisma.Decimal; dueDate: Date }[]
  >();
  const payments = new Map<string, { amount: Prisma.Decimal; voidedAt: Date | null }[]>();

  for (let start = 0; start < studentIds.length; start += CHUNK_SIZE) {
    const ids = studentIds.slice(start, start + CHUNK_SIZE);
    const [chargeRows, paymentRows] = await Promise.all([
      client.feeCharge.findMany({
        where: { studentId: { in: ids } },
        select: { studentId: true, kind: true, amount: true, dueDate: true },
      }),
      client.payment.findMany({
        where: { studentId: { in: ids } },
        select: { studentId: true, amount: true, voidedAt: true },
      }),
    ]);
    for (const row of chargeRows) {
      const list = charges.get(row.studentId) ?? [];
      list.push(row);
      charges.set(row.studentId, list);
    }
    for (const row of paymentRows) {
      const list = payments.get(row.studentId) ?? [];
      list.push(row);
      payments.set(row.studentId, list);
    }
  }

  const summaries = new Map<string, FeeSummary>();
  for (const id of studentIds) {
    summaries.set(id, feeSummary(charges.get(id) ?? [], payments.get(id) ?? [], today));
  }
  return summaries;
}
