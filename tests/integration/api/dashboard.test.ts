import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, describe, expect, it } from "vitest";
import { GET as dashboardRoute } from "@/app/api/dashboard/route";
import { db } from "@/lib/db";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { fixedClock } from "@/lib/services/clock";
import {
  ATTENTION_LIST_LIMIT,
  LATE_WINDOW_DAYS,
  OVERDUE_LIST_LIMIT,
  getDashboard,
  type Dashboard,
} from "@/lib/services/dashboard";
import { asStaff, asStudent, call } from "../../support/api";
import {
  createAssessment,
  createFeeCharge,
  createMark,
  createModule,
  createPayment,
  createProgramme,
  createStaff,
  createStudent,
  createSubmission,
} from "../../support/factories";
import { testDatabaseUrl, truncateAll, withClient } from "../../support/test-db";

// Integration tests for the staff dashboard (api.md "Dashboard"): real Postgres, a pinned clock. The seeded demo's own
// figures are asserted in tests/integration/seed/dashboard.test.ts; here small hand-built accounts pin each rule.

type ErrorBody = { error: { code: string } };

const NOW = new Date("2026-10-12T04:00:00Z"); // 10:00 in Dhaka, so today is 2026-10-12
const clock = fixedClock(NOW);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** `YYYY-MM-DD` shifted by whole days from today (2026-10-12). */
function dayOffset(days: number): string {
  return new Date(Date.UTC(2026, 9, 12) + days * DAY).toISOString().slice(0, 10);
}

const ago = (ms: number) => new Date(NOW.getTime() - ms);

async function student(
  status: "ENROLLED" | "DEFERRED" | "WITHDRAWN" | "COMPLETED",
  programmeId: string,
  fullName?: string,
) {
  return createStudent({ programmeId, status, ...(fullName ? { fullName } : {}) });
}

describe("fee figures", () => {
  it("adds up outstanding money, overdue students and the ageing buckets across every enrolment status", async () => {
    const staff = await createStaff();
    const programme = await createProgramme();

    const a = await student("ENROLLED", programme.id);
    await createFeeCharge({ studentId: a.id, amount: "100000.00", dueDate: dayOffset(-10) });

    const b = await student("WITHDRAWN", programme.id);
    await createFeeCharge({ studentId: b.id, amount: "50000.00", dueDate: dayOffset(-45) });
    await createPayment({ studentId: b.id, staffId: staff.id, amount: "20000.00" });

    const c = await student("DEFERRED", programme.id);
    await createFeeCharge({ studentId: c.id, amount: "80000.00", dueDate: dayOffset(-90) });
    await createFeeCharge({ studentId: c.id, amount: "20000.00", dueDate: dayOffset(30) });

    // Owes money but nothing is due yet: outstanding, not overdue.
    const d = await student("COMPLETED", programme.id);
    await createFeeCharge({ studentId: d.id, amount: "70000.00", dueDate: dayOffset(10) });

    // In credit: not netted off the total, not overdue.
    const e = await student("ENROLLED", programme.id);
    await createFeeCharge({ studentId: e.id, amount: "60000.00", dueDate: dayOffset(-5) });
    await createPayment({ studentId: e.id, staffId: staff.id, amount: "70000.00" });

    // Nothing charged: counted as a student, owes nothing.
    await student("ENROLLED", programme.id);

    const dashboard = await getDashboard(clock);

    expect(dashboard.kpis.students).toEqual({
      enrolled: 3,
      deferred: 1,
      withdrawn: 1,
      completed: 1,
    });
    expect(dashboard.kpis.outstanding).toEqual({ amount: "300000.00", students: 4 });
    expect(dashboard.kpis.overdue).toEqual({ students: 3, amount: "210000.00" });
    expect(dashboard.ageing).toEqual([
      { bucket: "1-30", students: 1, amount: "100000.00" },
      { bucket: "31-60", students: 1, amount: "30000.00" },
      { bucket: "60+", students: 1, amount: "80000.00" },
    ]);

    // Longest overdue first; a withdrawn and a deferred student stay on it. Balance is the whole account.
    expect(dashboard.overdue.total).toBe(3);
    expect(
      dashboard.overdue.items.map((i) => [
        i.id,
        i.status,
        i.oldestOverdueDays,
        i.ageingBucket,
        i.overdueAmount,
        i.balance,
      ]),
    ).toEqual([
      [c.id, "DEFERRED", 90, "60+", "80000.00", "100000.00"],
      [b.id, "WITHDRAWN", 45, "31-60", "30000.00", "30000.00"],
      [a.id, "ENROLLED", 10, "1-30", "100000.00", "100000.00"],
    ]);
    expect(dashboard.overdue.items[0]).toMatchObject({
      studentNumber: c.studentNumber,
      fullName: c.fullName,
      programme: { id: programme.id, code: programme.code, name: programme.name },
    });
    expect(dashboard.today).toBe("2026-10-12");
    expect(dashboard.generatedAt).toBe(NOW.toISOString());
  });

  it("judges 'overdue' by the Dhaka calendar day, not the UTC one", async () => {
    const programme = await createProgramme();
    const s = await student("ENROLLED", programme.id);
    await createFeeCharge({ studentId: s.id, amount: "1000.00", dueDate: "2026-10-11" });

    // 23:30 on 10 Oct in UTC is 05:30 on 11 Oct in Dhaka: the charge due on the 11th is due today, not overdue.
    const before = await getDashboard(fixedClock("2026-10-10T23:30:00Z"));
    expect(before.today).toBe("2026-10-11");
    expect(before.kpis.overdue.students).toBe(0);
    // 18:30 UTC on the 11th is 00:30 on the 12th in Dhaka: now it is a day late.
    const after = await getDashboard(fixedClock("2026-10-11T18:30:00Z"));
    expect(after.today).toBe("2026-10-12");
    expect(after.overdue.items.map((i) => i.oldestOverdueDays)).toEqual([1]);
  });

  it("lists at most the longest-overdue few but still counts everyone", async () => {
    const programme = await createProgramme();
    const count = OVERDUE_LIST_LIMIT + 2;
    for (let i = 1; i <= count; i++) {
      const s = await student("ENROLLED", programme.id);
      await createFeeCharge({ studentId: s.id, amount: "1000.00", dueDate: dayOffset(-i) });
    }
    const dashboard = await getDashboard(clock);
    expect(dashboard.kpis.overdue.students).toBe(count);
    expect(dashboard.overdue.total).toBe(count);
    expect(dashboard.overdue.items).toHaveLength(OVERDUE_LIST_LIMIT);
    expect(dashboard.overdue.items.map((i) => i.oldestOverdueDays)).toEqual(
      Array.from({ length: OVERDUE_LIST_LIMIT }, (_, k) => count - k),
    );
  });

  it("breaks ties between equally old debts by the larger amount", async () => {
    const programme = await createProgramme();
    const small = await student("ENROLLED", programme.id);
    const large = await student("ENROLLED", programme.id);
    await createFeeCharge({ studentId: small.id, amount: "1000.00", dueDate: dayOffset(-20) });
    await createFeeCharge({ studentId: large.id, amount: "9000.00", dueDate: dayOffset(-20) });
    const dashboard = await getDashboard(clock);
    expect(dashboard.overdue.items.map((i) => i.id)).toEqual([large.id, small.id]);
  });
});

describe("late submissions", () => {
  it("counts files that arrived after the effective deadline within the last 14 days", async () => {
    const staff = await createStaff();
    const programme = await createProgramme();
    const module = await createModule();
    const deadline = ago(5 * DAY);
    const assessment = await createAssessment({
      moduleId: module.id,
      createdById: staff.id,
      title: "Essay",
      deadline,
    });

    const late = await student("ENROLLED", programme.id, "Late Student");
    const onTime = await student("ENROLLED", programme.id);
    const atDeadline = await student("ENROLLED", programme.id);
    const extended = await student("ENROLLED", programme.id);
    const extendedLate = await student("ENROLLED", programme.id, "Extended But Late");

    await createSubmission({
      assessmentId: assessment.id,
      studentId: late.id,
      submittedAt: new Date(deadline.getTime() + 2 * HOUR),
    });
    await createSubmission({
      assessmentId: assessment.id,
      studentId: onTime.id,
      submittedAt: new Date(deadline.getTime() - HOUR),
    });
    // Arriving at the deadline instant is on time (D-023, M04).
    await createSubmission({
      assessmentId: assessment.id,
      studentId: atDeadline.id,
      submittedAt: deadline,
    });
    // An extension moves this student's deadline (DB-014): submitting after the assessment's deadline is on time...
    await db.extension.create({
      data: {
        assessmentId: assessment.id,
        studentId: extended.id,
        newDeadline: ago(1 * DAY),
        reason: "Illness",
      },
    });
    await createSubmission({
      assessmentId: assessment.id,
      studentId: extended.id,
      submittedAt: ago(2 * DAY),
    });
    // ...and after the extended deadline it is late, measured from the extended deadline, not the original one.
    await db.extension.create({
      data: {
        assessmentId: assessment.id,
        studentId: extendedLate.id,
        newDeadline: ago(3 * DAY),
        reason: "Family emergency",
      },
    });
    await createSubmission({
      assessmentId: assessment.id,
      studentId: extendedLate.id,
      submittedAt: ago(1 * DAY),
    });

    const dashboard = await getDashboard(clock);
    const { lateSubmissions } = dashboard.needsAttention;

    expect(dashboard.kpis.lateSubmissions).toEqual({
      count: 2,
      windowDays: LATE_WINDOW_DAYS,
      since: ago(14 * DAY).toISOString(),
    });
    expect(lateSubmissions.total).toBe(2);
    // Most recent arrival first.
    expect(lateSubmissions.items.map((i) => [i.student.fullName, i.lateBy])).toEqual([
      ["Extended But Late", "2 days"],
      ["Late Student", "2 hours"],
    ]);
    expect(lateSubmissions.items[0]).toMatchObject({
      student: { id: extendedLate.id, studentNumber: extendedLate.studentNumber },
      assessment: { id: assessment.id, title: "Essay", module: { code: module.code } },
      submittedAt: ago(1 * DAY).toISOString(),
      deadline: ago(3 * DAY).toISOString(),
      href: `/staff/assessments/${assessment.id}`,
    });
  });

  it("includes exactly 14 days back and leaves out anything older", async () => {
    const staff = await createStaff();
    const programme = await createProgramme();
    const assessment = await createAssessment({
      moduleId: (await createModule()).id,
      createdById: staff.id,
      deadline: ago(30 * DAY),
    });
    const edge = await student("ENROLLED", programme.id);
    const older = await student("ENROLLED", programme.id);
    await createSubmission({
      assessmentId: assessment.id,
      studentId: edge.id,
      submittedAt: ago(14 * DAY),
    });
    await createSubmission({
      assessmentId: assessment.id,
      studentId: older.id,
      submittedAt: ago(14 * DAY + 1000),
    });
    const dashboard = await getDashboard(clock);
    expect(dashboard.needsAttention.lateSubmissions.items.map((i) => i.student.id)).toEqual([
      edge.id,
    ]);
    expect(dashboard.kpis.lateSubmissions.count).toBe(1);
  });

  it("shows the latest few and keeps counting past the list size", async () => {
    const staff = await createStaff();
    const programme = await createProgramme();
    const assessment = await createAssessment({
      moduleId: (await createModule()).id,
      createdById: staff.id,
      deadline: ago(13 * DAY),
    });
    const total = ATTENTION_LIST_LIMIT + 3;
    for (let i = 1; i <= total; i++) {
      const s = await student("ENROLLED", programme.id);
      await createSubmission({
        assessmentId: assessment.id,
        studentId: s.id,
        submittedAt: ago(i * HOUR * 2),
      });
    }
    const dashboard = await getDashboard(clock);
    expect(dashboard.kpis.lateSubmissions.count).toBe(total);
    expect(dashboard.needsAttention.lateSubmissions.total).toBe(total);
    expect(dashboard.needsAttention.lateSubmissions.items).toHaveLength(ATTENTION_LIST_LIMIT);
    const times = dashboard.needsAttention.lateSubmissions.items.map((i) => i.submittedAt);
    expect(times).toEqual([...times].sort().reverse());
  });
});

describe("results", () => {
  it("counts draft marks per assessment and lists withheld results with their reasons", async () => {
    const staff = await createStaff();
    const programme = await createProgramme();
    const [m1, m2] = [
      await createModule({ code: "AAA101" }),
      await createModule({ code: "BBB101" }),
    ];
    const older = await createAssessment({
      moduleId: m1.id,
      createdById: staff.id,
      title: "Older quiz",
      deadline: ago(20 * DAY),
    });
    const newer = await createAssessment({
      moduleId: m2.id,
      createdById: staff.id,
      title: "Newer quiz",
      deadline: ago(10 * DAY),
    });
    const published = await createAssessment({
      moduleId: m1.id,
      createdById: staff.id,
      deadline: ago(40 * DAY),
    });

    const s = [
      await student("ENROLLED", programme.id),
      await student("ENROLLED", programme.id),
      await student("ENROLLED", programme.id),
    ] as const;
    // Two drafts on the newer assessment, one on the older one, plus marks that are not awaiting publication.
    await createMark({ assessmentId: newer.id, studentId: s[0].id, enteredById: staff.id });
    await createMark({ assessmentId: newer.id, studentId: s[1].id, enteredById: staff.id });
    await createMark({ assessmentId: older.id, studentId: s[0].id, enteredById: staff.id });
    await createMark({
      assessmentId: older.id,
      studentId: s[1].id,
      enteredById: staff.id,
      releaseStatus: "WITHHELD",
      withheldReason: "Outstanding fees",
    });
    await createMark({
      assessmentId: newer.id,
      studentId: s[2].id,
      enteredById: staff.id,
      releaseStatus: "WITHHELD",
      withheldReason: "Academic misconduct investigation",
    });
    await createMark({
      assessmentId: published.id,
      studentId: s[0].id,
      enteredById: staff.id,
      releaseStatus: "PUBLISHED",
    });

    const dashboard = await getDashboard(clock);

    expect(dashboard.kpis.resultsAwaitingPublication).toEqual({
      draftMarks: 3,
      assessments: 2,
      withheldMarks: 2,
    });
    // The assessment that has waited longest is first.
    expect(
      dashboard.needsAttention.draftAssessments.items.map((i) => [
        i.assessment.title,
        i.assessment.module.code,
        i.draftMarks,
        i.href,
      ]),
    ).toEqual([
      ["Older quiz", "AAA101", 1, `/staff/assessments/${older.id}`],
      ["Newer quiz", "BBB101", 2, `/staff/assessments/${newer.id}`],
    ]);
    expect(dashboard.needsAttention.draftAssessments.total).toBe(2);

    const withheld = dashboard.needsAttention.withheldResults;
    expect(withheld.total).toBe(2);
    expect(
      withheld.items
        .map((i) => [i.student.id, i.reason, i.href])
        .sort((a, b) => a[0]!.localeCompare(b[0]!)),
    ).toEqual(
      [
        [s[1].id, "Outstanding fees", `/staff/students/${s[1].id}`],
        [s[2].id, "Academic misconduct investigation", `/staff/students/${s[2].id}`],
      ].sort((a, b) => a[0]!.localeCompare(b[0]!)),
    );
  });
});

describe("an empty registry", () => {
  it("returns zeros, all three buckets and empty lists", async () => {
    const dashboard = await getDashboard(clock);
    expect(dashboard.kpis).toEqual({
      students: { enrolled: 0, deferred: 0, withdrawn: 0, completed: 0 },
      outstanding: { amount: "0.00", students: 0 },
      overdue: { students: 0, amount: "0.00" },
      lateSubmissions: {
        count: 0,
        windowDays: LATE_WINDOW_DAYS,
        since: ago(14 * DAY).toISOString(),
      },
      resultsAwaitingPublication: { draftMarks: 0, assessments: 0, withheldMarks: 0 },
    });
    expect(dashboard.ageing).toEqual([
      { bucket: "1-30", students: 0, amount: "0.00" },
      { bucket: "31-60", students: 0, amount: "0.00" },
      { bucket: "60+", students: 0, amount: "0.00" },
    ]);
    expect(dashboard.overdue).toEqual({ total: 0, items: [] });
    expect(dashboard.needsAttention).toEqual({
      lateSubmissions: { total: 0, items: [] },
      withheldResults: { total: 0, items: [] },
      draftAssessments: { total: 0, items: [] },
    });
  });
});

describe("GET /api/dashboard", () => {
  it("is staff only", async () => {
    const staff = await createStaff();
    const learner = await createStudent();

    const anonymous = await call<ErrorBody>(dashboardRoute, { path: "/api/dashboard" });
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe("UNAUTHENTICATED");

    const asLearner = await call<ErrorBody>(dashboardRoute, {
      path: "/api/dashboard",
      cookie: asStudent(learner.id),
    });
    expect(asLearner.status).toBe(403);
    expect(asLearner.body.error.code).toBe("FORBIDDEN");

    const ok = await call<Dashboard>(dashboardRoute, {
      path: "/api/dashboard",
      cookie: asStaff(staff.id),
    });
    expect(ok.status).toBe(200);
    expect(ok.response.headers.get("cache-control")).toBe("no-store");
    expect(Object.keys(ok.body).sort()).toEqual(
      ["ageing", "generatedAt", "kpis", "needsAttention", "overdue", "today"].sort(),
    );
    expect(ok.body.kpis.students.enrolled).toBe(1);
  });
});

describe("query count", () => {
  // A second client on the same database, logging every statement it sends. The dashboard must cost the same number of
  // statements for 5 students as for 50: no per-student loops.
  const counted = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    log: [{ emit: "event", level: "query" }],
  });
  let statements: string[] = [];
  counted.$on("query", (event) => {
    statements.push(event.query);
  });
  afterAll(() => counted.$disconnect());

  /** Students that exercise every branch of the dashboard: overdue debt, late files, drafts and withheld marks. */
  async function populate(students: number) {
    const staff = await createStaff();
    const programme = await createProgramme();
    const assessment = await createAssessment({
      moduleId: (await createModule()).id,
      createdById: staff.id,
      deadline: ago(3 * DAY),
    });
    for (let i = 0; i < students; i++) {
      const s = await createStudent({
        programmeId: programme.id,
        status: (["ENROLLED", "DEFERRED", "WITHDRAWN", "COMPLETED"] as const)[i % 4]!,
      });
      await createFeeCharge({ studentId: s.id, amount: "10000.00", dueDate: dayOffset(-(i + 1)) });
      if (i % 2 === 0) {
        await createPayment({ studentId: s.id, staffId: staff.id, amount: "2500.00" });
      }
      await createSubmission({
        assessmentId: assessment.id,
        studentId: s.id,
        submittedAt: ago(HOUR * (i % 3)),
      });
      await createMark({
        assessmentId: assessment.id,
        studentId: s.id,
        enteredById: staff.id,
        ...(i % 3 === 0
          ? { releaseStatus: "WITHHELD" as const, withheldReason: "Outstanding fees" }
          : {}),
      });
    }
  }

  async function statementsFor(students: number) {
    await populate(students);
    statements = [];
    const dashboard = await getDashboard(clock, counted);
    expect(dashboard.kpis.overdue.students).toBe(students); // every student owes, so all of them are measured
    return statements.length;
  }

  it("sends the same number of queries for 5 students as for 50", async () => {
    const small = await statementsFor(5);
    // Start over with ten times the students (the harness empties the tables between tests, not inside one).
    await withClient(testDatabaseUrl(), truncateAll);
    const large = await statementsFor(50);

`);
    expect(large).toBe(small);
    expect(small).toBeGreaterThan(5); // it really did count something
    expect(small).toBeLessThanOrEqual(25); // and the budget is small (19 today: relation loads count as statements)
  }, 60_000);
});
