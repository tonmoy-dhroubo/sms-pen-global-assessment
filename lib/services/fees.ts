import { db } from "@/lib/db";
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from "@/lib/api/errors";
import { Prisma } from "@/lib/generated/prisma/client";
import { systemClock } from "@/lib/services/clock";
import type { Clock } from "@/lib/services/clock";
import { loadFeeSummaries, toFeeSummaryDto } from "@/lib/services/fee-summary";
import type { FeeSummaryDto } from "@/lib/services/fee-summary";
import { assertKnownId, dateColumn } from "@/lib/services/ids";
import { Decimal, formatBdt, toApiString } from "@/lib/services/rules/money";
import { formatDate, todayIn, toDateOnly } from "@/lib/services/rules/time";
import type { DateOnly, FeeChargeKind } from "@/lib/services/rules/types";
import { feeSummary, overdueNotice, type FeeSummary } from "@/lib/services/rules/fees";
import {
  FUTURE_PAYMENT_MESSAGE,
  type BalanceSortField,
  type BalancesQuery,
  type CreateChargeInput,
  type PaymentMethodValue,
  type RecordPaymentInput,
  type VoidPaymentInput,
} from "@/lib/validation/fees";

// Fees and payments (api.md "Fees and payments"). Nothing derived is stored (DB-003): the summary is the M04 rule
// (`feeSummary`, payments settle the oldest charge first, D-028) computed from the charge and payment rows every
// time. Money is exact (DB-002). Payments are never edited or deleted, only voided (DB-005).

// --- Shapes ---------------------------------------------------------------------------------------------------------

/** One fee charge. A waiver's `amount` is negative, exactly as stored (DB-022). */
export interface ChargeDto {
  id: string;
  kind: FeeChargeKind;
  academicYear: string;
  description: string;
  amount: string;
  dueDate: DateOnly;
  createdAt: string;
  /** The staff member who added it; `null` for a charge from before this was recorded. */
  createdBy: { id: string; fullName: string } | null;
}

export interface PaymentDto {
  id: string;
  studentId: string;
  amount: string;
  method: PaymentMethodValue;
  paidAt: DateOnly;
  reference: string;
  recordedBy: { id: string; fullName: string };
  recordedAt: string;
  /** Set once the payment has been voided; a voided payment counts toward nothing. */
  voidedAt: string | null;
  /** Who voided it; set exactly when `voidedAt` is. */
  voidedBy: { id: string; fullName: string } | null;
  voidReason: string | null;
}

/** `GET /api/students/{id}/fees`. */
export interface StudentFees {
  summary: FeeSummaryDto;
  charges: ChargeDto[];
  payments: PaymentDto[];
}

/** What a write answers with: the changed row and the student's fee summary after the change. */
export interface ChargeResult {
  charge: ChargeDto;
  summary: FeeSummaryDto;
  warnings: { code: string; message: string }[];
}

export interface VoidResult {
  payment: PaymentDto;
  summary: FeeSummaryDto;
}

export interface PaymentResult extends VoidResult {
  warnings: { code: string; message: string }[];
}

export interface BalanceItem {
  id: string;
  studentNumber: string;
  fullName: string;
  email: string;
  programme: { id: string; code: string; name: string };
  academicYear: string;
  yearOfStudy: number;
  status: "ENROLLED" | "DEFERRED" | "WITHDRAWN" | "COMPLETED";
  feeSummary: FeeSummaryDto;
  /** The most recent payment that has not been voided (by payment date); `null` when there is none. */
  lastPayment: { paidAt: DateOnly; amount: string } | null;
}

export interface BalanceList {
  items: BalanceItem[];
  page: number;
  pageSize: number;
  total: number;
}

// --- Mapping --------------------------------------------------------------------------------------------------------

const PERSON = { select: { id: true, fullName: true } } as const;
const WITH_CREATOR = { createdBy: PERSON } as const;
const WITH_STAFF = { recordedBy: PERSON, voidedBy: PERSON } as const;

type ChargeRow = Prisma.FeeChargeGetPayload<{ include: typeof WITH_CREATOR }>;
type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof WITH_STAFF }>;

function toChargeDto(row: ChargeRow): ChargeDto {
  return {
    id: row.id,
    kind: row.kind,
    academicYear: row.academicYear,
    description: row.description,
    amount: toApiString(row.amount),
    dueDate: toDateOnly(row.dueDate),
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
  };
}

function toPaymentDto(row: PaymentRow): PaymentDto {
  return {
    id: row.id,
    studentId: row.studentId,
    amount: toApiString(row.amount),
    method: row.method,
    paidAt: toDateOnly(row.paidAt),
    reference: row.reference,
    recordedBy: row.recordedBy,
    recordedAt: row.recordedAt.toISOString(),
    voidedAt: row.voidedAt ? row.voidedAt.toISOString() : null,
    voidedBy: row.voidedBy,
    voidReason: row.voidReason,
  };
}

async function requireStudent(id: string) {
  assertKnownId(id, "Student");
  const student = await db.student.findUnique({
    where: { id },
    select: { id: true, academicYear: true },
  });
  if (!student) throw new NotFoundError("Student not found.");
  return student;
}

async function summaryFor(studentId: string, today: DateOnly): Promise<FeeSummary> {
  return (await loadFeeSummaries([studentId], today)).get(studentId)!;
}

// --- Read -----------------------------------------------------------------------------------------------------------

/**
 * A student's fee summary, charges (oldest due date first) and payments (newest first, voided ones included with who
 * recorded them and why they were voided).
 */
export async function getStudentFees(
  studentId: string,
  clock: Clock = systemClock,
): Promise<StudentFees> {
  await requireStudent(studentId);
  const [charges, payments] = await Promise.all([
    db.feeCharge.findMany({
      where: { studentId },
      include: WITH_CREATOR,
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    }),
    db.payment.findMany({
      where: { studentId },
      include: WITH_STAFF,
      orderBy: [{ paidAt: "desc" }, { recordedAt: "desc" }, { id: "asc" }],
    }),
  ]);
  const summary = feeSummary(charges, payments, todayIn(clock()));
  return {
    summary: toFeeSummaryDto(summary),
    charges: charges.map(toChargeDto),
    payments: payments.map(toPaymentDto),
  };
}

// --- The student's own view -----------------------------------------------------------------------------------------

/**
 * The student's fee summary: the staff summary without `ageingBucket`, which is the Registry's own way of grouping
 * debtors and means nothing to the student.
 */
export type MyFeeSummaryDto = Omit<FeeSummaryDto, "ageingBucket">;

/** A charge as the student sees it. No staff names: who added an adjustment or waiver is the Registry's business. */
export interface MyChargeDto {
  id: string;
  kind: FeeChargeKind;
  academicYear: string;
  description: string;
  /** Negative for a waiver, as stored. */
  amount: string;
  dueDate: DateOnly;
}

/** A payment as the student sees it: what they paid, when, how and under which reference. Never voided ones. */
export interface MyPaymentDto {
  id: string;
  amount: string;
  method: PaymentMethodValue;
  paidAt: DateOnly;
  reference: string;
}

/** `GET /api/me/fees`. */
export interface MyFees {
  /** The server's "now" (ISO): the date the summary was worked out for, and the clock for "due in N days". */
  now: string;
  summary: MyFeeSummaryDto;
  charges: MyChargeDto[];
  payments: MyPaymentDto[];
  /** Set exactly when the fee state is `overdue`: the amount, the age, and the sentence to show the student. */
  overdue: { amount: string; days: number; message: string } | null;
}

/**
 * The signed-in student's own fees (api.md "Student self-service"): the summary, every charge (waivers included, as
 * negative amounts) oldest due date first, and the payments that count, newest first. A voided payment is not read at
 * all, so neither it nor its reason nor the staff member who recorded or voided it can reach the student.
 */
export async function getMyFees(studentId: string, clock: Clock = systemClock): Promise<MyFees> {
  await requireStudent(studentId);
  const now = clock();
  const [charges, payments] = await Promise.all([
    db.feeCharge.findMany({
      where: { studentId },
      select: {
        id: true,
        kind: true,
        academicYear: true,
        description: true,
        amount: true,
        dueDate: true,
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    }),
    db.payment.findMany({
      where: { studentId, voidedAt: null },
      select: { id: true, amount: true, method: true, paidAt: true, reference: true },
      orderBy: [{ paidAt: "desc" }, { recordedAt: "desc" }, { id: "asc" }],
    }),
  ]);

  const full = toFeeSummaryDto(feeSummary(charges, payments, todayIn(now)));
  const summary: MyFeeSummaryDto = {
    charged: full.charged,
    waived: full.waived,
    paid: full.paid,
    balance: full.balance,
    credit: full.credit,
    overdueAmount: full.overdueAmount,
    oldestOverdueDays: full.oldestOverdueDays,
    nextDueDate: full.nextDueDate,
    feeState: full.feeState,
  };
  return {
    now: now.toISOString(),
    summary,
    charges: charges.map((row) => ({
      id: row.id,
      kind: row.kind,
      academicYear: row.academicYear,
      description: row.description,
      amount: toApiString(row.amount),
      dueDate: toDateOnly(row.dueDate),
    })),
    payments: payments.map((row) => ({
      id: row.id,
      amount: toApiString(row.amount),
      method: row.method,
      paidAt: toDateOnly(row.paidAt),
      reference: row.reference,
    })),
    overdue:
      summary.feeState === "overdue" && summary.oldestOverdueDays !== null
        ? {
            amount: summary.overdueAmount,
            days: summary.oldestOverdueDays,
            message: overdueNotice(summary.oldestOverdueDays),
          }
        : null,
  };
}

// --- Adjustments and waivers ----------------------------------------------------------------------------------------

/** The warning for a waiver larger than what the student currently owes: the rest becomes a credit. */
function waiverMessage(amount: Decimal, balance: Decimal): string {
  return balance.greaterThan(0)
    ? `This waiver is ${formatBdt(amount.minus(balance))} more than the balance of ${formatBdt(balance)}. The difference will show as credit.`
    : `The student owes nothing at the moment, so this waiver of ${formatBdt(amount)} will show as credit.`;
}

/**
 * Adds an adjustment (more owed) or a waiver (less owed) to a student's account, recorded against `actorId`. Both are
 * entered as a positive amount; a waiver is stored negative (DB-022). The charge belongs to the student's current
 * session. It is allowed for a student of any status: a withdrawn student's account can still be corrected. A waiver
 * larger than the current balance is allowed, with a `WAIVER_EXCEEDS_BALANCE` warning.
 */
export async function addCharge(
  studentId: string,
  input: CreateChargeInput,
  actorId: string,
  clock: Clock = systemClock,
): Promise<ChargeResult> {
  const student = await requireStudent(studentId);
  const today = todayIn(clock());
  const amount = new Decimal(input.amount);
  const before = input.kind === "WAIVER" ? await summaryFor(studentId, today) : null;

  const row = await db.feeCharge.create({
    data: {
      studentId,
      kind: input.kind,
      academicYear: student.academicYear,
      description: input.description,
      amount: (input.kind === "WAIVER" ? amount.negated() : amount).toFixed(2),
      dueDate: dateColumn(input.dueDate),
      createdById: actorId,
    },
    include: WITH_CREATOR,
  });
  const warnings =
    before && amount.greaterThan(before.balance)
      ? [{ code: "WAIVER_EXCEEDS_BALANCE", message: waiverMessage(amount, before.balance) }]
      : [];
  return {
    charge: toChargeDto(row),
    summary: toFeeSummaryDto(await summaryFor(studentId, today)),
    warnings,
  };
}

// --- Payments -------------------------------------------------------------------------------------------------------

function isReferenceClash(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002")
    return false;
  return JSON.stringify(error.meta?.target ?? error.message).includes("reference");
}

/** The payment already using a reference, as a 409 pointing at it (api.md "Errors"), or `null` when it is free. */
async function referenceConflict(reference: string): Promise<ConflictError | null> {
  // Only payments that are not voided hold their reference: a voided one frees it (DB-024).
  const existing = await db.payment.findFirst({
    where: { reference, voidedAt: null },
    include: { student: { select: { id: true, studentNumber: true, fullName: true } } },
  });
  if (!existing) return null;

  const summary = `${formatBdt(existing.amount)} on ${formatDate(toDateOnly(existing.paidAt))} for ${existing.student.fullName} (${existing.student.studentNumber})`;
  const message = `A payment with the reference ${reference} is already recorded: ${summary}.`;
  return new ConflictError(message, {
    field: "reference",
    existing: {
      id: existing.id,
      reference: existing.reference,
      student: existing.student,
      amount: toApiString(existing.amount),
      paidAt: toDateOnly(existing.paidAt),
    },
  });
}

/** The overpayment warning text for a payment that exceeds the balance owed. */
function overpaymentMessage(amount: Decimal, balance: Decimal): string {
  if (balance.greaterThan(0)) {
    return `This payment is ${formatBdt(amount.minus(balance))} more than the balance of ${formatBdt(balance)}. The difference will show as credit.`;
  }
  const alreadyInCredit = balance.lessThan(0);
  return alreadyInCredit
    ? `The student is already ${formatBdt(balance.negated())} in credit. This payment of ${formatBdt(amount)} will increase the credit.`
    : `The student owes nothing at the moment. This payment of ${formatBdt(amount)} will show as credit.`;
}

/**
 * Records a payment. The reference is unique among payments that are not voided (a clash is a 409 whose
 * `details.existing` points at the payment that has it, whether or not two requests race: the partial unique index
 * decides; a voided payment frees its reference), the date may be today or
 * earlier in Dhaka but not later, and a payment larger than the current balance succeeds with an `OVERPAYMENT`
 * warning. `actorId` is the staff member recording it.
 */
export async function recordPayment(
  studentId: string,
  input: RecordPaymentInput,
  actorId: string,
  clock: Clock = systemClock,
): Promise<PaymentResult> {
  await requireStudent(studentId);
  const today = todayIn(clock());
  if (input.paidAt > today) throw ValidationError.field("paidAt", FUTURE_PAYMENT_MESSAGE);

  const clash = await referenceConflict(input.reference);
  if (clash) throw clash;

  const before = await summaryFor(studentId, today);
  const amount = new Decimal(input.amount);

  let row: PaymentRow;
  try {
    row = await db.payment.create({
      data: {
        studentId,
        amount: amount.toFixed(2),
        method: input.method,
        paidAt: dateColumn(input.paidAt),
        reference: input.reference,
        recordedById: actorId,
      },
      include: WITH_STAFF,
    });
  } catch (error) {
    // Two identical submissions (a double click) both pass the check above; the unique index lets only one in.
    if (isReferenceClash(error)) {
      const raced = await referenceConflict(input.reference);
      if (raced) throw raced;
    }
    throw error;
  }

  const warnings = amount.greaterThan(before.balance)
    ? [{ code: "OVERPAYMENT", message: overpaymentMessage(amount, before.balance) }]
    : [];
  return {
    payment: toPaymentDto(row),
    summary: toFeeSummaryDto(await summaryFor(studentId, today)),
    warnings,
  };
}

/**
 * Voids a payment with a reason, recorded against `actorId`. The row stays (DB-005) but counts toward nothing from now on. Voiding a payment that
 * is already voided is a 422; the conditional update means two simultaneous voids cannot both succeed.
 */
export async function voidPayment(
  paymentId: string,
  input: VoidPaymentInput,
  actorId: string,
  clock: Clock = systemClock,
): Promise<VoidResult> {
  assertKnownId(paymentId, "Payment");
  const found = await db.payment.findUnique({
    where: { id: paymentId },
    select: { studentId: true },
  });
  if (!found) throw new NotFoundError("Payment not found.");

  const updated = await db.payment.updateMany({
    where: { id: paymentId, voidedAt: null },
    data: { voidedAt: clock(), voidedById: actorId, voidReason: input.reason },
  });
  if (updated.count === 0) {
    throw new BusinessRuleError("PAYMENT_ALREADY_VOIDED", "This payment has already been voided.");
  }

  const row = await db.payment.findUniqueOrThrow({
    where: { id: paymentId },
    include: WITH_STAFF,
  });
  return {
    payment: toPaymentDto(row),
    summary: toFeeSummaryDto(await summaryFor(found.studentId, todayIn(clock()))),
  };
}

// --- Balances list --------------------------------------------------------------------------------------------------

type Direction = "asc" | "desc";

/** Orders by a number that may be missing; a missing value always sorts last, whichever way the list is sorted. */
function compareNullable(a: number | null, b: number | null, direction: Direction): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return direction === "asc" ? a - b : b - a;
}

/**
 * Students who owe money or hold credit (every fee state except "paid"), whatever their enrolment status: a
 * withdrawn student who still owes stays on the list. Filters by fee state, ageing bucket and programme.
 *
 * Same approach as the student list's fee-state filter (D-032): SQL picks the candidate students in name order, the
 * M04 rule summarises their charges and payments in memory (two queries), and the filtering, sorting and paging
 * happen on those summaries, so the list, the filters and the student record share one definition of "overdue".
 * Meant for hundreds to a few thousand students.
 */
export async function listBalances(
  query: BalancesQuery,
  clock: Clock = systemClock,
): Promise<BalanceList> {
  const today = todayIn(clock());
  const { page, pageSize } = query;

  const programme = query.programmeId
    ? Prisma.sql`AND s.programme_id = ${query.programmeId}::uuid`
    : Prisma.empty;
  const candidates = await db.$queryRaw<{ id: string }[]>`
    SELECT s.id::text AS id FROM students s
    WHERE (EXISTS (SELECT 1 FROM fee_charges c WHERE c.student_id = s.id)
        OR EXISTS (SELECT 1 FROM payments p WHERE p.student_id = s.id))
      ${programme}
    ORDER BY immutable_unaccent(lower(s.full_name)) ASC, s.student_number ASC, s.id ASC`;

  const summaries = await loadFeeSummaries(
    candidates.map((row) => row.id),
    today,
  );
  let ids = candidates
    .map((row) => row.id)
    .filter((id) => {
      const summary = summaries.get(id)!;
      if (summary.feeState === "paid") return false;
      if (query.feeState && summary.feeState !== query.feeState) return false;
      if (query.ageingBucket && summary.ageingBucket !== query.ageingBucket) return false;
      return true;
    });

  // The array is in name order, and a sort is stable, so equal values stay in name order.
  const sort = query.sort ?? {
    field: "oldestOverdueDays" as BalanceSortField,
    direction: "desc" as Direction,
  };
  if (sort.field === "fullName") {
    if (sort.direction === "desc") ids = ids.reverse();
  } else if (sort.field === "overdueAmount") {
    ids = [...ids].sort((a, b) => {
      const diff = summaries.get(a)!.overdueAmount.comparedTo(summaries.get(b)!.overdueAmount);
      return sort.direction === "asc" ? diff : -diff;
    });
  } else {
    ids = [...ids].sort((a, b) =>
      compareNullable(
        summaries.get(a)!.oldestOverdueDays,
        summaries.get(b)!.oldestOverdueDays,
        sort.direction,
      ),
    );
  }

  const total = ids.length;
  const pageIds = ids.slice((page - 1) * pageSize, page * pageSize);

  const [students, payments] = await Promise.all([
    db.student.findMany({
      where: { id: { in: pageIds } },
      include: { programme: { select: { id: true, code: true, name: true } } },
    }),
    db.payment.findMany({
      where: { studentId: { in: pageIds }, voidedAt: null },
      orderBy: [{ paidAt: "desc" }, { recordedAt: "desc" }],
      distinct: ["studentId"],
      select: { studentId: true, paidAt: true, amount: true },
    }),
  ]);
  const byId = new Map(students.map((student) => [student.id, student]));
  const lastPayment = new Map(payments.map((payment) => [payment.studentId, payment]));

  const items = pageIds.flatMap((id): BalanceItem[] => {
    const student = byId.get(id);
    if (!student) return [];
    const last = lastPayment.get(id);
    return [
      {
        id: student.id,
        studentNumber: student.studentNumber,
        fullName: student.fullName,
        email: student.email,
        programme: student.programme,
        academicYear: student.academicYear,
        yearOfStudy: student.yearOfStudy,
        status: student.status,
        feeSummary: toFeeSummaryDto(summaries.get(id)!),
        lastPayment: last
          ? { paidAt: toDateOnly(last.paidAt), amount: toApiString(last.amount) }
          : null,
      },
    ];
  });

  return { items, page, pageSize, total };
}
