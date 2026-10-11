import { db } from "@/lib/db";
import type { PrismaClient } from "@/lib/generated/prisma/client";
import { systemClock } from "@/lib/services/clock";
import type { Clock } from "@/lib/services/clock";
import { loadFeeSummaries } from "@/lib/services/fee-summary";
import { AGEING_BUCKETS } from "@/lib/services/rules/fees";
import type { AgeingBucket } from "@/lib/services/rules/fees";
import { effectiveDeadline, isLate, lateBy } from "@/lib/services/rules/deadlines";
import { Decimal, ZERO, toApiString } from "@/lib/services/rules/money";
import type { ModuleRef } from "@/lib/services/programmes";
import { todayIn } from "@/lib/services/rules/time";
import type { DateOnly, EnrolmentStatus } from "@/lib/services/rules/types";

// The staff dashboard (api.md "Dashboard", pages.md `/staff`). One read that answers the Registry's morning questions:
// who is enrolled, who owes what and for how long, what arrived late, and which results are waiting.
//
// Nothing here is stored. Fee figures come from the same M04 rule as every other fee screen (`loadFeeSummaries`, D-028),
// "late" is the derived rule from D-023 (the latest file arrived after the student's effective deadline), and "now" is
// the clock's instant with "today" read in Asia/Dhaka. The number of database queries is fixed, whatever the number of
// students: every figure is a batch query or an in-memory pass over rows already loaded (tested in
// tests/integration/api/dashboard.test.ts).

/** How far back "recent" late submissions reach, counted in elapsed time from now. */
export const LATE_WINDOW_DAYS = 14;
/** Most rows shown in the overdue list; `overdue.total` says how many students are overdue altogether. */
export const OVERDUE_LIST_LIMIT = 10;
/** Most rows in each needs-attention list; each list reports its own `total`. */
export const ATTENTION_LIST_LIMIT = 10;

const MS_DAY = 24 * 60 * 60 * 1000;

// --- Shapes ---------------------------------------------------------------------------------------------------------

export interface DashboardAgeingBucket {
  bucket: AgeingBucket;
  /** Students whose oldest overdue charge falls in this bucket. */
  students: number;
  /** Their overdue amounts added together. */
  amount: string;
}

export interface DashboardOverdueItem {
  id: string;
  studentNumber: string;
  fullName: string;
  programme: { id: string; code: string; name: string };
  status: EnrolmentStatus;
  overdueAmount: string;
  /** What the student owes in total (overdue plus anything not yet due); the payment dialog shows it. */
  balance: string;
  oldestOverdueDays: number;
  ageingBucket: AgeingBucket;
}

export interface LateSubmissionItem {
  submissionId: string;
  student: { id: string; studentNumber: string; fullName: string };
  assessment: { id: string; title: string; module: ModuleRef };
  /** When the latest file arrived (ISO). */
  submittedAt: string;
  /** The student's effective deadline (ISO): their extension if they have one, else the assessment's. */
  deadline: string;
  /** How late, in the largest whole unit: "5 hours", "2 days". */
  lateBy: string;
  /** Where to follow it up: the assessment's submissions. */
  href: string;
}

export interface WithheldResultItem {
  markId: string;
  student: { id: string; studentNumber: string; fullName: string };
  assessment: { id: string; title: string; module: ModuleRef };
  /** Why it was withheld; `null` only for a mark withheld without a recorded reason. */
  reason: string | null;
  /** Where to act on it: the student's record (results section). */
  href: string;
}

export interface DraftAssessmentItem {
  assessment: { id: string; title: string; module: ModuleRef; deadline: string };
  draftMarks: number;
  /** Where to publish: the assessment's marksheet. */
  href: string;
}

export interface DashboardAttentionList<T> {
  total: number;
  items: T[];
}

/** `GET /api/dashboard`. */
export interface Dashboard {
  /** The instant the figures were computed for (ISO). */
  generatedAt: string;
  /** Today in Asia/Dhaka, which every "overdue" figure is measured against. */
  today: DateOnly;
  kpis: {
    students: { enrolled: number; deferred: number; withdrawn: number; completed: number };
    /** Money owed by students with a positive balance (overdue and not yet due); credits are not netted off. */
    outstanding: { amount: string; students: number };
    overdue: { students: number; amount: string };
    lateSubmissions: { count: number; windowDays: number; since: string };
    resultsAwaitingPublication: { draftMarks: number; assessments: number; withheldMarks: number };
  };
  /** Always the three buckets in order, zeros included. */
  ageing: DashboardAgeingBucket[];
  overdue: { total: number; items: DashboardOverdueItem[] };
  needsAttention: {
    lateSubmissions: DashboardAttentionList<LateSubmissionItem>;
    withheldResults: DashboardAttentionList<WithheldResultItem>;
    draftAssessments: DashboardAttentionList<DraftAssessmentItem>;
  };
}

// --- Parts ----------------------------------------------------------------------------------------------------------

type Client = Pick<
  PrismaClient,
  "student" | "feeCharge" | "payment" | "submission" | "mark" | "assessment"
>;

const MODULE = { select: { id: true, code: true, title: true } } as const;

/** Student counts by status, one grouped query. */
async function studentCounts(client: Client) {
  const groups = await client.student.groupBy({ by: ["status"], _count: { _all: true } });
  const count = (status: EnrolmentStatus) =>
    groups.find((group) => group.status === status)?._count._all ?? 0;
  return {
    enrolled: count("ENROLLED"),
    deferred: count("DEFERRED"),
    withdrawn: count("WITHDRAWN"),
    completed: count("COMPLETED"),
  };
}

/**
 * Everything that depends on fee summaries: total outstanding, overdue count, the ageing buckets and the longest-overdue
 * list. Three queries to summarise every student with charges or payments (D-032: the rule runs in memory), plus one
 * for the names of the few students shown.
 */
async function feeFigures(client: Client, today: DateOnly) {
  const withAccounts = await client.student.findMany({
    where: { OR: [{ feeCharges: { some: {} } }, { payments: { some: {} } }] },
    select: { id: true },
  });
  const summaries = await loadFeeSummaries(
    withAccounts.map((row) => row.id),
    today,
    client,
  );

  let outstandingAmount = ZERO;
  let outstandingStudents = 0;
  let overdueAmount = ZERO;
  const buckets = new Map<AgeingBucket, { students: number; amount: Decimal }>(
    AGEING_BUCKETS.map((bucket) => [bucket, { students: 0, amount: ZERO }]),
  );
  const overdue: {
    id: string;
    overdueAmount: Decimal;
    balance: Decimal;
    days: number;
    bucket: AgeingBucket;
  }[] = [];

  for (const [id, summary] of summaries) {
    if (summary.balance.greaterThan(0)) {
      outstandingAmount = outstandingAmount.plus(summary.balance);
      outstandingStudents += 1;
    }
    if (summary.feeState !== "overdue") continue;
    // An overdue student always has an age and a bucket (M04 rule); the guard keeps the types honest.
    if (summary.oldestOverdueDays === null || summary.ageingBucket === null) continue;
    overdueAmount = overdueAmount.plus(summary.overdueAmount);
    const bucket = buckets.get(summary.ageingBucket)!;
    bucket.students += 1;
    bucket.amount = bucket.amount.plus(summary.overdueAmount);
    overdue.push({
      id,
      overdueAmount: summary.overdueAmount,
      balance: summary.balance,
      days: summary.oldestOverdueDays,
      bucket: summary.ageingBucket,
    });
  }

  // Longest overdue first; ties by larger amount, then a stable id so the list never shuffles between loads.
  overdue.sort(
    (a, b) =>
      b.days - a.days || b.overdueAmount.comparedTo(a.overdueAmount) || a.id.localeCompare(b.id),
  );
  const shown = overdue.slice(0, OVERDUE_LIST_LIMIT);
  const students = await client.student.findMany({
    where: { id: { in: shown.map((row) => row.id) } },
    select: {
      id: true,
      studentNumber: true,
      fullName: true,
      status: true,
      programme: { select: { id: true, code: true, name: true } },
    },
  });
  const byId = new Map(students.map((student) => [student.id, student]));

  const items = shown.flatMap((row): DashboardOverdueItem[] => {
    const student = byId.get(row.id);
    if (!student) return [];
    return [
      {
        id: student.id,
        studentNumber: student.studentNumber,
        fullName: student.fullName,
        programme: student.programme,
        status: student.status,
        overdueAmount: toApiString(row.overdueAmount),
        balance: toApiString(row.balance),
        oldestOverdueDays: row.days,
        ageingBucket: row.bucket,
      },
    ];
  });

  return {
    outstanding: { amount: toApiString(outstandingAmount), students: outstandingStudents },
    overdue: { students: overdue.length, amount: toApiString(overdueAmount) },
    ageing: AGEING_BUCKETS.map((bucket): DashboardAgeingBucket => ({
      bucket,
      students: buckets.get(bucket)!.students,
      amount: toApiString(buckets.get(bucket)!.amount),
    })),
    overdueList: { total: overdue.length, items },
  };
}

/**
 * Submissions whose latest file arrived in the last `LATE_WINDOW_DAYS` days and after the student's effective deadline
 * (D-023, DB-014): one query, with the student's extensions loaded alongside. Most recent first.
 */
async function recentLateSubmissions(
  client: Client,
  since: Date,
): Promise<DashboardAttentionList<LateSubmissionItem>> {
  const rows = await client.submission.findMany({
    where: { lastSubmittedAt: { gte: since } },
    select: {
      id: true,
      assessmentId: true,
      lastSubmittedAt: true,
      student: {
        select: {
          id: true,
          studentNumber: true,
          fullName: true,
          extensions: { select: { assessmentId: true, newDeadline: true } },
        },
      },
      assessment: { select: { id: true, title: true, deadline: true, module: MODULE } },
    },
  });

  const late = rows.flatMap((row) => {
    const extension = row.student.extensions.find((e) => e.assessmentId === row.assessmentId);
    const deadline = effectiveDeadline(row.assessment.deadline, extension);
    return isLate(row.lastSubmittedAt, deadline) ? [{ row, deadline }] : [];
  });
  late.sort(
    (a, b) =>
      b.row.lastSubmittedAt.getTime() - a.row.lastSubmittedAt.getTime() ||
      a.row.id.localeCompare(b.row.id),
  );

  return {
    total: late.length,
    items: late.slice(0, ATTENTION_LIST_LIMIT).map(({ row, deadline }) => ({
      submissionId: row.id,
      student: {
        id: row.student.id,
        studentNumber: row.student.studentNumber,
        fullName: row.student.fullName,
      },
      assessment: {
        id: row.assessment.id,
        title: row.assessment.title,
        module: row.assessment.module,
      },
      submittedAt: row.lastSubmittedAt.toISOString(),
      deadline: deadline.toISOString(),
      lateBy: lateBy(row.lastSubmittedAt, deadline)!, // late by construction: filtered with `isLate` above
      href: `/staff/assessments/${row.assessment.id}`,
    })),
  };
}

/** Marks that are currently withheld, with the reason staff gave: the count and the most recently changed few. */
async function withheldResults(
  client: Client,
): Promise<DashboardAttentionList<WithheldResultItem>> {
  const where = { releaseStatus: "WITHHELD" } as const;
  const [total, rows] = await Promise.all([
    client.mark.count({ where }),
    client.mark.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: ATTENTION_LIST_LIMIT,
      select: {
        id: true,
        withheldReason: true,
        student: { select: { id: true, studentNumber: true, fullName: true } },
        assessment: { select: { id: true, title: true, module: MODULE } },
      },
    }),
  ]);
  return {
    total,
    items: rows.map((row) => ({
      markId: row.id,
      student: row.student,
      assessment: row.assessment,
      reason: row.withheldReason,
      href: `/staff/students/${row.student.id}`,
    })),
  };
}

/** Marks still in DRAFT, counted per assessment (two queries); the oldest assessment first, as it has waited longest. */
async function draftMarks(client: Client) {
  const groups = await client.mark.groupBy({
    by: ["assessmentId"],
    where: { releaseStatus: "DRAFT" },
    _count: { _all: true },
  });
  const assessments = await client.assessment.findMany({
    where: { id: { in: groups.map((group) => group.assessmentId) } },
    orderBy: [{ deadline: "asc" }, { id: "asc" }],
    select: { id: true, title: true, deadline: true, module: MODULE },
  });
  const counts = new Map(groups.map((group) => [group.assessmentId, group._count._all]));

  const items = assessments.map((assessment): DraftAssessmentItem => ({
    assessment: {
      id: assessment.id,
      title: assessment.title,
      module: assessment.module,
      deadline: assessment.deadline.toISOString(),
    },
    draftMarks: counts.get(assessment.id) ?? 0,
    href: `/staff/assessments/${assessment.id}`,
  }));
  return {
    draftMarks: items.reduce((total, item) => total + item.draftMarks, 0),
    list: { total: items.length, items: items.slice(0, ATTENTION_LIST_LIMIT) },
  };
}

// --- The dashboard --------------------------------------------------------------------------------------------------

/**
 * Everything on the staff dashboard. `now` comes from the clock and "today" is the Dhaka calendar date, so the
 * figures are the same ones the fee screens would show at that moment. `client` lets a test count the queries.
 */
export async function getDashboard(
  clock: Clock = systemClock,
  client: Client = db,
): Promise<Dashboard> {
  const now = clock();
  const today = todayIn(now);
  const since = new Date(now.getTime() - LATE_WINDOW_DAYS * MS_DAY);

  const [students, fees, lateSubmissions, withheld, drafts] = await Promise.all([
    studentCounts(client),
    feeFigures(client, today),
    recentLateSubmissions(client, since),
    withheldResults(client),
    draftMarks(client),
  ]);

  return {
    generatedAt: now.toISOString(),
    today,
    kpis: {
      students,
      outstanding: fees.outstanding,
      overdue: fees.overdue,
      lateSubmissions: {
        count: lateSubmissions.total,
        windowDays: LATE_WINDOW_DAYS,
        since: since.toISOString(),
      },
      resultsAwaitingPublication: {
        draftMarks: drafts.draftMarks,
        assessments: drafts.list.total,
        withheldMarks: withheld.total,
      },
    },
    ageing: fees.ageing,
    overdue: fees.overdueList,
    needsAttention: {
      lateSubmissions,
      withheldResults: withheld,
      draftAssessments: drafts.list,
    },
  };
}
