import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, describe, expect, it } from "vitest";
import { GET as listRoute, POST as createRoute } from "@/app/api/assessments/route";
import { GET as detailRoute, PATCH as patchRoute } from "@/app/api/assessments/[id]/route";
import { POST as closeRoute } from "@/app/api/assessments/[id]/close/route";
import { POST as reopenRoute } from "@/app/api/assessments/[id]/reopen/route";
import { GET as submissionsRoute } from "@/app/api/assessments/[id]/submissions/route";
import { db } from "@/lib/db";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { fixedClock } from "@/lib/services/clock";
import {
  closeAssessment,
  listAssessments,
  reopenAssessment,
  type AssessmentDetail,
  type AssessmentList,
  type AssessmentSubmissions,
} from "@/lib/services/assessments";
import { assessmentListQuerySchema } from "@/lib/validation/assessments";
import { asStaff, asStudent, call } from "../../support/api";
import {
  createAssessment,
  createExtension,
  createMark,
  createModule,
  createProgramme,
  createStaff,
  createStudent,
  createSubmission,
  createSubmissionFile,
  linkModule,
} from "../../support/factories";
import { testDatabaseUrl, truncateAll, withClient } from "../../support/test-db";

// Integration tests for the staff side of assessments (api.md "Assessments"): real Postgres, Route Handlers called
// directly. A pinned clock drives the services where "now" matters; the routes use the real clock, so tests that go
// through them pick deadlines far from now.

type ErrorBody = {
  error: { code: string; message: string; details?: Record<string, unknown> };
};
type Warned<T> = T & {
  warnings?: { code: string; message: string; details?: Record<string, unknown> }[];
};

const NOW = new Date("2026-10-12T04:00:00Z"); // 10:00 in Dhaka
const clock = fixedClock(NOW);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

const DEADLINE_ISO = "2026-10-11T17:59:00.000Z"; // 11 Oct 2026, 23:59 in Dhaka

async function staff() {
  return createStaff();
}

/** A module taught in one fresh programme, with a staff member to act as. */
async function setup() {
  const person = await staff();
  const programme = await createProgramme();
  const mod = await createModule();
  await linkModule(programme.id, mod.id);
  return { person, programme, mod, cookie: asStaff(person.id) };
}

function patch(id: string, cookie: string, body: unknown) {
  return call<Warned<AssessmentDetail> & ErrorBody>(patchRoute, {
    method: "PATCH",
    path: `/api/assessments/${id}`,
    params: { id },
    cookie,
    body,
  });
}

function detail(id: string, cookie: string) {
  return call<AssessmentDetail & ErrorBody>(detailRoute, {
    path: `/api/assessments/${id}`,
    params: { id },
    cookie,
  });
}

function rows(id: string, cookie: string) {
  return call<AssessmentSubmissions & ErrorBody>(submissionsRoute, {
    path: `/api/assessments/${id}/submissions`,
    params: { id },
    cookie,
  });
}

// --- Access ---------------------------------------------------------------------------------------------------------

describe("access", () => {
  const endpoints: [string, string, unknown, unknown][] = [
    ["GET", "/api/assessments", listRoute, undefined],
    [
      "POST",
      "/api/assessments",
      createRoute,
      { moduleId: UNKNOWN_ID, title: "x", deadline: DEADLINE_ISO },
    ],
    ["GET", `/api/assessments/${UNKNOWN_ID}`, detailRoute, undefined],
    ["PATCH", `/api/assessments/${UNKNOWN_ID}`, patchRoute, { title: "x", version: 1 }],
    ["POST", `/api/assessments/${UNKNOWN_ID}/close`, closeRoute, undefined],
    ["POST", `/api/assessments/${UNKNOWN_ID}/reopen`, reopenRoute, undefined],
    ["GET", `/api/assessments/${UNKNOWN_ID}/submissions`, submissionsRoute, undefined],
  ];

  it.each(endpoints)(
    "%s %s answers 401 without a session and 403 to a student",
    async (method, path, handler, body) => {
      const student = await createStudent();
      const none = await call<ErrorBody>(handler, {
        method,
        path,
        params: { id: UNKNOWN_ID },
        body,
      });
      expect(none.status).toBe(401);
      expect(none.body.error.code).toBe("UNAUTHENTICATED");

      const asStudentCookie = await call<ErrorBody>(handler, {
        method,
        path,
        params: { id: UNKNOWN_ID },
        cookie: asStudent(student.id),
        body,
      });
      expect(asStudentCookie.status).toBe(403);
      expect(asStudentCookie.body.error.code).toBe("FORBIDDEN");
    },
  );

  it("checks the role before the body: a student sending garbage still gets 403", async () => {
    const student = await createStudent();
    const result = await call<ErrorBody>(createRoute, {
      method: "POST",
      path: "/api/assessments",
      cookie: asStudent(student.id),
      body: { nonsense: true },
    });
    expect(result.status).toBe(403);
  });
});

// --- Create ---------------------------------------------------------------------------------------------------------

describe("create", () => {
  async function create(cookie: string, body: unknown) {
    return call<Warned<AssessmentDetail> & ErrorBody>(createRoute, {
      method: "POST",
      path: "/api/assessments",
      cookie,
      body,
    });
  }

  it("creates an assessment, stores the deadline in UTC and answers the detail with version 1", async () => {
    const { mod, cookie, person } = await setup();
    const deadline = new Date(Date.now() + 3 * DAY).toISOString();
    const result = await create(cookie, { moduleId: mod.id, title: "  Essay   1 ", deadline });

    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      title: "Essay 1",
      module: { id: mod.id, code: mod.code, title: mod.title },
      deadline,
      closedAt: null,
      state: "open",
      version: 1,
      counts: { eligible: 0, submitted: 0, late: 0, marked: 0, published: 0 },
      createdBy: { id: person.id, fullName: person.fullName },
    });
    expect(result.body.warnings).toBeUndefined();
    expect(
      (await db.assessment.findUnique({ where: { id: result.body.id } }))?.deadline.toISOString(),
    ).toBe(deadline);
  });

  it("reads an offset deadline as the same instant in UTC (23:59 Dhaka is 17:59Z)", async () => {
    const { mod, cookie } = await setup();
    const result = await create(cookie, {
      moduleId: mod.id,
      title: "Offset",
      deadline: "2031-10-11T23:59:00+06:00",
    });
    expect(result.status).toBe(201);
    expect(result.body.deadline).toBe("2031-10-11T17:59:00.000Z");
  });

  it("accepts a deadline in the past (back-entry) and warns DEADLINE_IN_PAST", async () => {
    const { mod, cookie } = await setup();
    const result = await create(cookie, {
      moduleId: mod.id,
      title: "Old assessment",
      deadline: "2020-01-15T17:59:00Z",
    });
    expect(result.status).toBe(201);
    expect(result.body.state).toBe("past-deadline");
    expect(result.body.warnings).toEqual([
      { code: "DEADLINE_IN_PAST", message: expect.stringContaining("in the past") },
    ]);
  });

  it("rejects an unknown module, a missing title and a deadline without an offset", async () => {
    const { mod, cookie } = await setup();
    const deadline = DEADLINE_ISO;

    const unknown = await create(cookie, { moduleId: UNKNOWN_ID, title: "x", deadline });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.details).toMatchObject({
      fieldErrors: { moduleId: ["Choose a module."] },
    });

    const malformed = await create(cookie, { moduleId: "not-a-uuid", title: "x", deadline });
    expect(malformed.status).toBe(400);

    const noTitle = await create(cookie, { moduleId: mod.id, title: "   ", deadline });
    expect(noTitle.status).toBe(400);
    expect(noTitle.body.error.details).toMatchObject({
      fieldErrors: { title: ["Enter a title."] },
    });

    const naive = await create(cookie, {
      moduleId: mod.id,
      title: "x",
      deadline: "2026-10-11T23:59:00",
    });
    expect(naive.status).toBe(400);
    expect(naive.body.error.details).toMatchObject({
      fieldErrors: { deadline: expect.any(Array) },
    });

    const absurd = await create(cookie, {
      moduleId: mod.id,
      title: "x",
      deadline: "0026-10-11T23:59:00Z",
    });
    expect(absurd.status).toBe(400);

    expect(await db.assessment.count()).toBe(0);
  });
});

// --- Counts and eligibility ----------------------------------------------------------------------------------------

describe("eligibility and counts", () => {
  /**
   * One assessment (deadline 5 days ago) on a module taught in P1. P2 does not include the module.
   *   s1 Enrolled P1, on time, mark published      s2 Enrolled P1, late, extended to on time, mark draft
   *   s3 Enrolled P1, never submitted, NS mark     s4 Deferred P1, never submitted        (not eligible)
   *   s5 Withdrawn P1, submitted on time           s6 Enrolled P2, never submitted        (not eligible)
   *   s7 Enrolled P2, submitted late               s8 Enrolled P1, submitted late
   */
  async function scenario() {
    const person = await staff();
    const p1 = await createProgramme();
    const p2 = await createProgramme();
    const mod = await createModule();
    await linkModule(p1.id, mod.id);
    const deadline = at(-5 * DAY);
    const assessment = await createAssessment({
      moduleId: mod.id,
      createdById: person.id,
      deadline,
    });

    const s = {
      s1: await createStudent({ programmeId: p1.id, fullName: "Ayesha Rahman" }),
      s2: await createStudent({ programmeId: p1.id, fullName: "Tanvir Hasan" }),
      s3: await createStudent({ programmeId: p1.id, fullName: "Nusrat Jahan" }),
      s4: await createStudent({ programmeId: p1.id, status: "DEFERRED", fullName: "Deferred Dan" }),
      s5: await createStudent({
        programmeId: p1.id,
        status: "WITHDRAWN",
        fullName: "Withdrawn Wendy",
      }),
      s6: await createStudent({ programmeId: p2.id, fullName: "Other Programme" }),
      s7: await createStudent({ programmeId: p2.id, fullName: "Wrong Programme Wade" }),
      s8: await createStudent({ programmeId: p1.id, fullName: "Habib Ullah" }),
    };
    const submit = (studentId: string, submittedAt: Date) =>
      createSubmission({ assessmentId: assessment.id, studentId, submittedAt });
    await submit(s.s1.id, at(-6 * DAY));
    await submit(s.s2.id, at(-4 * DAY)); // after the assessment deadline...
    await createExtension({
      assessmentId: assessment.id,
      studentId: s.s2.id,
      newDeadline: at(-3 * DAY),
    }); // ...but before this
    await submit(s.s5.id, at(-6 * DAY));
    await submit(s.s7.id, at(-1 * DAY));
    await submit(s.s8.id, at(-5 * DAY + 2 * HOUR));

    await createMark({
      assessmentId: assessment.id,
      studentId: s.s1.id,
      enteredById: person.id,
      releaseStatus: "PUBLISHED",
    });
    await createMark({ assessmentId: assessment.id, studentId: s.s2.id, enteredById: person.id });
    await createMark({ assessmentId: assessment.id, studentId: s.s3.id, enteredById: person.id });
    return { person, assessment, cookie: asStaff(person.id), mod, p1, p2, s, deadline };
  }

  it("counts eligible students (enrolled in a programme with the module, plus anyone who submitted), submissions, late, marked and published", async () => {
    const { assessment } = await scenario();
    const list = await listAssessments(assessmentListQuerySchema.parse({}), clock);

    expect(list.total).toBe(1);
    expect(list.items[0]!.counts).toEqual({
      eligible: 6, // s1 s2 s3 s8 enrolled in P1, plus s5 and s7 who submitted
      submitted: 5, // s1 s2 s5 s7 s8
      late: 2, // s7 and s8; s2 is on time under their extension
      marked: 3,
      published: 1,
    });
    expect(list.items[0]).toMatchObject({
      id: assessment.id,
      state: "past-deadline",
      closedAt: null,
    });
  });

  it("the detail and the list agree with the number of rows in the submissions list", async () => {
    const { assessment, cookie } = await scenario();
    const one = await detail(assessment.id, cookie);
    const submissions = await rows(assessment.id, cookie);
    expect(one.status).toBe(200);
    expect(one.body.counts.eligible).toBe(submissions.body.total);
    expect(one.body.counts.submitted).toBe(
      submissions.body.items.filter((r) => r.submission).length,
    );
    expect(one.body.counts.late).toBe(submissions.body.summary.late);
  });

  it("lists every eligible student plus non-eligible submitters, by name, and not a deferred student who did not submit", async () => {
    const { assessment, cookie, s } = await scenario();
    const result = await rows(assessment.id, cookie);

    expect(result.status).toBe(200);
    expect(result.body.items.map((r) => r.student.fullName)).toEqual([
      "Ayesha Rahman",
      "Habib Ullah",
      "Nusrat Jahan",
      "Tanvir Hasan",
      "Withdrawn Wendy",
      "Wrong Programme Wade",
    ]);
    const byId = new Map(result.body.items.map((r) => [r.student.id, r]));
    expect(byId.has(s.s4.id)).toBe(false); // deferred, never submitted
    expect(byId.has(s.s6.id)).toBe(false); // programme does not include the module

    expect(byId.get(s.s1.id)).toMatchObject({ eligible: true, status: "ON_TIME", lateBy: null });
    expect(byId.get(s.s3.id)).toMatchObject({
      eligible: true,
      status: "NOT_SUBMITTED",
      submission: null,
      currentFile: null,
      versions: [],
    });
    // Already submitted, so still listed with the current status, and marked as no longer eligible.
    expect(byId.get(s.s5.id)).toMatchObject({
      eligible: false,
      status: "ON_TIME",
      student: { status: "WITHDRAWN" },
    });
    expect(byId.get(s.s7.id)).toMatchObject({
      eligible: false,
      status: "LATE",
      student: { status: "ENROLLED", programme: { id: expect.any(String) } },
    });
    expect(result.body.summary).toEqual({ onTime: 3, late: 2, notSubmitted: 1 });
    expect(result.body.total).toBe(6);
  });

  it("shows how late a submission is and honours an extension as the effective deadline", async () => {
    const { assessment, cookie, s, deadline } = await scenario();
    const result = await rows(assessment.id, cookie);
    const byId = new Map(result.body.items.map((r) => [r.student.id, r]));

    expect(byId.get(s.s8.id)).toMatchObject({
      status: "LATE",
      lateBy: "2 hours",
      deadline: deadline.toISOString(),
      extension: null,
    });
    expect(byId.get(s.s7.id)).toMatchObject({ status: "LATE", lateBy: "4 days" });
    expect(byId.get(s.s2.id)).toMatchObject({
      status: "ON_TIME",
      lateBy: null,
      deadline: at(-3 * DAY).toISOString(),
      extension: { newDeadline: at(-3 * DAY).toISOString(), reason: "Medical grounds" },
    });
  });

  it("puts versions in version order even when a later version arrived earlier (code review #4)", async () => {
    const { assessment, cookie, s } = await scenario();
    const submission = await db.submission.findFirstOrThrow({
      where: { assessmentId: assessment.id, studentId: s.s1.id },
    });
    await createSubmissionFile({
      submissionId: submission.id,
      version: 1,
      uploadedAt: at(-6 * DAY),
      originalName: "first.pdf",
    });
    await createSubmissionFile({
      submissionId: submission.id,
      version: 2,
      uploadedAt: at(-7 * DAY),
      originalName: "second.pdf",
    });

    const row = (await rows(assessment.id, cookie)).body.items.find(
      (r) => r.student.id === s.s1.id,
    )!;
    expect(row.currentFile?.fileName).toBe("second.pdf");
    expect(row.versions.map((v) => [v.version, v.fileName])).toEqual([
      [2, "second.pdf"],
      [1, "first.pdf"],
    ]);
  });

  it("returns the current file and every version, newest first, with name, size, time and SHA-256", async () => {
    const { assessment, cookie, s } = await scenario();
    const submission = await db.submission.findFirstOrThrow({
      where: { assessmentId: assessment.id, studentId: s.s1.id },
    });
    const v1 = await createSubmissionFile({
      submissionId: submission.id,
      uploadedAt: at(-7 * DAY),
      originalName: "draft.pdf",
      sizeBytes: 111,
      sha256: "1".repeat(64),
    });
    const v2 = await createSubmissionFile({
      submissionId: submission.id,
      uploadedAt: at(-6 * DAY),
      originalName: "পোর্টফোলিও.pdf",
      sizeBytes: 222,
      sha256: "2".repeat(64),
    });

    const row = (await rows(assessment.id, cookie)).body.items.find(
      (r) => r.student.id === s.s1.id,
    )!;
    expect(row.currentFile).toEqual({
      id: v2.id,
      version: 2,
      fileName: "পোর্টফোলিও.pdf",
      mimeType: "application/pdf",
      sizeBytes: 222,
      sha256: "2".repeat(64),
      uploadedAt: at(-6 * DAY).toISOString(),
    });
    expect(row.versions.map((v) => [v.id, v.version, v.fileName])).toEqual([
      [v2.id, 2, "পোর্টফোলিও.pdf"],
      [v1.id, 1, "draft.pdf"],
    ]);
    expect(row.submission).toMatchObject({ id: submission.id });
  });

  it("filters the list by state: open, past-deadline (not closed) and closed", async () => {
    const person = await staff();
    const mod = await createModule();
    const make = (title: string, deadline: Date, closedAt: Date | null = null) =>
      createAssessment({ moduleId: mod.id, createdById: person.id, title, deadline, closedAt });
    await make("Open soon", at(2 * DAY));
    await make("At the instant", at(0)); // arriving exactly at the deadline is still on time: open
    await make("Passed, not closed", at(-1 * DAY));
    await make("Closed early", at(2 * DAY), at(-1 * HOUR));
    await make("Closed late", at(-3 * DAY), at(-2 * DAY));

    const titles = async (state?: "open" | "past-deadline" | "closed") =>
      (await listAssessments(assessmentListQuerySchema.parse(state ? { state } : {}), clock)).items
        .map((i) => i.title)
        .sort();

    expect(await titles("open")).toEqual(["At the instant", "Open soon"]);
    expect(await titles("past-deadline")).toEqual(["Passed, not closed"]);
    expect(await titles("closed")).toEqual(["Closed early", "Closed late"]);
    expect(await titles()).toHaveLength(5);

    const states = new Map(
      (await listAssessments(assessmentListQuerySchema.parse({}), clock)).items.map((i) => [
        i.title,
        i.state,
      ]),
    );
    expect(states.get("Closed early")).toBe("closed"); // closed beats "deadline not reached"
    expect(states.get("Closed late")).toBe("closed");
  });

  it("filters by module, sorts and pages, and rejects bad query values", async () => {
    const { person, cookie } = await setup();
    const m1 = await createModule({ code: "AAA100" });
    const m2 = await createModule({ code: "ZZZ100" });
    await createAssessment({
      moduleId: m1.id,
      createdById: person.id,
      title: "Beta",
      deadline: at(1 * DAY),
    });
    await createAssessment({
      moduleId: m1.id,
      createdById: person.id,
      title: "Alpha",
      deadline: at(3 * DAY),
    });
    await createAssessment({
      moduleId: m2.id,
      createdById: person.id,
      title: "Gamma",
      deadline: at(2 * DAY),
    });

    const get = (query: string) =>
      call<AssessmentList & ErrorBody>(listRoute, { path: `/api/assessments${query}`, cookie });

    expect((await get(`?moduleId=${m1.id}&sort=title`)).body.items.map((i) => i.title)).toEqual([
      "Alpha",
      "Beta",
    ]);
    expect((await get("?sort=-deadline")).body.items.map((i) => i.title)).toEqual([
      "Alpha",
      "Gamma",
      "Beta",
    ]);
    expect((await get("")).body.items.map((i) => i.title)).toEqual(["Alpha", "Gamma", "Beta"]); // newest deadline first
    expect((await get("?sort=deadline")).body.items.map((i) => i.title)).toEqual([
      "Beta",
      "Gamma",
      "Alpha",
    ]);
    expect((await get("?sort=module&pageSize=2")).body.items.map((i) => i.module.code)).toEqual([
      "AAA100",
      "AAA100",
    ]);

    const page2 = await get("?sort=title&pageSize=2&page=2");
    expect(page2.body).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(page2.body.items.map((i) => i.title)).toEqual(["Gamma"]);

    expect((await get("?state=nope")).status).toBe(400);
    expect((await get("?moduleId=abc")).status).toBe(400);
    expect((await get("?sort=students")).status).toBe(400);
    expect((await get("?pageSize=500")).status).toBe(400);
  });

  it("returns 404 for an unknown or malformed assessment id", async () => {
    const { cookie } = await setup();
    for (const id of [UNKNOWN_ID, "not-a-uuid"]) {
      expect((await detail(id, cookie)).status).toBe(404);
      expect((await rows(id, cookie)).status).toBe(404);
    }
  });
});

// --- Query count ------------------------------------------------------------------------------------------------------

describe("query count", () => {
  const counted = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    log: [{ emit: "event", level: "query" }],
  });
  let statements: string[] = [];
  counted.$on("query", (event) => {
    statements.push(event.query);
  });
  afterAll(() => counted.$disconnect());

  async function populate(assessments: number, studentsEach: number) {
    const person = await staff();
    const programme = await createProgramme();
    for (let a = 0; a < assessments; a++) {
      const mod = await createModule();
      await linkModule(programme.id, mod.id);
      const assessment = await createAssessment({
        moduleId: mod.id,
        createdById: person.id,
        deadline: at(-2 * DAY),
      });
      for (let i = 0; i < studentsEach; i++) {
        const student = await createStudent({
          programmeId: programme.id,
          status: i % 3 === 0 ? "WITHDRAWN" : "ENROLLED",
        });
        await createSubmission({
          assessmentId: assessment.id,
          studentId: student.id,
          submittedAt: at(-(i % 4) * DAY),
        });
        await createMark({
          assessmentId: assessment.id,
          studentId: student.id,
          enteredById: person.id,
        });
      }
    }
  }

  async function statementsFor(assessments: number, studentsEach: number) {
    await populate(assessments, studentsEach);
    statements = [];
    const list = await listAssessments(
      assessmentListQuerySchema.parse({ pageSize: 100 }),
      clock,
      counted,
    );
    expect(list.total).toBe(assessments);
    expect(list.items.every((i) => i.counts.submitted === studentsEach)).toBe(true);
    return statements.length;
  }

  it("sends the same number of queries for 2 assessments as for 20", async () => {
    const small = await statementsFor(2, 3);
    await withClient(testDatabaseUrl(), truncateAll);
    const large = await statementsFor(20, 6);

    expect(large).toBe(small);
    expect(small).toBeGreaterThan(3);
    expect(small).toBeLessThanOrEqual(10);
  }, 60_000);
});

// --- Update ---------------------------------------------------------------------------------------------------------

describe("update", () => {
  it("changes the title, bumps the version and answers the new detail", async () => {
    const { person, mod, cookie } = await setup();
    const assessment = await createAssessment({
      moduleId: mod.id,
      createdById: person.id,
      title: "Old",
      deadline: at(2 * DAY),
    });

    const result = await patch(assessment.id, cookie, { title: "  New   title ", version: 1 });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ title: "New title", version: 2 });
    expect(result.body.warnings).toBeUndefined();
  });

  it("leaves the record and its version alone when nothing actually changes", async () => {
    const { person, mod, cookie } = await setup();
    const assessment = await createAssessment({
      moduleId: mod.id,
      createdById: person.id,
      title: "Same",
      deadline: at(2 * DAY),
    });

    const result = await patch(assessment.id, cookie, {
      title: "Same",
      deadline: assessment.deadline.toISOString(),
      moduleId: mod.id,
      version: 1,
    });
    expect(result.status).toBe(200);
    expect(result.body.version).toBe(1);
    expect(result.body.warnings).toBeUndefined();
  });

  it("answers 409 VERSION_CONFLICT with the current version for a stale edit, and changes nothing", async () => {
    const { person, mod, cookie } = await setup();
    const assessment = await createAssessment({
      moduleId: mod.id,
      createdById: person.id,
      title: "Original",
      deadline: at(2 * DAY),
    });

    expect((await patch(assessment.id, cookie, { title: "First save", version: 1 })).status).toBe(
      200,
    );
    const stale = await patch(assessment.id, cookie, { title: "Second save", version: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({
      code: "VERSION_CONFLICT",
      details: { currentVersion: 2 },
    });
    expect((await db.assessment.findUniqueOrThrow({ where: { id: assessment.id } })).title).toBe(
      "First save",
    );
  });

  it("lets exactly one of two simultaneous edits through", async () => {
    const { person, mod, cookie } = await setup();
    const assessment = await createAssessment({
      moduleId: mod.id,
      createdById: person.id,
      deadline: at(2 * DAY),
    });
    const results = await Promise.all([
      patch(assessment.id, cookie, { title: "Left", version: 1 }),
      patch(assessment.id, cookie, { title: "Right", version: 1 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it("requires a version and at least one field, and a real deadline", async () => {
    const { person, mod, cookie } = await setup();
    const assessment = await createAssessment({ moduleId: mod.id, createdById: person.id });

    const noVersion = await patch(assessment.id, cookie, { title: "x" });
    expect(noVersion.status).toBe(400);
    expect(noVersion.body.error.details).toMatchObject({
      fieldErrors: { version: expect.any(Array) },
    });

    const nothing = await patch(assessment.id, cookie, { version: 1 });
    expect(nothing.status).toBe(400);

    const badDeadline = await patch(assessment.id, cookie, { deadline: "tomorrow", version: 1 });
    expect(badDeadline.status).toBe(400);

    expect((await patch(UNKNOWN_ID, cookie, { title: "x", version: 1 })).status).toBe(404);
  });

  describe("deadline change recalculates late flags", () => {
    /** Four submissions around a deadline 1 day ahead of NOW; the fourth student has an extension. */
    async function withSubmissions() {
      const { person, programme, mod, cookie } = await setup();
      const deadline = at(-1 * DAY);
      const assessment = await createAssessment({
        moduleId: mod.id,
        createdById: person.id,
        deadline,
      });
      const make = async (arrival: Date) => {
        const student = await createStudent({ programmeId: programme.id });
        await createSubmission({
          assessmentId: assessment.id,
          studentId: student.id,
          submittedAt: arrival,
        });
        return student;
      };
      const onTime = await make(new Date(deadline.getTime() - 2 * HOUR));
      const lateBy3h = await make(new Date(deadline.getTime() + 3 * HOUR));
      const lateBy2d = await make(new Date(deadline.getTime() + 2 * DAY));
      const extended = await make(new Date(deadline.getTime() + 3 * HOUR));
      await createExtension({
        assessmentId: assessment.id,
        studentId: extended.id,
        newDeadline: new Date(deadline.getTime() + DAY),
      });
      return { assessment, deadline, cookie, onTime, lateBy3h, lateBy2d, extended };
    }

    const status = async (id: string, cookie: string) =>
      new Map((await rows(id, cookie)).body.items.map((r) => [r.student.id, r.status]));

    it("moving the deadline later turns late submissions on time, and reports how many changed", async () => {
      const { assessment, deadline, cookie, onTime, lateBy3h, lateBy2d, extended } =
        await withSubmissions();
      expect((await status(assessment.id, cookie)).get(lateBy3h.id)).toBe("LATE");

      // One day later: the 3-hour-late file becomes on time; the 2-day-late one stays late; the extended student is unmoved.
      const result = await patch(assessment.id, cookie, {
        deadline: new Date(deadline.getTime() + DAY).toISOString(),
        version: 1,
      });
      expect(result.status).toBe(200);
      expect(result.body.version).toBe(2);
      expect(result.body.warnings).toEqual([
        {
          code: "LATE_FLAGS_RECALCULATED",
          message: expect.stringContaining("1 submission changed"),
          details: { changed: 1, submissions: 4 },
        },
      ]);

      const after = await status(assessment.id, cookie);
      expect(after.get(onTime.id)).toBe("ON_TIME");
      expect(after.get(lateBy3h.id)).toBe("ON_TIME");
      expect(after.get(lateBy2d.id)).toBe("LATE");
      expect(after.get(extended.id)).toBe("ON_TIME");
      expect((await detail(assessment.id, cookie)).body.counts.late).toBe(1);
    });

    it("moving the deadline earlier turns on-time submissions late; the count matches the flips", async () => {
      const { assessment, deadline, cookie, onTime, lateBy3h, lateBy2d } = await withSubmissions();
      // Three hours earlier: the on-time file (2 hours before) is now 1 hour late; the 3-hour-late file is 6 hours late.
      const result = await patch(assessment.id, cookie, {
        deadline: new Date(deadline.getTime() - 3 * HOUR).toISOString(),
        version: 1,
      });
      expect(result.body.warnings?.[0]).toMatchObject({
        code: "LATE_FLAGS_RECALCULATED",
        details: { changed: 1 },
      });

      const after = await status(assessment.id, cookie);
      expect(after.get(onTime.id)).toBe("LATE");
      expect(after.get(lateBy3h.id)).toBe("LATE");
      expect(after.get(lateBy2d.id)).toBe("LATE");
      expect(
        (await rows(assessment.id, cookie)).body.items.find((r) => r.student.id === onTime.id)
          ?.lateBy,
      ).toBe("1 hour");
    });

    it("reports zero when the deadline moves but nobody crosses it", async () => {
      const { assessment, deadline, cookie } = await withSubmissions();
      // +10 hours: the two files 3 hours late become on time, but the extended student is not counted, so one flips.
      const first = await patch(assessment.id, cookie, {
        deadline: new Date(deadline.getTime() + 10 * HOUR).toISOString(),
        version: 1,
      });
      expect(first.body.warnings?.[0]?.details).toMatchObject({ changed: 1 });

      // +11 hours: no file arrived between 10 and 11 hours after the old deadline, so nothing changes.
      const second = await patch(assessment.id, cookie, {
        deadline: new Date(deadline.getTime() + 11 * HOUR).toISOString(),
        version: 2,
      });
      expect(second.body.warnings?.[0]).toMatchObject({
        code: "LATE_FLAGS_RECALCULATED",
        details: { changed: 0 },
      });
      expect(second.body.warnings?.[0]?.message).toContain("No submission changed");
    });

    it("adds no warning for an assessment without submissions, or when only the title changes", async () => {
      const { person, mod, cookie } = await setup();
      const empty = await createAssessment({
        moduleId: mod.id,
        createdById: person.id,
        deadline: at(DAY),
      });
      const moved = await patch(empty.id, cookie, {
        deadline: at(5 * DAY).toISOString(),
        version: 1,
      });
      expect(moved.status).toBe(200);
      expect(moved.body.warnings).toBeUndefined();

      const { assessment, cookie: cookie2 } = await withSubmissions();
      const renamed = await patch(assessment.id, cookie2, { title: "Renamed", version: 1 });
      expect(renamed.body.warnings).toBeUndefined();
    });
  });

  describe("changing the module", () => {
    it("is allowed while nobody has submitted", async () => {
      const { person, mod, cookie } = await setup();
      const other = await createModule();
      const assessment = await createAssessment({ moduleId: mod.id, createdById: person.id });
      const result = await patch(assessment.id, cookie, { moduleId: other.id, version: 1 });
      expect(result.status).toBe(200);
      expect(result.body.module.id).toBe(other.id);
      expect(result.body.version).toBe(2);
    });

    it("is refused with 422 ASSESSMENT_HAS_ACTIVITY once someone has submitted, and nothing changes", async () => {
      const { person, programme, mod, cookie } = await setup();
      const other = await createModule();
      const assessment = await createAssessment({
        moduleId: mod.id,
        createdById: person.id,
        title: "Keep",
      });
      const student = await createStudent({ programmeId: programme.id });
      await createSubmission({
        assessmentId: assessment.id,
        studentId: student.id,
        submittedAt: new Date(),
      });

      const result = await patch(assessment.id, cookie, {
        moduleId: other.id,
        title: "Changed too",
        version: 1,
      });
      expect(result.status).toBe(422);
      expect(result.body.error).toMatchObject({
        code: "BUSINESS_RULE",
        details: { rule: "ASSESSMENT_HAS_ACTIVITY", submissions: 1, marks: 0 },
      });
      const stored = await db.assessment.findUniqueOrThrow({ where: { id: assessment.id } });
      expect(stored).toMatchObject({ moduleId: mod.id, title: "Keep", version: 1 });

      // Sending the module it already has is not a change, so it is fine.
      expect(
        (await patch(assessment.id, cookie, { moduleId: mod.id, title: "Renamed", version: 1 }))
          .status,
      ).toBe(200);
    });

    it("rejects a module that does not exist", async () => {
      const { person, mod, cookie } = await setup();
      const assessment = await createAssessment({ moduleId: mod.id, createdById: person.id });
      const result = await patch(assessment.id, cookie, { moduleId: UNKNOWN_ID, version: 1 });
      expect(result.status).toBe(400);
      expect(result.body.error.details).toMatchObject({
        fieldErrors: { moduleId: ["Choose a module."] },
      });
    });
  });

  it("still lets a closed assessment be edited", async () => {
    const { person, mod, cookie } = await setup();
    const assessment = await createAssessment({
      moduleId: mod.id,
      createdById: person.id,
      closedAt: at(-DAY),
    });
    const result = await patch(assessment.id, cookie, { title: "Corrected title", version: 1 });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ title: "Corrected title", state: "closed" });
  });
});

// --- Close and reopen -------------------------------------------------------------------------------------------------

describe("close and reopen", () => {
  const post = (handler: unknown, action: "close" | "reopen", id: string, cookie: string) =>
    call<AssessmentDetail & ErrorBody>(handler, {
      method: "POST",
      path: `/api/assessments/${id}/${action}`,
      params: { id },
      cookie,
    });

  it("closes an open assessment: closedAt is now, the state is closed, the version moves", async () => {
    const { person, mod, cookie } = await setup();
    const assessment = await createAssessment({
      moduleId: mod.id,
      createdById: person.id,
      deadline: at(2 * DAY),
    });

    const before = Date.now();
    const result = await post(closeRoute, "close", assessment.id, cookie);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ state: "closed", version: 2 });
    const closedAt = new Date(result.body.closedAt!).getTime();
    expect(closedAt).toBeGreaterThanOrEqual(before - 1);
    expect(closedAt).toBeLessThanOrEqual(Date.now());
  });

  it("uses the clock for closedAt when called through the service", async () => {
    const { person, mod } = await setup();
    const assessment = await createAssessment({ moduleId: mod.id, createdById: person.id });
    const closed = await closeAssessment(assessment.id, clock);
    expect(closed.closedAt).toBe(NOW.toISOString());
  });

  it("refuses to close twice with 422 ALREADY_CLOSED and keeps the first closing time", async () => {
    const { person, mod, cookie } = await setup();
    const assessment = await createAssessment({ moduleId: mod.id, createdById: person.id });
    const first = await post(closeRoute, "close", assessment.id, cookie);
    const again = await post(closeRoute, "close", assessment.id, cookie);

    expect(again.status).toBe(422);
    expect(again.body.error).toMatchObject({
      code: "BUSINESS_RULE",
      details: { rule: "ALREADY_CLOSED" },
    });
    const stored = await db.assessment.findUniqueOrThrow({ where: { id: assessment.id } });
    expect(stored.closedAt?.toISOString()).toBe(first.body.closedAt);
    expect(stored.version).toBe(2);
  });

  it("lets exactly one of two simultaneous closes succeed", async () => {
    const { person, mod, cookie } = await setup();
    const assessment = await createAssessment({ moduleId: mod.id, createdById: person.id });
    const results = await Promise.all([
      post(closeRoute, "close", assessment.id, cookie),
      post(closeRoute, "close", assessment.id, cookie),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
  });

  it("reopens a closed assessment, and refuses to reopen one that is not closed with 422 NOT_CLOSED", async () => {
    const { person, mod, cookie } = await setup();
    const assessment = await createAssessment({
      moduleId: mod.id,
      createdById: person.id,
      deadline: at(2 * DAY),
      closedAt: at(-HOUR),
    });

    const reopened = await post(reopenRoute, "reopen", assessment.id, cookie);
    expect(reopened.status).toBe(200);
    expect(reopened.body).toMatchObject({ closedAt: null, state: "open", version: 2 });

    const again = await post(reopenRoute, "reopen", assessment.id, cookie);
    expect(again.status).toBe(422);
    expect(again.body.error).toMatchObject({
      code: "BUSINESS_RULE",
      details: { rule: "NOT_CLOSED" },
    });
    expect((await db.assessment.findUniqueOrThrow({ where: { id: assessment.id } })).version).toBe(
      2,
    );
  });

  it("brings back past-deadline (not open) when the deadline has gone by, and closing again works", async () => {
    const { person, mod } = await setup();
    const assessment = await createAssessment({
      moduleId: mod.id,
      createdById: person.id,
      deadline: at(-2 * DAY),
      closedAt: at(-DAY),
    });
    const reopened = await reopenAssessment(assessment.id, clock);
    expect(reopened.state).toBe("past-deadline");
    expect((await closeAssessment(assessment.id, clock)).state).toBe("closed");
  });

  it("returns 404 for an assessment that does not exist, and makes an open edit form stale", async () => {
    const { person, mod, cookie } = await setup();
    expect((await post(closeRoute, "close", UNKNOWN_ID, cookie)).status).toBe(404);
    expect((await post(reopenRoute, "reopen", "not-a-uuid", cookie)).status).toBe(404);

    const assessment = await createAssessment({ moduleId: mod.id, createdById: person.id });
    await post(closeRoute, "close", assessment.id, cookie);
    const stale = await patch(assessment.id, cookie, { title: "From an old form", version: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
  });
});
