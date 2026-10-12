import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/services/clock";
import { getMyOverview, OVERVIEW_ITEMS } from "@/lib/services/me";
import {
  createAssessment,
  createExtension,
  createFeeCharge,
  createMark,
  createModule,
  createProgramme,
  createStaff,
  createStudent,
  linkModule,
} from "../../support/factories";

// The overview page's data (pages.md `/student`): fee position, the next three open deadlines and the latest three
// published results, for one student. Pinned to a fixed clock.

const NOW = new Date("2026-10-12T06:00:00.000Z");
const clock = fixedClock(NOW);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const at = (offset: number) => new Date(NOW.getTime() + offset);

async function setup() {
  const staff = await createStaff();
  const programme = await createProgramme();
  const mod = await createModule();
  await linkModule(programme.id, mod.id);
  const student = await createStudent({ programmeId: programme.id });
  const assess = (title: string, deadline: Date, closedAt: Date | null = null) =>
    createAssessment({ moduleId: mod.id, createdById: staff.id, title, deadline, closedAt });
  return { staff, programme, mod, student, assess };
}

describe("getMyOverview", () => {
  it("returns the profile, the fee position and what the student can do", async () => {
    const { student } = await setup();
    await createFeeCharge({ studentId: student.id, amount: "1000.00", dueDate: "2026-10-01" });

    const overview = await getMyOverview(student.id, clock);
    expect(overview.now).toBe(NOW.toISOString());
    expect(overview.profile.id).toBe(student.id);
    expect(overview.canSubmit.allowed).toBe(true);
    expect(overview.fees.summary.feeState).toBe("overdue");
    expect(overview.fees.overdue?.days).toBe(11);
    expect(overview.fees.now).toBe(overview.now);
  });

  it("lists the next three open deadlines, nearest first, using the student's own deadline", async () => {
    const { student, assess } = await setup();
    await assess("Past, still open for late work", at(-2 * DAY));
    await assess("Closed", at(2 * DAY), at(-HOUR));
    await assess("Fifth", at(9 * DAY));
    await assess("Fourth", at(6 * DAY));
    await assess("Third", at(4 * DAY));
    const second = await assess("Second", at(3 * DAY));
    await assess("First", at(1 * DAY));
    // An extension moves this assessment's deadline for this student only: it becomes the nearest.
    await createExtension({
      assessmentId: second.id,
      studentId: student.id,
      newDeadline: at(5 * HOUR),
    });

    const overview = await getMyOverview(student.id, clock);
    expect(overview.deadlines.map((d) => d.title)).toEqual(["Second", "First", "Third"]);
    expect(overview.deadlines).toHaveLength(OVERVIEW_ITEMS);
    expect(overview.deadlines[0]!.extended).toBe(true);
  });

  it("leaves out assessments that are not in the student's programme", async () => {
    const { student, staff } = await setup();
    const elsewhere = await createModule();
    await createAssessment({
      moduleId: elsewhere.id,
      createdById: staff.id,
      title: "Other programme",
      deadline: at(DAY),
    });
    expect((await getMyOverview(student.id, clock)).deadlines).toEqual([]);
  });

  it("lists the latest three published results, newest publication first, and never a draft or withheld one", async () => {
    const { student, staff, assess } = await setup();
    const marks = [] as {
      title: string;
      status: "DRAFT" | "PUBLISHED" | "WITHHELD";
      days: number;
    }[];
    marks.push(
      { title: "Published oldest", status: "PUBLISHED", days: -9 },
      { title: "Published second", status: "PUBLISHED", days: -5 },
      { title: "Published newest", status: "PUBLISHED", days: -1 },
      { title: "Published third", status: "PUBLISHED", days: -3 },
      { title: "Draft", status: "DRAFT", days: 0 },
      { title: "Withheld", status: "WITHHELD", days: 0 },
    );
    for (const { title, status, days } of marks) {
      const assessment = await assess(title, at(-30 * DAY));
      const mark = await createMark({
        assessmentId: assessment.id,
        studentId: student.id,
        enteredById: staff.id,
        releaseStatus: status,
        withheldReason: status === "WITHHELD" ? "Misconduct review" : undefined,
      });
      if (status === "PUBLISHED") {
        await db.mark.update({ where: { id: mark.id }, data: { publishedAt: at(days * DAY) } });
      }
    }

    const overview = await getMyOverview(student.id, clock);
    expect(overview.latestResults.map((r) => r.assessment.title)).toEqual([
      "Published newest",
      "Published third",
      "Published second",
    ]);
    expect(JSON.stringify(overview)).not.toContain("Misconduct");
  });

  it("is empty for a student with nothing yet", async () => {
    const { student } = await setup();
    const overview = await getMyOverview(student.id, clock);
    expect(overview.deadlines).toEqual([]);
    expect(overview.latestResults).toEqual([]);
    expect(overview.fees.summary.feeState).toBe("paid");
  });

  it.each(["DEFERRED", "WITHDRAWN", "COMPLETED"] as const)(
    "still returns everything for a %s student, with canSubmit off",
    async (status) => {
      const { programme, assess } = await setup();
      await assess("Open", at(DAY));
      const student = await createStudent({ programmeId: programme.id, status });
      const overview = await getMyOverview(student.id, clock);
      expect(overview.profile.status).toBe(status);
      expect(overview.canSubmit).toMatchObject({ allowed: false, reason: "NOT_ENROLLED" });
      expect(overview.deadlines).toHaveLength(1);
    },
  );
});
