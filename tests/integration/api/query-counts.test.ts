import { describe, expect, it } from "vitest";
import { listBalances, getStudentFees } from "@/lib/services/fees";
import { getMarksheet, getStudentResults } from "@/lib/services/marks";
import { listProgrammeDetails } from "@/lib/services/programmes";
import { listStudents } from "@/lib/services/students";
import { getStudentTimeline } from "@/lib/services/timeline";
import { listSubmissions } from "@/lib/services/assessments";
import { getStudentSubmissions, listMyAssessments } from "@/lib/services/submissions";
import { balancesQuerySchema } from "@/lib/validation/fees";
import { studentListQuerySchema } from "@/lib/validation/students";
import { countStatements } from "../../support/query-count";
import { truncateAll, withClient, testDatabaseUrl } from "../../support/test-db";
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
  createSubmissionFile,
  linkModule,
} from "../../support/factories";

// Performance guard (M17): the heaviest pages must cost the same number of SQL statements for a few rows as for many,
// i.e. no query per student, per assessment or per submission. Each case builds a small and then a ten times larger data
// set, runs the page's service call, and compares the statement counts. (The dashboard and assessment list have their own
// guards beside their endpoint tests.)

const DAY = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms);
const dueDaysAgo = (days: number) =>
  ago(days * DAY)
    .toISOString()
    .slice(0, 10);

/** A programme with `assessments` assessments and `students` students, each with fees, a payment, files and marks. */
async function populate(students: number, assessments: number) {
  const staff = await createStaff();
  const programme = await createProgramme();
  // More programmes as the data grows (the Programmes page once ran a count query per programme).
  for (let p = 1; p < Math.floor(students / 10) + 1; p++) await createProgramme();
  const assessmentRows = [];
  for (let a = 0; a < assessments; a++) {
    const mod = await createModule();
    await linkModule(programme.id, mod.id);
    assessmentRows.push(
      await createAssessment({
        moduleId: mod.id,
        createdById: staff.id,
        deadline: ago((a % 3) * DAY - DAY),
      }),
    );
  }
  const people = [];
  for (let i = 0; i < students; i++) {
    const student = await createStudent({
      programmeId: programme.id,
      status: i % 5 === 0 ? "WITHDRAWN" : "ENROLLED",
    });
    people.push(student);
    await createFeeCharge({
      studentId: student.id,
      amount: "10000.00",
      dueDate: dueDaysAgo(i + 1),
    });
    if (i % 2 === 0)
      await createPayment({ studentId: student.id, staffId: staff.id, amount: "2500.00" });
    for (const assessment of assessmentRows) {
      const submission = await createSubmission({
        assessmentId: assessment.id,
        studentId: student.id,
        submittedAt: ago(i * 60 * 60 * 1000),
      });
      await createSubmissionFile({
        submissionId: submission.id,
        uploadedAt: ago(i * 60 * 60 * 1000),
      });
      await createMark({
        assessmentId: assessment.id,
        studentId: student.id,
        enteredById: staff.id,
      });
    }
  }
  return { programme, assessmentRows, people, staff };
}

type Data = Awaited<ReturnType<typeof populate>>;

/** Statement count of `call` against a small data set, then against a ten times larger one. */
async function compare(call: (data: Data) => Promise<unknown>) {
  const measure = async (students: number, assessments: number) => {
    const data = await populate(students, assessments);
    const { statements } = await countStatements(() => call(data));
    return statements.length;
  };
  const small = await measure(3, 2);
  await withClient(testDatabaseUrl(), truncateAll);
  const large = await measure(30, 8);
  return { small, large };
}

describe("heaviest pages: statements do not grow with the data", () => {
  const cases: Array<[string, (data: Data) => Promise<unknown>, number]> = [
    ["student list", () => listStudents(studentListQuerySchema.parse({ pageSize: 100 })), 8],
    [
      "student list filtered by fee state",
      () => listStudents(studentListQuerySchema.parse({ feeState: "overdue", pageSize: 100 })),
      10,
    ],
    ["fees overview", () => listBalances(balancesQuerySchema.parse({ pageSize: 100 })), 10],
    ["assessment submissions tab", (d) => listSubmissions(d.assessmentRows[0]!.id), 8],
    ["marksheet", (d) => getMarksheet(d.assessmentRows[0]!.id), 10],
    ["student record: fees", (d) => getStudentFees(d.people[0]!.id), 6],
    ["student record: results", (d) => getStudentResults(d.people[0]!.id), 8],
    ["student record: submissions", (d) => getStudentSubmissions(d.people[0]!.id), 8],
    ["student record: timeline", (d) => getStudentTimeline(d.people[0]!.id), 19],
    ["student portal: assessments", (d) => listMyAssessments(d.people[0]!.id), 8],
    ["programmes page", () => listProgrammeDetails(), 5],
  ];

  for (const [name, call, budget] of cases) {
    it(`${name}`, async () => {
      const { small, large } = await compare(call);
      expect(small).toBeGreaterThan(0); // it really counted something
      expect(large).toBe(small);
      expect(small).toBeLessThanOrEqual(budget);
    }, 90_000);
  }
});
