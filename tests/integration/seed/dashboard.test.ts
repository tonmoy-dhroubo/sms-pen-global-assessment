import { describe, expect, it } from "vitest";
import { runSeed } from "@/db/seed/run";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/services/clock";
import { getDashboard } from "@/lib/services/dashboard";
import { createStorage } from "@/lib/storage-core";

// The staff dashboard over the seeded demo: every figure must match the "What each dashboard figure should show after
// seeding" table in db/seed-plan.md (milestone M11's acceptance criterion).

const storage = createStorage({
  endpoint: process.env.S3_ENDPOINT!,
  region: process.env.S3_REGION!,
  bucket: process.env.S3_BUCKET!,
  accessKeyId: process.env.S3_ACCESS_KEY_ID!,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  forcePathStyle: true,
});

const SLOW = 120_000;
const SEED_MOMENT = "2026-10-12T04:00:00Z"; // 10:00 in Dhaka

async function seededDashboard() {
  const clock = fixedClock(SEED_MOMENT);
  await runSeed({ prisma: db, storage, clock });
  return getDashboard(clock);
}

describe("dashboard over the seeded demo", () => {
  it(
    "shows the figures the seed plan promises",
    async () => {
      const dashboard = await seededDashboard();

      // Enrolled students: 21 (3 deferred, 3 withdrawn, 3 completed).
      expect(dashboard.kpis.students).toEqual({
        enrolled: 21,
        deferred: 3,
        withdrawn: 3,
        completed: 3,
      });

      // Overdue balances: 8 students, 1-30 days x4, 31-60 x2, 60+ x2 (two of the eight are withdrawn).
      expect(dashboard.kpis.overdue).toEqual({ students: 8, amount: "1115000.00" });
      expect(dashboard.ageing).toEqual([
        { bucket: "1-30", students: 4, amount: "615000.00" },
        { bucket: "31-60", students: 2, amount: "210000.00" },
        { bucket: "60+", students: 2, amount: "290000.00" },
      ]);
      expect(dashboard.overdue.total).toBe(8);
      expect(dashboard.overdue.items).toHaveLength(8);
      const days = dashboard.overdue.items.map((i) => i.oldestOverdueDays);
      expect(days).toEqual([...days].sort((a, b) => b - a));
      const bucketOf = Object.fromEntries(
        dashboard.overdue.items.map((i) => [i.fullName, i.ageingBucket]),
      );
      expect(bucketOf).toEqual({
        "Jannatul Ferdous": "1-30",
        "Mehjabin Sultana": "1-30",
        "Raisa Mahmud": "1-30",
        "Zubair Hasan": "1-30",
        "Tanvir Hasan": "31-60",
        "Mahmud Karim": "31-60",
        "Arif Hossain": "60+",
        "Habib Ullah": "60+",
      });
      expect(dashboard.overdue.items.filter((i) => i.status === "WITHDRAWN")).toHaveLength(2);

      // Total outstanding agrees with a plain SQL sum of what each student was charged minus what they paid (waivers are
      // negative charges, voided payments are ignored), counting only students who owe.
      const [owed] = await db.$queryRaw<{ amount: string; students: bigint }[]>`
        SELECT COALESCE(SUM(owed), 0)::text AS amount, COUNT(*) AS students FROM (
          SELECT COALESCE((SELECT SUM(c.amount) FROM fee_charges c WHERE c.student_id = s.id), 0)
               - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.student_id = s.id AND p.voided_at IS NULL), 0) AS owed
          FROM students s) t
        WHERE owed > 0`;
      expect(dashboard.kpis.outstanding.amount).toBe(Number(owed!.amount).toFixed(2));
      expect(dashboard.kpis.outstanding.students).toBe(Number(owed!.students));
      expect(Number(dashboard.kpis.outstanding.amount)).toBeGreaterThan(1_115_000); // overdue plus what is not yet due
    },
    SLOW,
  );

  it(
    "lists recent late submissions, results awaiting publication and the two withheld results",
    async () => {
      const dashboard = await seededDashboard();
      const { lateSubmissions, withheldResults, draftAssessments } = dashboard.needsAttention;

      // Late submissions in the last 14 days: at least 5 (A3, A4, A9).
      expect(dashboard.kpis.lateSubmissions.count).toBeGreaterThanOrEqual(5);
      expect(lateSubmissions.total).toBe(dashboard.kpis.lateSubmissions.count);
      const late = lateSubmissions.items.map((i) => [i.student.fullName, i.assessment.title]);
      expect(late).toEqual(
        expect.arrayContaining([
          ["Tanvir Hasan", "Essay 1"], // late by 2 days
          ["Tahsin Rahman", "Essay 1"], // late by 2 days
          ["Shakil Ahmed", "Case Study"], // late by 1 hour
          ["Farhana Akter", "Lab Assignment 2"], // late by 5 hours
        ]),
      );
      const lateBy = Object.fromEntries(
        lateSubmissions.items.map((i) => [`${i.student.fullName}|${i.assessment.title}`, i.lateBy]),
      );
      expect(lateBy["Shakil Ahmed|Case Study"]).toBe("1 hour");
      expect(lateBy["Farhana Akter|Lab Assignment 2"]).toBe("5 hours");
      expect(lateBy["Tahsin Rahman|Essay 1"]).toBe("2 days");
      // Most recent first.
      const times = lateSubmissions.items.map((i) => i.submittedAt);
      expect(times).toEqual([...times].sort().reverse());

      // Results awaiting publication: the drafts of A2 (Quiz 1) and A3 (Essay 1) only.
      expect(
        draftAssessments.items.map((i) => [i.assessment.title, i.assessment.module.code]),
      ).toEqual([
        ["Quiz 1", "MAT101"],
        ["Essay 1", "ENG101"],
      ]);
      const draftsInDatabase = await db.mark.count({ where: { releaseStatus: "DRAFT" } });
      expect(dashboard.kpis.resultsAwaitingPublication).toEqual({
        draftMarks: draftsInDatabase,
        assessments: 2,
        withheldMarks: 2,
      });
      expect(draftAssessments.items.map((i) => i.draftMarks)).toEqual([17, 10]);

      // Withheld results: outstanding fees (Tanvir) and an academic misconduct investigation (Arnab).
      expect(withheldResults.total).toBe(2);
      expect(
        withheldResults.items
          .map((i) => [i.student.fullName, i.assessment.title, i.reason])
          .sort(([a], [b]) => String(a).localeCompare(String(b))),
      ).toEqual([
        ["Arnab Saha", "Reading Response", "Academic misconduct investigation"],
        ["Tanvir Hasan", "Essay 1", "Outstanding fees"],
      ]);
    },
    SLOW,
  );
});
