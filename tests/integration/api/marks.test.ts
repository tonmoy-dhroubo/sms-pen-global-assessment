import { describe, expect, it } from "vitest";
import { PATCH as patchAssessmentRoute } from "@/app/api/assessments/[id]/route";
import { GET as marksheetRoute } from "@/app/api/assessments/[id]/marks/route";
import { PUT as putMarkRoute } from "@/app/api/assessments/[id]/marks/[studentId]/route";
import { POST as publishRoute } from "@/app/api/marks/publish/route";
import { POST as unpublishRoute } from "@/app/api/marks/unpublish/route";
import { POST as withholdRoute } from "@/app/api/marks/withhold/route";
import { GET as myResultsRoute } from "@/app/api/me/results/route";
import { GET as studentResultsRoute } from "@/app/api/students/[id]/results/route";
import { db } from "@/lib/db";
import type {
  Marksheet,
  MarkDto,
  MyResults,
  PublishResult,
  ReleaseChangeResult,
  StudentResults,
} from "@/lib/services/marks";
import { asStaff, asStudent, call } from "../../support/api";
import {
  createAssessment,
  createFeeCharge,
  createExtension,
  createMark,
  createModule,
  createPayment,
  createProgramme,
  createStaff,
  createStudent,
  createSubmission,
  linkModule,
} from "../../support/factories";

// Integration tests for marks and results (api.md "Marks and results", "Student self-service"): real Postgres, Route
// Handlers called directly. Covers the boundary marks, non-submissions, reasons on published changes, version conflicts,
// the publish preview and its warnings, withhold and unpublish, the history rows (DB-023) and what a student can see.

type ErrorBody = {
  error: { code: string; message: string; details?: Record<string, unknown> };
};
type Warned<T> = T & {
  warnings?: { code: string; message: string; details?: Record<string, unknown> }[];
};

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** A module in one fresh programme, an assessment of it, and a staff member to act as. */
async function setup() {
  const person = await createStaff();
  const programme = await createProgramme();
  const mod = await createModule();
  await linkModule(programme.id, mod.id);
  const assessment = await createAssessment({
    moduleId: mod.id,
    createdById: person.id,
    deadline: new Date(Date.now() - 10 * DAY),
  });
  return { person, programme, mod, assessment, cookie: asStaff(person.id) };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

async function enrolled(
  ctx: Pick<Ctx, "programme">,
  overrides: Parameters<typeof createStudent>[0] = {},
) {
  return createStudent({ programmeId: ctx.programme.id, ...overrides });
}

function put(ctx: Ctx, studentId: string, body: unknown, assessmentId = ctx.assessment.id) {
  return call<MarkDto & ErrorBody>(putMarkRoute, {
    method: "PUT",
    path: `/api/assessments/${assessmentId}/marks/${studentId}`,
    params: { id: assessmentId, studentId },
    cookie: ctx.cookie,
    body,
  });
}

function sheet(ctx: Ctx, assessmentId = ctx.assessment.id) {
  return call<Marksheet & ErrorBody>(marksheetRoute, {
    path: `/api/assessments/${assessmentId}/marks`,
    params: { id: assessmentId },
    cookie: ctx.cookie,
  });
}

function publish(ctx: Ctx, body: unknown) {
  return call<Warned<PublishResult> & ErrorBody>(publishRoute, {
    method: "POST",
    path: "/api/marks/publish",
    cookie: ctx.cookie,
    body,
  });
}

function withhold(ctx: Ctx, body: unknown) {
  return call<ReleaseChangeResult & ErrorBody>(withholdRoute, {
    method: "POST",
    path: "/api/marks/withhold",
    cookie: ctx.cookie,
    body,
  });
}

function unpublish(ctx: Ctx, body: unknown) {
  return call<ReleaseChangeResult & ErrorBody>(unpublishRoute, {
    method: "POST",
    path: "/api/marks/unpublish",
    cookie: ctx.cookie,
    body,
  });
}

function results(ctx: Ctx, studentId: string) {
  return call<StudentResults & ErrorBody>(studentResultsRoute, {
    path: `/api/students/${studentId}/results`,
    params: { id: studentId },
    cookie: ctx.cookie,
  });
}

const changesOf = (markId: string) =>
  db.markChange.findMany({ where: { markId }, orderBy: [{ changedAt: "asc" }, { id: "asc" }] });

// --- Access ---------------------------------------------------------------------------------------------------------

describe("access", () => {
  const endpoints: [string, string, unknown, unknown][] = [
    ["GET", `/api/assessments/${UNKNOWN_ID}/marks`, marksheetRoute, undefined],
    ["PUT", `/api/assessments/${UNKNOWN_ID}/marks/${UNKNOWN_ID}`, putMarkRoute, { mark: "50" }],
    ["POST", "/api/marks/publish", publishRoute, { assessmentId: UNKNOWN_ID }],
    ["POST", "/api/marks/withhold", withholdRoute, { markIds: [UNKNOWN_ID], reason: "x" }],
    ["POST", "/api/marks/unpublish", unpublishRoute, { markIds: [UNKNOWN_ID], reason: "x" }],
    ["GET", `/api/students/${UNKNOWN_ID}/results`, studentResultsRoute, undefined],
  ];

  it.each(endpoints)(
    "%s %s answers 401 without a session and 403 to a student",
    async (method, path, handler, body) => {
      const student = await createStudent();
      const none = await call<ErrorBody>(handler, {
        method,
        path,
        params: { id: UNKNOWN_ID, studentId: UNKNOWN_ID },
        body,
      });
      expect(none.status).toBe(401);
      expect(none.body.error.code).toBe("UNAUTHENTICATED");

      const asStudentCookie = await call<ErrorBody>(handler, {
        method,
        path,
        params: { id: UNKNOWN_ID, studentId: UNKNOWN_ID },
        cookie: asStudent(student.id),
        body,
      });
      expect(asStudentCookie.status).toBe(403);
      expect(asStudentCookie.body.error.code).toBe("FORBIDDEN");
    },
  );

  it("GET /api/me/results answers 401 without a session and 403 to staff", async () => {
    const person = await createStaff();
    const none = await call<ErrorBody>(myResultsRoute, { path: "/api/me/results" });
    expect(none.status).toBe(401);
    const staff = await call<ErrorBody>(myResultsRoute, {
      path: "/api/me/results",
      cookie: asStaff(person.id),
    });
    expect(staff.status).toBe(403);
    expect(staff.body.error.code).toBe("FORBIDDEN");
  });

  it("checks the role before the body: a student sending garbage to publish still gets 403", async () => {
    const student = await createStudent();
    const result = await call<ErrorBody>(publishRoute, {
      method: "POST",
      path: "/api/marks/publish",
      cookie: asStudent(student.id),
      body: { nonsense: true },
    });
    expect(result.status).toBe(403);
  });
});

// --- Entering marks -------------------------------------------------------------------------------------------------

describe("entering a mark", () => {
  it.each([
    ["0", "0.0", "FAIL"],
    ["39.4", "39.4", "FAIL"],
    ["39.5", "39.5", "PASS"],
    ["40", "40.0", "PASS"],
    ["59.4", "59.4", "PASS"],
    ["59.5", "59.5", "MERIT"],
    ["60", "60.0", "MERIT"],
    ["69.4", "69.4", "MERIT"],
    ["69.5", "69.5", "DISTINCTION"],
    ["70", "70.0", "DISTINCTION"],
    ["100", "100.0", "DISTINCTION"],
  ])(
    "accepts %s, stores %s and classifies it %s (half-up rounding, DB-019)",
    async (typed, stored, expected) => {
      const ctx = await setup();
      const student = await enrolled(ctx);
      const result = await put(ctx, student.id, { mark: typed });
      expect(result.status).toBe(201);
      expect(result.body).toMatchObject({
        mark: stored,
        classification: expected,
        isNonSubmission: false,
      });

      // The marksheet agrees, and the stored value is never rounded.
      const row = (await sheet(ctx)).body.items.find((r) => r.student.id === student.id)!;
      expect(row).toMatchObject({ mark: stored, classification: expected });
      const dbRow = await db.mark.findFirstOrThrow({ where: { studentId: student.id } });
      expect(dbRow.mark?.toFixed(1)).toBe(stored);
    },
  );

  it.each([
    ["100.1", "between 0 and 100"],
    ["-1", "between 0 and 100"],
    ["40.25", "one decimal place"],
    ["abc", "number"],
    ["", "number"],
    ["1e2", "number"],
  ])("rejects %j with a 400 on the mark field", async (typed) => {
    const ctx = await setup();
    const student = await enrolled(ctx);
    const result = await put(ctx, student.id, { mark: typed });
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(result.body.error.details).toMatchObject({
      fieldErrors: { mark: [expect.any(String)] },
    });
    expect(await db.mark.count()).toBe(0);
  });

  it("accepts a JSON number and trailing zeros", async () => {
    const ctx = await setup();
    const [a, b] = [await enrolled(ctx), await enrolled(ctx)];
    expect((await put(ctx, a.id, { mark: 67.5 })).body.mark).toBe("67.5");
    expect((await put(ctx, b.id, { mark: "67.50" })).body.mark).toBe("67.5");
  });

  it("needs exactly one of a mark or a non-submission", async () => {
    const ctx = await setup();
    const student = await enrolled(ctx);
    for (const body of [{}, { isNonSubmission: false }, { mark: "50", isNonSubmission: true }]) {
      const result = await put(ctx, student.id, body);
      expect(result.status).toBe(400);
      expect(result.body.error.details).toMatchObject({
        fieldErrors: { mark: [expect.any(String)] },
      });
    }
    expect(await db.mark.count()).toBe(0);
  });

  it("records a non-submission as NS: a null mark, classified Fail, never a silent 0", async () => {
    const ctx = await setup();
    const student = await enrolled(ctx);
    const result = await put(ctx, student.id, { isNonSubmission: true });
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      mark: null,
      isNonSubmission: true,
      classification: "FAIL",
      releaseStatus: "DRAFT",
    });
    const stored = await db.mark.findFirstOrThrow({ where: { studentId: student.id } });
    expect(stored).toMatchObject({ mark: null, isNonSubmission: true });
  });

  it("creates a DRAFT with the acting staff member, version 1 and no history row (DB-023)", async () => {
    const ctx = await setup();
    const student = await enrolled(ctx);
    const result = await put(ctx, student.id, { mark: "67.5" });
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      assessmentId: ctx.assessment.id,
      studentId: student.id,
      releaseStatus: "DRAFT",
      version: 1,
      withheldReason: null,
      publishedAt: null,
    });
    const stored = await db.mark.findFirstOrThrow({ where: { studentId: student.id } });
    expect(stored.enteredById).toBe(ctx.person.id);
    expect(await changesOf(stored.id)).toHaveLength(0);
  });

  it("changes a draft mark: version 2, one MARK row with the old and new value and who changed it", async () => {
    const ctx = await setup();
    const student = await enrolled(ctx);
    const other = await createStaff();
    const first = await put(ctx, student.id, { mark: "55" });
    const result = await call<MarkDto & ErrorBody>(putMarkRoute, {
      method: "PUT",
      path: `/api/assessments/${ctx.assessment.id}/marks/${student.id}`,
      params: { id: ctx.assessment.id, studentId: student.id },
      cookie: asStaff(other.id),
      body: { mark: "62.5", version: first.body.version },
    });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ mark: "62.5", version: 2, releaseStatus: "DRAFT" });
    const rows = await changesOf(first.body.markId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ change: "MARK", reason: null, changedById: other.id });
    expect(rows[0]?.oldMark?.toFixed(1)).toBe("55.0");
    expect(rows[0]?.newMark?.toFixed(1)).toBe("62.5");
  });

  it("records a switch to and from NS with a null on the NS side", async () => {
    const ctx = await setup();
    const student = await enrolled(ctx);
    const first = await put(ctx, student.id, { mark: "48" });
    const ns = await put(ctx, student.id, { isNonSubmission: true, version: first.body.version });
    expect(ns.body).toMatchObject({ mark: null, isNonSubmission: true, version: 2 });
    const back = await put(ctx, student.id, { mark: "30", version: ns.body.version });
    expect(back.body).toMatchObject({ mark: "30.0", isNonSubmission: false, version: 3 });
    const rows = await changesOf(first.body.markId);
    expect(rows.map((r) => [r.oldMark?.toFixed(1) ?? null, r.newMark?.toFixed(1) ?? null])).toEqual(
      [
        ["48.0", null],
        [null, "30.0"],
      ],
    );
  });

  it("changes nothing, and does not move the version, when the same mark is sent again", async () => {
    const ctx = await setup();
    const student = await enrolled(ctx);
    const first = await put(ctx, student.id, { mark: "55" });
    const again = await put(ctx, student.id, { mark: "55.0", version: 1 });
    expect(again.status).toBe(200);
    expect(again.body.version).toBe(1);
    expect(await changesOf(first.body.markId)).toHaveLength(0);
  });

  describe("a published mark", () => {
    async function published() {
      const ctx = await setup();
      const student = await enrolled(ctx);
      const mark = await createMark({
        assessmentId: ctx.assessment.id,
        studentId: student.id,
        enteredById: ctx.person.id,
        mark: "57.0",
        releaseStatus: "PUBLISHED",
      });
      return { ctx, student, mark };
    }

    it("needs a reason: 400 on the reason field, and nothing changes", async () => {
      const { ctx, student, mark } = await published();
      for (const body of [
        { mark: "62.5", version: 1 },
        { mark: "62.5", version: 1, reason: "   " },
      ]) {
        const result = await put(ctx, student.id, body);
        expect(result.status).toBe(400);
        expect(result.body.error.details).toMatchObject({
          fieldErrors: { reason: [expect.any(String)] },
        });
      }
      const stored = await db.mark.findUniqueOrThrow({ where: { id: mark.id } });
      expect(stored.mark?.toFixed(1)).toBe("57.0");
      expect(stored.version).toBe(1);
      expect(await changesOf(mark.id)).toHaveLength(0);
    });

    it("changes with a reason, stays published, and records old, new, reason and who", async () => {
      const { ctx, student, mark } = await published();
      const result = await put(ctx, student.id, {
        mark: "62.5",
        version: 1,
        reason: "  Appeal upheld: marking error  ",
      });
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({
        mark: "62.5",
        releaseStatus: "PUBLISHED",
        classification: "MERIT",
        version: 2,
      });
      expect(result.body.publishedAt).not.toBeNull();
      const rows = await changesOf(mark.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        change: "MARK",
        reason: "Appeal upheld: marking error",
        changedById: ctx.person.id,
      });
      expect(rows[0]?.oldMark?.toFixed(1)).toBe("57.0");
      expect(rows[0]?.newMark?.toFixed(1)).toBe("62.5");
    });

    it("does not ask for a reason when nothing changes", async () => {
      const { ctx, student } = await published();
      const result = await put(ctx, student.id, { mark: "57", version: 1 });
      expect(result.status).toBe(200);
      expect(result.body.version).toBe(1);
    });
  });

  it("keeps a withheld mark withheld when it changes, with no reason needed", async () => {
    const ctx = await setup();
    const student = await enrolled(ctx);
    const mark = await createMark({
      assessmentId: ctx.assessment.id,
      studentId: student.id,
      enteredById: ctx.person.id,
      releaseStatus: "WITHHELD",
      withheldReason: "Outstanding fees",
    });
    const result = await put(ctx, student.id, { mark: "61", version: 1 });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      releaseStatus: "WITHHELD",
      withheldReason: "Outstanding fees",
    });
    expect(await changesOf(mark.id)).toHaveLength(1);
  });

  describe("versions", () => {
    it("refuses a stale version with 409 and the current one, and changes nothing", async () => {
      const ctx = await setup();
      const student = await enrolled(ctx);
      await put(ctx, student.id, { mark: "50" });
      await put(ctx, student.id, { mark: "51", version: 1 });
      const stale = await put(ctx, student.id, { mark: "99", version: 1 });
      expect(stale.status).toBe(409);
      expect(stale.body.error).toMatchObject({
        code: "VERSION_CONFLICT",
        details: { currentVersion: 2 },
      });
      const stored = await db.mark.findFirstOrThrow({ where: { studentId: student.id } });
      expect(stored.mark?.toFixed(1)).toBe("51.0");
    });

    it("refuses an update that names no version once a mark exists", async () => {
      const ctx = await setup();
      const student = await enrolled(ctx);
      await put(ctx, student.id, { mark: "50" });
      const result = await put(ctx, student.id, { mark: "60" });
      expect(result.status).toBe(409);
      expect(result.body.error.details).toMatchObject({ currentVersion: 1 });
    });

    it("lets exactly one of two simultaneous updates with the same version win", async () => {
      const ctx = await setup();
      const student = await enrolled(ctx);
      const first = await put(ctx, student.id, { mark: "50" });
      const [a, b] = await Promise.all([
        put(ctx, student.id, { mark: "61", version: 1 }),
        put(ctx, student.id, { mark: "62", version: 1 }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect(await changesOf(first.body.markId)).toHaveLength(1);
    });

    it("lets exactly one of two simultaneous first entries create the mark", async () => {
      const ctx = await setup();
      const student = await enrolled(ctx);
      const [a, b] = await Promise.all([
        put(ctx, student.id, { mark: "61" }),
        put(ctx, student.id, { mark: "62" }),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect(await db.mark.count({ where: { studentId: student.id } })).toBe(1);
    });

    it("moves the version when a mark is published, so an edit made before it gets a conflict", async () => {
      const ctx = await setup();
      const student = await enrolled(ctx);
      const first = await put(ctx, student.id, { mark: "50" });
      expect((await publish(ctx, { assessmentId: ctx.assessment.id })).body.published).toBe(1);
      const stale = await put(ctx, student.id, { mark: "55", version: first.body.version });
      expect(stale.status).toBe(409);
      expect(stale.body.error.details).toMatchObject({ currentVersion: 2 });
    });
  });

  describe("who can be marked", () => {
    it("refuses a student who is not enrolled in a programme with the module and has not submitted", async () => {
      const ctx = await setup();
      const elsewhere = await createStudent(); // another programme, no module link
      const result = await put(ctx, elsewhere.id, { mark: "50" });
      expect(result.status).toBe(422);
      expect(result.body.error).toMatchObject({
        code: "BUSINESS_RULE",
        details: { rule: "STUDENT_NOT_ELIGIBLE" },
      });
      const deferred = await enrolled(ctx, { status: "DEFERRED" });
      expect((await put(ctx, deferred.id, { mark: "50" })).status).toBe(422);
      expect(await db.mark.count()).toBe(0);
    });

    it("allows a student who submitted although no longer enrolled, and keeps marking them", async () => {
      const ctx = await setup();
      const withdrawn = await enrolled(ctx, { status: "WITHDRAWN" });
      await createSubmission({
        assessmentId: ctx.assessment.id,
        studentId: withdrawn.id,
        submittedAt: new Date(Date.now() - 12 * DAY),
      });
      const created = await put(ctx, withdrawn.id, { mark: "50" });
      expect(created.status).toBe(201);
      expect((await put(ctx, withdrawn.id, { mark: "52", version: 1 })).status).toBe(200);
    });

    it("answers 404 for an unknown or malformed assessment or student", async () => {
      const ctx = await setup();
      const student = await enrolled(ctx);
      expect((await put(ctx, student.id, { mark: "50" }, UNKNOWN_ID)).status).toBe(404);
      expect((await put(ctx, UNKNOWN_ID, { mark: "50" })).status).toBe(404);
      expect((await put(ctx, "not-a-uuid", { mark: "50" })).status).toBe(404);
      expect((await put(ctx, student.id, { mark: "50" }, "not-a-uuid")).status).toBe(404);
    });
  });
});

// --- The marksheet --------------------------------------------------------------------------------------------------

describe("marksheet rows", () => {
  it("lists eligible students, anyone who submitted and anyone marked, by name, with lateness and marks", async () => {
    const ctx = await setup();
    const deadline = ctx.assessment.deadline.getTime();
    const ayesha = await enrolled(ctx, { fullName: "Ayesha Rahman" });
    const bilal = await enrolled(ctx, { fullName: "Bilal Khan" });
    const chaity = await enrolled(ctx, { fullName: "Chaity Das" });
    const dina = await enrolled(ctx, { fullName: "Dina Sultana", status: "WITHDRAWN" }); // submitted earlier
    const emon = await enrolled(ctx, { fullName: "Emon Ali", status: "COMPLETED" }); // marked only
    const outsider = await createStudent({ fullName: "Zara Outsider" }); // not on it
    await enrolled(ctx, { fullName: "Faria Deferred", status: "DEFERRED" }); // not on it

    await createSubmission({
      assessmentId: ctx.assessment.id,
      studentId: ayesha.id,
      submittedAt: new Date(deadline - HOUR),
    });
    await createSubmission({
      assessmentId: ctx.assessment.id,
      studentId: bilal.id,
      submittedAt: new Date(deadline + 5 * HOUR),
    });
    await createSubmission({
      assessmentId: ctx.assessment.id,
      studentId: dina.id,
      submittedAt: new Date(deadline - DAY),
    });
    // Chaity has an extension that makes Bilal-style lateness not apply to her; she did not submit.
    await createExtension({
      assessmentId: ctx.assessment.id,
      studentId: chaity.id,
      newDeadline: new Date(deadline + DAY),
    });
    await createMark({
      assessmentId: ctx.assessment.id,
      studentId: emon.id,
      enteredById: ctx.person.id,
      mark: "71.0",
      releaseStatus: "PUBLISHED",
    });
    await createMark({
      assessmentId: ctx.assessment.id,
      studentId: ayesha.id,
      enteredById: ctx.person.id,
      mark: "39.5",
    });
    await createMark({
      assessmentId: ctx.assessment.id,
      studentId: chaity.id,
      enteredById: ctx.person.id,
      mark: null,
      releaseStatus: "WITHHELD",
      withheldReason: "Outstanding fees",
    });

    const result = await sheet(ctx);
    expect(result.status).toBe(200);
    expect(result.body.items.map((r) => r.student.fullName)).toEqual([
      "Ayesha Rahman",
      "Bilal Khan",
      "Chaity Das",
      "Dina Sultana",
      "Emon Ali",
    ]);
    expect(result.body.items.some((r) => r.student.id === outsider.id)).toBe(false);
    expect(result.body.total).toBe(5);
    expect(result.body.summary).toEqual({
      entered: 3,
      missing: 2,
      draft: 1,
      published: 1,
      withheld: 1,
    });

    const [a, b, c, d, e] = result.body.items;
    expect(a).toMatchObject({
      eligible: true,
      submission: { status: "ON_TIME", lateBy: null },
      mark: "39.5",
      classification: "PASS",
      releaseStatus: "DRAFT",
      version: 1,
    });
    expect(b).toMatchObject({
      submission: { status: "LATE", lateBy: "5 hours" },
      markId: null,
      mark: null,
      classification: null,
      releaseStatus: null,
      version: null,
    });
    expect(c).toMatchObject({
      submission: { status: "NOT_SUBMITTED", lateBy: null },
      mark: null,
      isNonSubmission: true,
      classification: "FAIL",
      releaseStatus: "WITHHELD",
      withheldReason: "Outstanding fees",
    });
    expect(new Date(c!.submission.deadline).getTime()).toBe(deadline + DAY); // their extension
    expect(d).toMatchObject({ eligible: false, student: { status: "WITHDRAWN" } });
    expect(e).toMatchObject({
      eligible: false,
      releaseStatus: "PUBLISHED",
      classification: "DISTINCTION",
    });
  });

  it("answers 404 for an unknown or malformed assessment", async () => {
    const ctx = await setup();
    expect((await sheet(ctx, UNKNOWN_ID)).status).toBe(404);
    expect((await sheet(ctx, "nope")).status).toBe(404);
  });
});

// --- Publishing -----------------------------------------------------------------------------------------------------

describe("publish", () => {
  /** Eight students: drafts, a withheld mark, a published one, one with no mark; one draft owes overdue fees. */
  async function scenario() {
    const ctx = await setup();
    const make = async (
      name: string,
      mark: string | null | undefined,
      releaseStatus?: "DRAFT" | "PUBLISHED" | "WITHHELD",
    ) => {
      const student = await enrolled(ctx, { fullName: name });
      if (mark !== undefined) {
        await createMark({
          assessmentId: ctx.assessment.id,
          studentId: student.id,
          enteredById: ctx.person.id,
          mark,
          releaseStatus,
          withheldReason: releaseStatus === "WITHHELD" ? "Outstanding fees" : undefined,
        });
      }
      return student;
    };
    const draft1 = await make("Aaa Draft", "45.0");
    const draft2 = await make("Bbb Draft", "65.5");
    const debtor = await make("Ccc Debtor", "52.0");
    const withheld = await make("Ddd Withheld", "48.0", "WITHHELD");
    const done = await make("Eee Published", "75.0", "PUBLISHED");
    const ns = await make("Fff Absent", null);
    const missing1 = await make("Ggg NoMark", undefined);
    const missing2 = await make("Hhh NoMark", undefined);

    // Debtor owes an overdue charge; Aaa paid in full; Eee owes too but has nothing left to publish.
    await createFeeCharge({ studentId: debtor.id, amount: "90000.00", dueDate: "2020-01-31" });
    await createFeeCharge({ studentId: draft1.id, amount: "50000.00", dueDate: "2020-01-31" });
    await createPayment({ studentId: draft1.id, staffId: ctx.person.id, amount: "50000.00" });
    await createFeeCharge({ studentId: done.id, amount: "70000.00", dueDate: "2020-01-31" });
    // A charge not yet due is not overdue.
    await createFeeCharge({ studentId: draft2.id, amount: "10000.00", dueDate: "2999-01-01" });
    return { ctx, draft1, draft2, debtor, withheld, done, ns, missing1, missing2 };
  }

  it("dry run: counts what a real run would publish, flags missing marks and overdue fees, and writes nothing", async () => {
    const { ctx, debtor, missing1, missing2 } = await scenario();
    const result = await publish(ctx, { assessmentId: ctx.assessment.id, dryRun: true });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      dryRun: true,
      published: 0,
      toPublish: 5, // 3 drafts + the NS draft + 1 withheld
      alreadyPublished: 1,
      overdueTotal: "90000.00",
      summary: "Publish 5 marks - 1 student has overdue fees, 2 marks missing",
    });
    expect(result.body.overdueStudents).toEqual([
      {
        student: { id: debtor.id, studentNumber: debtor.studentNumber, fullName: "Ccc Debtor" },
        overdueAmount: "90000.00",
        marksToPublish: 1,
      },
    ]);
    expect(result.body.missingMarks.map((m) => m.student.id)).toEqual([missing1.id, missing2.id]);
    expect(result.body.missingMarks[0]?.assessment).toMatchObject({
      id: ctx.assessment.id,
      module: { id: ctx.mod.id },
    });
    expect(result.body.warnings).toEqual([
      {
        code: "OVERDUE_FEES",
        message: "1 student has overdue fees.",
        details: { students: 1, amount: "90000.00" },
      },
      { code: "MISSING_MARKS", message: "2 marks missing.", details: { count: 2 } },
    ]);

    // Nothing changed.
    expect(await db.mark.count({ where: { releaseStatus: "PUBLISHED" } })).toBe(1);
    expect(await db.markChange.count()).toBe(0);
  });

  it("real run: publishes DRAFT and WITHHELD, writes one PUBLISH row each, and returns the same warnings", async () => {
    const { ctx, withheld } = await scenario();
    const before = await db.mark.findMany({ orderBy: { id: "asc" } });
    const result = await publish(ctx, { assessmentId: ctx.assessment.id });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      dryRun: false,
      published: 5,
      toPublish: 5,
      alreadyPublished: 1,
    });
    expect(result.body.warnings?.map((w) => w.code)).toEqual(["OVERDUE_FEES", "MISSING_MARKS"]);

    const marks = await db.mark.findMany({ orderBy: { id: "asc" } });
    expect(
      marks.every((m) => m.releaseStatus === "PUBLISHED" && m.publishedAt && !m.withheldReason),
    ).toBe(true);
    const alreadyPublished = before.find((m) => m.releaseStatus === "PUBLISHED")!;
    for (const mark of marks) {
      const rows = await changesOf(mark.id);
      if (mark.id === alreadyPublished.id) {
        // Left alone: no new row, same version.
        expect(rows).toHaveLength(0);
        expect(mark.version).toBe(alreadyPublished.version);
      } else {
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          change: "PUBLISH",
          changedById: ctx.person.id,
          reason: null,
        });
        expect(mark.version).toBe(before.find((m) => m.id === mark.id)!.version + 1);
      }
    }
    expect(
      (await db.mark.findFirstOrThrow({ where: { studentId: withheld.id } })).withheldReason,
    ).toBeNull();

    // A second run has nothing left to do and writes nothing more.
    const again = await publish(ctx, { assessmentId: ctx.assessment.id });
    expect(again.body).toMatchObject({ published: 0, toPublish: 0, alreadyPublished: 6 });
    expect(again.body.warnings?.map((w) => w.code)).toEqual(["MISSING_MARKS"]);
    expect(await db.markChange.count()).toBe(5);
  });

  it("does not flag overdue fees for students with nothing left to publish, or fees not yet due", async () => {
    const { ctx } = await scenario();
    const result = await publish(ctx, { assessmentId: ctx.assessment.id, dryRun: true });
    const names = result.body.overdueStudents.map((s) => s.student.fullName);
    expect(names).toEqual(["Ccc Debtor"]); // not Eee (already published), Aaa (paid) or Bbb (not yet due)
  });

  it("adds no warnings when every mark is in and nobody owes", async () => {
    const ctx = await setup();
    const student = await enrolled(ctx);
    await put(ctx, student.id, { mark: "50" });
    const result = await publish(ctx, { assessmentId: ctx.assessment.id, dryRun: true });
    expect(result.body).toMatchObject({ toPublish: 1, summary: "Publish 1 mark" });
    expect(result.body.warnings).toBeUndefined();
  });

  it("publishes for one student across assessments, expecting marks only for assessments that are due", async () => {
    const ctx = await setup();
    const student = await enrolled(ctx);
    const second = await createAssessment({
      moduleId: ctx.mod.id,
      createdById: ctx.person.id,
      deadline: new Date(Date.now() - 2 * DAY),
    });
    await createAssessment({
      moduleId: ctx.mod.id,
      createdById: ctx.person.id,
      deadline: new Date(Date.now() + 30 * DAY), // not due yet: not "missing"
    });
    await createMark({
      assessmentId: ctx.assessment.id,
      studentId: student.id,
      enteredById: ctx.person.id,
    });
    const preview = await publish(ctx, { studentId: student.id, dryRun: true });
    expect(preview.body).toMatchObject({ toPublish: 1, alreadyPublished: 0 });
    expect(preview.body.missingMarks).toHaveLength(1);
    expect(preview.body.missingMarks[0]?.assessment.id).toBe(second.id);

    const real = await publish(ctx, { studentId: student.id });
    expect(real.body.published).toBe(1);
    expect(await db.mark.count({ where: { releaseStatus: "PUBLISHED" } })).toBe(1);
  });

  it("publishes exactly the marks named, and answers 404 if one does not exist", async () => {
    const ctx = await setup();
    const [s1, s2, s3] = [await enrolled(ctx), await enrolled(ctx), await enrolled(ctx)];
    const [m1, m2] = await Promise.all(
      [s1, s2].map((s) =>
        createMark({
          assessmentId: ctx.assessment.id,
          studentId: s.id,
          enteredById: ctx.person.id,
        }),
      ),
    );
    await createMark({
      assessmentId: ctx.assessment.id,
      studentId: s3.id,
      enteredById: ctx.person.id,
    });

    const missing = await publish(ctx, { markIds: [m1!.id, UNKNOWN_ID] });
    expect(missing.status).toBe(404);
    expect(await db.mark.count({ where: { releaseStatus: "PUBLISHED" } })).toBe(0);

    const result = await publish(ctx, { markIds: [m1!.id, m2!.id, m1!.id] });
    expect(result.body).toMatchObject({ published: 2, toPublish: 2 });
    expect(result.body.missingMarks).toEqual([]);
    expect(await db.mark.count({ where: { releaseStatus: "PUBLISHED" } })).toBe(2);
  });

  it("validates the scope: exactly one of assessmentId, studentId or markIds", async () => {
    const ctx = await setup();
    for (const body of [
      {},
      { dryRun: true },
      { assessmentId: ctx.assessment.id, studentId: UNKNOWN_ID },
      { markIds: [] },
      { markIds: ["nope"] },
      { assessmentId: "nope" },
    ]) {
      const result = await publish(ctx, body);
      expect(result.status).toBe(400);
      expect(result.body.error.code).toBe("VALIDATION_ERROR");
    }
    expect((await publish(ctx, { assessmentId: UNKNOWN_ID })).status).toBe(404);
    expect((await publish(ctx, { studentId: UNKNOWN_ID })).status).toBe(404);
  });

  it("never double-publishes when two requests run at once: one PUBLISH row per mark", async () => {
    const ctx = await setup();
    const students = await Promise.all([1, 2, 3, 4].map(() => enrolled(ctx)));
    for (const student of students) {
      await createMark({
        assessmentId: ctx.assessment.id,
        studentId: student.id,
        enteredById: ctx.person.id,
      });
    }
    const [a, b] = await Promise.all([
      publish(ctx, { assessmentId: ctx.assessment.id }),
      publish(ctx, { assessmentId: ctx.assessment.id }),
    ]);
    expect(a.body.published + b.body.published).toBe(4);
    expect(await db.markChange.count({ where: { change: "PUBLISH" } })).toBe(4);
  });
});

// --- Withhold and unpublish -----------------------------------------------------------------------------------------

describe("withhold and unpublish", () => {
  async function trio() {
    const ctx = await setup();
    const make = async (releaseStatus: "DRAFT" | "PUBLISHED" | "WITHHELD") => {
      const student = await enrolled(ctx);
      return createMark({
        assessmentId: ctx.assessment.id,
        studentId: student.id,
        enteredById: ctx.person.id,
        releaseStatus,
        withheldReason: releaseStatus === "WITHHELD" ? "Misconduct review" : undefined,
      });
    };
    return {
      ctx,
      draft: await make("DRAFT"),
      published: await make("PUBLISHED"),
      held: await make("WITHHELD"),
    };
  }

  it("withhold needs a reason (400 on reason) and changes nothing without one", async () => {
    const { ctx, draft } = await trio();
    for (const body of [
      { markIds: [draft.id] },
      { markIds: [draft.id], reason: "" },
      { markIds: [draft.id], reason: "   " },
    ]) {
      const result = await withhold(ctx, body);
      expect(result.status).toBe(400);
      expect(result.body.error.details).toMatchObject({
        fieldErrors: { reason: [expect.any(String)] },
      });
    }
    expect((await db.mark.findUniqueOrThrow({ where: { id: draft.id } })).releaseStatus).toBe(
      "DRAFT",
    );
    expect(await db.markChange.count()).toBe(0);
  });

  it("withholds DRAFT and PUBLISHED marks with the reason, skips WITHHELD ones, and writes WITHHOLD rows", async () => {
    const { ctx, draft, published, held } = await trio();
    const result = await withhold(ctx, {
      markIds: [draft.id, published.id, held.id],
      reason: "  Outstanding fees  ",
    });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ changed: 2, skipped: 1 });
    expect([...result.body.markIds].sort()).toEqual([draft.id, published.id].sort());

    for (const id of [draft.id, published.id]) {
      const stored = await db.mark.findUniqueOrThrow({ where: { id } });
      expect(stored).toMatchObject({
        releaseStatus: "WITHHELD",
        withheldReason: "Outstanding fees",
        publishedAt: null,
        version: 2,
      });
      expect(await changesOf(id)).toMatchObject([
        { change: "WITHHOLD", reason: "Outstanding fees", changedById: ctx.person.id },
      ]);
    }
    // The one already withheld keeps its own reason and has no new row.
    const kept = await db.mark.findUniqueOrThrow({ where: { id: held.id } });
    expect(kept).toMatchObject({ withheldReason: "Misconduct review", version: 1 });
    expect(await changesOf(held.id)).toHaveLength(0);
  });

  it("unpublish needs a reason, moves PUBLISHED back to DRAFT, skips the rest, and writes UNPUBLISH rows", async () => {
    const { ctx, draft, published, held } = await trio();
    const noReason = await unpublish(ctx, { markIds: [published.id] });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.details).toMatchObject({
      fieldErrors: { reason: [expect.any(String)] },
    });
    expect((await db.mark.findUniqueOrThrow({ where: { id: published.id } })).releaseStatus).toBe(
      "PUBLISHED",
    );

    const result = await unpublish(ctx, {
      markIds: [draft.id, published.id, held.id],
      reason: "Published by mistake",
    });
    expect(result.body).toMatchObject({ changed: 1, skipped: 2, markIds: [published.id] });
    expect(await db.mark.findUniqueOrThrow({ where: { id: published.id } })).toMatchObject({
      releaseStatus: "DRAFT",
      publishedAt: null,
      version: 2,
    });
    expect(await changesOf(published.id)).toMatchObject([
      { change: "UNPUBLISH", reason: "Published by mistake", changedById: ctx.person.id },
    ]);
    expect(await changesOf(draft.id)).toHaveLength(0);
    expect(await changesOf(held.id)).toHaveLength(0);
  });

  it("answers 400 for no marks and 404 when a mark does not exist, changing nothing", async () => {
    const { ctx, draft } = await trio();
    expect((await withhold(ctx, { markIds: [], reason: "x" })).status).toBe(400);
    const result = await withhold(ctx, { markIds: [draft.id, UNKNOWN_ID], reason: "x" });
    expect(result.status).toBe(404);
    expect((await db.mark.findUniqueOrThrow({ where: { id: draft.id } })).releaseStatus).toBe(
      "DRAFT",
    );
    expect((await unpublish(ctx, { markIds: [UNKNOWN_ID], reason: "x" })).status).toBe(404);
  });

  it("a withheld mark can be published again, which clears the reason", async () => {
    const { ctx, held } = await trio();
    const result = await publish(ctx, { markIds: [held.id] });
    expect(result.body.published).toBe(1);
    expect(await db.mark.findUniqueOrThrow({ where: { id: held.id } })).toMatchObject({
      releaseStatus: "PUBLISHED",
      withheldReason: null,
    });
  });
});

// --- History --------------------------------------------------------------------------------------------------------

describe("mark history (DB-023)", () => {
  it("writes a row for every change after the first entry and for every release event, in order", async () => {
    const ctx = await setup();
    const student = await enrolled(ctx);

    const created = await put(ctx, student.id, { mark: "55" }); // no row
    const id = created.body.markId;
    expect(await changesOf(id)).toHaveLength(0);

    await put(ctx, student.id, { mark: "58", version: 1 }); // MARK
    await publish(ctx, { assessmentId: ctx.assessment.id }); // PUBLISH
    await put(ctx, student.id, { mark: "61", version: 3, reason: "Re-marked" }); // MARK (reason)
    await withhold(ctx, { markIds: [id], reason: "Fees" }); // WITHHOLD
    await publish(ctx, { markIds: [id] }); // PUBLISH
    await unpublish(ctx, { markIds: [id], reason: "Wrong cohort" }); // UNPUBLISH

    const rows = await changesOf(id);
    expect(rows.map((r) => [r.change, r.reason])).toEqual([
      ["MARK", null],
      ["PUBLISH", null],
      ["MARK", "Re-marked"],
      ["WITHHOLD", "Fees"],
      ["PUBLISH", null],
      ["UNPUBLISH", "Wrong cohort"],
    ]);
    expect(rows.every((r) => r.changedById === ctx.person.id)).toBe(true);
    // Release rows carry no mark values.
    expect(
      rows
        .filter((r) => r.change !== "MARK")
        .every((r) => r.oldMark === null && r.newMark === null),
    ).toBe(true);
  });

  it("shows a student's marks with their full history to staff, newest assessment and newest change first", async () => {
    const ctx = await setup();
    const student = await enrolled(ctx);
    const newer = await createAssessment({
      moduleId: ctx.mod.id,
      createdById: ctx.person.id,
      deadline: new Date(Date.now() - 2 * DAY),
      title: "Newer",
    });
    await put(ctx, student.id, { mark: "50" });
    await put(ctx, student.id, { mark: "52", version: 1 });
    await publish(ctx, { assessmentId: ctx.assessment.id });
    await put(ctx, student.id, { mark: "70", version: 3, reason: "Appeal" });
    await put(ctx, student.id, { isNonSubmission: true }, newer.id);
    await withhold(ctx, {
      markIds: [(await db.mark.findFirstOrThrow({ where: { assessmentId: newer.id } })).id],
      reason: "Fees",
    });

    const result = await results(ctx, student.id);
    expect(result.status).toBe(200);
    expect(result.body.student).toMatchObject({
      id: student.id,
      studentNumber: student.studentNumber,
    });
    expect(result.body.summary).toEqual({ total: 2, draft: 0, published: 1, withheld: 1 });
    expect(result.body.items.map((i) => i.assessment.title)).toEqual([
      "Newer",
      ctx.assessment.title,
    ]);

    const [nsItem, olderItem] = result.body.items;
    expect(nsItem).toMatchObject({
      mark: null,
      isNonSubmission: true,
      classification: "FAIL",
      releaseStatus: "WITHHELD",
      withheldReason: "Fees",
      enteredBy: { id: ctx.person.id },
    });
    expect(olderItem).toMatchObject({
      mark: "70.0",
      classification: "DISTINCTION",
      releaseStatus: "PUBLISHED",
    });
    expect(olderItem?.history.map((h) => h.change)).toEqual(["MARK", "PUBLISH", "MARK"]);
    expect(olderItem?.history[0]).toMatchObject({
      oldMark: "52.0",
      newMark: "70.0",
      reason: "Appeal",
      changedBy: { id: ctx.person.id, fullName: ctx.person.fullName },
    });
  });

  it("answers an empty list for a student with no marks, and 404 for an unknown one", async () => {
    const ctx = await setup();
    const student = await enrolled(ctx);
    const empty = await results(ctx, student.id);
    expect(empty.body).toMatchObject({ summary: { total: 0 }, items: [] });
    expect((await results(ctx, UNKNOWN_ID)).status).toBe(404);
    expect((await results(ctx, "nope")).status).toBe(404);
  });
});

// --- What a student sees --------------------------------------------------------------------------------------------

describe("GET /api/me/results", () => {
  it("shows published marks with their classification and everything else as NOT_AVAILABLE only", async () => {
    const ctx = await setup();
    const student = await enrolled(ctx);
    const assess = async (
      title: string,
      mark: string | null | undefined,
      releaseStatus?: "DRAFT" | "PUBLISHED" | "WITHHELD",
    ) => {
      const a = await createAssessment({
        moduleId: ctx.mod.id,
        createdById: ctx.person.id,
        title,
        deadline: new Date(Date.now() - 20 * DAY + title.length * 1000),
      });
      if (mark !== undefined) {
        await createMark({
          assessmentId: a.id,
          studentId: student.id,
          enteredById: ctx.person.id,
          mark,
          releaseStatus,
          withheldReason: releaseStatus === "WITHHELD" ? "SECRET-REASON-fees" : undefined,
        });
      }
      return a;
    };
    const published = await assess("Published", "64.5", "PUBLISHED");
    const ns = await assess("Published NS", null, "PUBLISHED");
    const draft = await assess("Draft", "91.5");
    const held = await assess("Held", "88.5", "WITHHELD");
    const none = await assess("Nothing", undefined);

    const result = await call<MyResults>(myResultsRoute, {
      path: "/api/me/results",
      cookie: asStudent(student.id),
    });
    expect(result.status).toBe(200);
    const byId = new Map(result.body.items.map((i) => [i.assessment.id, i]));

    expect(byId.get(published.id)).toMatchObject({
      status: "PUBLISHED",
      mark: "64.5",
      classification: "MERIT",
      isNonSubmission: false,
      assessment: { title: "Published", module: { id: ctx.mod.id } },
    });
    expect(byId.get(ns.id)).toMatchObject({
      status: "PUBLISHED",
      mark: null,
      isNonSubmission: true,
    });

    // Draft, withheld and not-yet-marked are indistinguishable, and say nothing but the assessment's name.
    for (const a of [draft, held, none, ctx.assessment]) {
      const item = byId.get(a.id);
      expect(item).toBeDefined();
      expect(Object.keys(item!).sort()).toEqual(["assessment", "status"]);
      expect(item!.status).toBe("NOT_AVAILABLE");
    }
    const text = JSON.stringify(result.body);
    expect(text).not.toContain("SECRET-REASON-fees");
    expect(text).not.toContain("91.5");
    expect(text).not.toContain("88.5");
    expect(text).not.toContain("WITHHELD");
    expect(text).not.toContain("DRAFT");
  });

  it("never includes another student's marks", async () => {
    const ctx = await setup();
    const me = await enrolled(ctx);
    const other = await enrolled(ctx);
    await createMark({
      assessmentId: ctx.assessment.id,
      studentId: other.id,
      enteredById: ctx.person.id,
      mark: "99.0",
      releaseStatus: "PUBLISHED",
    });
    const result = await call<MyResults>(myResultsRoute, {
      path: "/api/me/results",
      cookie: asStudent(me.id),
    });
    expect(result.body.items).toHaveLength(1);
    expect(result.body.items[0]).toMatchObject({ status: "NOT_AVAILABLE" });
    expect(JSON.stringify(result.body)).not.toContain("99.0");
  });

  it("goes back to NOT_AVAILABLE when a result is withheld or unpublished", async () => {
    const ctx = await setup();
    const student = await enrolled(ctx);
    const mark = await createMark({
      assessmentId: ctx.assessment.id,
      studentId: student.id,
      enteredById: ctx.person.id,
      mark: "80.0",
      releaseStatus: "PUBLISHED",
    });
    const read = () =>
      call<MyResults>(myResultsRoute, { path: "/api/me/results", cookie: asStudent(student.id) });
    expect((await read()).body.items[0]?.status).toBe("PUBLISHED");
    await withhold(ctx, { markIds: [mark.id], reason: "Fees" });
    expect((await read()).body.items[0]?.status).toBe("NOT_AVAILABLE");
    await publish(ctx, { markIds: [mark.id] });
    expect((await read()).body.items[0]?.status).toBe("PUBLISHED");
    await unpublish(ctx, { markIds: [mark.id], reason: "Wrong" });
    expect((await read()).body.items[0]?.status).toBe("NOT_AVAILABLE");
  });

  it("keeps a withdrawn student's published results visible to them", async () => {
    const ctx = await setup();
    const student = await enrolled(ctx, { status: "WITHDRAWN" });
    await createMark({
      assessmentId: ctx.assessment.id,
      studentId: student.id,
      enteredById: ctx.person.id,
      releaseStatus: "PUBLISHED",
    });
    const result = await call<MyResults>(myResultsRoute, {
      path: "/api/me/results",
      cookie: asStudent(student.id),
    });
    expect(result.body.items[0]).toMatchObject({ status: "PUBLISHED", mark: "55.0" });
  });
});

// --- Module changes (D-035) -----------------------------------------------------------------------------------------

describe("changing an assessment's module", () => {
  it("is refused with 422 ASSESSMENT_HAS_ACTIVITY once a mark exists, even with no submissions", async () => {
    const ctx = await setup();
    const other = await createModule();
    const student = await enrolled(ctx);
    await put(ctx, student.id, { mark: "50" });

    const result = await call<ErrorBody>(patchAssessmentRoute, {
      method: "PATCH",
      path: `/api/assessments/${ctx.assessment.id}`,
      params: { id: ctx.assessment.id },
      cookie: ctx.cookie,
      body: { moduleId: other.id, version: 1 },
    });
    expect(result.status).toBe(422);
    expect(result.body.error).toMatchObject({
      code: "BUSINESS_RULE",
      details: { rule: "ASSESSMENT_HAS_ACTIVITY", submissions: 0, marks: 1 },
    });
    expect(
      (await db.assessment.findUniqueOrThrow({ where: { id: ctx.assessment.id } })).moduleId,
    ).toBe(ctx.mod.id);
  });
});
