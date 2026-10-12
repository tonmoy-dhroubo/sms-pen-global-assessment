import { describe, expect, it } from "vitest";
import { GET as timelineRoute } from "@/app/api/students/[id]/timeline/route";
import { db } from "@/lib/db";
import type { StudentTimeline } from "@/lib/services/timeline";
import { asStaff, asStudent, call } from "../../support/api";
import {
  createAssessment,
  createExtension,
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

// Integration tests for GET /api/students/{id}/timeline (api.md "Students"): real Postgres, the Route Handler called
// directly. Rows are written straight to the database with chosen timestamps so the order is known.

type ErrorBody = { error: { code: string; message: string; details?: Record<string, unknown> } };

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";
const HOUR = 60 * 60 * 1000;
const T0 = new Date("2026-09-01T06:00:00.000Z").getTime();
/** An instant `hours` after T0, so rows can be given a clear order. */
const at = (hours: number) => new Date(T0 + hours * HOUR);

function timeline(studentId: string, cookie: string, query = "") {
  return call<StudentTimeline & ErrorBody>(timelineRoute, {
    path: `/api/students/${studentId}/timeline${query}`,
    params: { id: studentId },
    cookie,
  });
}

async function setup() {
  const officer = await createStaff({ fullName: "Kamrul Hasan" });
  const finance = await createStaff({ fullName: "Fatema Begum" });
  const programme = await createProgramme();
  const student = await createStudent({ programmeId: programme.id });
  const mod = await createModule();
  await linkModule(programme.id, mod.id);
  return { officer, finance, programme, student, mod, cookie: asStaff(officer.id) };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

/** A PUBLISH history row on a fresh mark of the student, at `hours`. */
async function publishAt(ctx: Ctx, hours: number) {
  const assessment = await createAssessment({ moduleId: ctx.mod.id, createdById: ctx.officer.id });
  const mark = await createMark({
    assessmentId: assessment.id,
    studentId: ctx.student.id,
    enteredById: ctx.officer.id,
  });
  await db.markChange.create({
    data: { markId: mark.id, change: "PUBLISH", changedById: ctx.officer.id, changedAt: at(hours) },
  });
}

/** One of every kind of event for the student, oldest first at hours 1..10. */
async function everything(ctx: Ctx) {
  const { officer, finance, student, mod } = ctx;
  await db.statusChange.create({
    data: {
      studentId: student.id,
      fromStatus: null,
      toStatus: "ENROLLED",
      changedById: officer.id,
      changedAt: at(1),
    },
  });
  const charge = await createFeeCharge({
    studentId: student.id,
    amount: "40000.00",
    dueDate: "2026-10-01",
    description: "Tuition 2026-27, instalment 1",
  });
  await db.feeCharge.update({
    where: { id: charge.id },
    data: { createdAt: at(2), createdById: officer.id },
  });
  const payment = await createPayment({
    studentId: student.id,
    staffId: officer.id,
    amount: "15000.00",
  });
  await db.payment.update({
    where: { id: payment.id },
    data: {
      recordedAt: at(3),
      voidedAt: at(4),
      voidedById: finance.id,
      voidReason: "Wrong student",
      reference: "TRX 9F3",
    },
  });

  const assessment = await createAssessment({
    moduleId: mod.id,
    createdById: officer.id,
    title: "Essay 1",
    deadline: at(5.5),
  });
  const submission = await createSubmission({
    assessmentId: assessment.id,
    studentId: student.id,
    submittedAt: at(6),
  });
  await createSubmissionFile({
    submissionId: submission.id,
    uploadedAt: at(5),
    originalName: "first.pdf",
  });
  await createSubmissionFile({
    submissionId: submission.id,
    uploadedAt: at(6),
    originalName: "second.pdf",
  });

  const mark = await createMark({
    assessmentId: assessment.id,
    studentId: student.id,
    enteredById: officer.id,
    mark: "62.5",
  });
  const change = (
    hours: number,
    data: { change: "MARK" | "PUBLISH" | "WITHHOLD" | "UNPUBLISH" } & Record<string, unknown>,
  ) =>
    db.markChange.create({
      data: { markId: mark.id, changedById: finance.id, changedAt: at(hours), ...data },
    });
  await change(7, { change: "MARK", oldMark: "55.0", newMark: "62.5", reason: "Remark" });
  await change(8, { change: "PUBLISH" });
  await change(9, { change: "WITHHOLD", reason: "Fees unpaid" });
  await change(10, { change: "UNPUBLISH", reason: "Checking" });
}

describe("GET /api/students/{id}/timeline: access", () => {
  it("is staff only: no session 401, a student 403, an unknown or malformed id 404", async () => {
    const ctx = await setup();
    expect((await timeline(ctx.student.id, "")).status).toBe(401);
    const denied = await timeline(ctx.student.id, asStudent(ctx.student.id));
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ error: { code: "FORBIDDEN" } });

    const unknown = await timeline(UNKNOWN_ID, ctx.cookie);
    expect(unknown.status).toBe(404);
    expect(unknown.body).toMatchObject({ error: { code: "NOT_FOUND" } });
    expect((await timeline("not-a-uuid", ctx.cookie)).status).toBe(404);
  });

  it("rejects a malformed cursor or limit with 400", async () => {
    const ctx = await setup();
    for (const query of ["?before=yesterday", "?limit=0", "?limit=101", "?limit=abc"]) {
      const { status, body } = await timeline(ctx.student.id, ctx.cookie, query);
      expect(status, query).toBe(400);
      expect(body).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    }
  });

  it("answers an empty timeline for a student with no history", async () => {
    const ctx = await setup();
    const { status, body } = await timeline(ctx.student.id, ctx.cookie);
    expect(status).toBe(200);
    expect(body).toEqual({ items: [], nextBefore: null });
  });
});

describe("GET /api/students/{id}/timeline: events", () => {
  it("merges every kind of event, newest first, each with its actor", async () => {
    const ctx = await setup();
    await everything(ctx);

    const { status, body } = await timeline(ctx.student.id, ctx.cookie);
    expect(status).toBe(200);
    expect(body.nextBefore).toBeNull();
    expect(body.items.map((event) => event.type)).toEqual([
      "MARK_UNPUBLISHED",
      "MARK_WITHHELD",
      "MARK_PUBLISHED",
      "MARK_CHANGED",
      "SUBMISSION",
      "SUBMISSION",
      "PAYMENT_VOIDED",
      "PAYMENT_RECORDED",
      "FEE_CHARGE",
      "STATUS_CHANGE",
    ]);
    // Newest first, with an ISO instant each.
    const times = body.items.map((event) => event.at);
    expect(times).toEqual([...times].sort().reverse());
    expect(times[0]).toBe(at(10).toISOString());
    // Ids are unique across kinds.
    expect(new Set(body.items.map((event) => event.id)).size).toBe(body.items.length);

    const byType = (type: string) => body.items.filter((event) => event.type === type);
    expect(byType("STATUS_CHANGE")[0]).toMatchObject({
      actor: { id: ctx.officer.id, fullName: "Kamrul Hasan" },
      summary: "Enrolled as a new student (Enrolled)",
      details: { fromStatus: null, toStatus: "ENROLLED", reason: null },
    });

    expect(byType("FEE_CHARGE")[0]).toMatchObject({
      actor: { id: ctx.officer.id, fullName: "Kamrul Hasan" },
      summary: "Fee charged: Tuition 2026-27, instalment 1 (৳40,000.00)",
      details: { kind: "PROGRAMME_FEE", amount: "40000.00", dueDate: "2026-10-01" },
    });

    // A payment is recorded at `recordedAt`, and a void is its own, later event with who voided it and why.
    expect(byType("PAYMENT_RECORDED")[0]).toMatchObject({
      at: at(3).toISOString(),
      actor: { fullName: "Kamrul Hasan" },
      summary: "Payment recorded: ৳15,000.00 by bank transfer, reference TRX 9F3",
      details: { amount: "15000.00", method: "BANK_TRANSFER", reference: "TRX 9F3" },
    });
    expect(byType("PAYMENT_VOIDED")[0]).toMatchObject({
      at: at(4).toISOString(),
      actor: { id: ctx.finance.id, fullName: "Fatema Begum" },
      summary: "Payment voided: ৳15,000.00, reference TRX 9F3",
      details: { reason: "Wrong student" },
    });

    // Deadline at hour 5.5: the file at hour 5 is on time, the one at hour 6 is 30 minutes late.
    const [secondFile, firstFile] = byType("SUBMISSION");
    expect(firstFile).toMatchObject({
      actor: null,
      details: { fileName: "first.pdf", late: false, lateBy: null },
      href: expect.stringMatching(/^\/staff\/assessments\/[0-9a-f-]{36}$/),
    });
    expect(firstFile!.summary).toBe("Submitted Essay 1 (first.pdf)");
    expect(secondFile).toMatchObject({
      details: { fileName: "second.pdf", late: true, lateBy: "30 minutes" },
    });
    expect(secondFile!.summary).toBe("Submitted Essay 1 (second.pdf), late by 30 minutes");

    expect(byType("MARK_CHANGED")[0]).toMatchObject({
      actor: { fullName: "Fatema Begum" },
      summary: "Mark changed for Essay 1: 55.0 to 62.5",
      details: { oldMark: "55.0", newMark: "62.5", reason: "Remark", assessmentTitle: "Essay 1" },
    });
    expect(byType("MARK_PUBLISHED")[0]).toMatchObject({
      summary: "Result published: Essay 1",
      details: { reason: null },
    });
    expect(byType("MARK_WITHHELD")[0]).toMatchObject({
      summary: "Result withheld: Essay 1",
      details: { reason: "Fees unpaid" },
    });
    expect(byType("MARK_UNPUBLISHED")[0]).toMatchObject({
      summary: "Result unpublished: Essay 1",
      details: { reason: "Checking" },
      actor: { fullName: "Fatema Begum" },
    });
  });

  it("shows a non-submission in a mark change as NS", async () => {
    const ctx = await setup();
    const assessment = await createAssessment({ moduleId: ctx.mod.id, createdById: ctx.officer.id });
    const mark = await createMark({
      assessmentId: assessment.id,
      studentId: ctx.student.id,
      enteredById: ctx.officer.id,
      mark: "40.0",
    });
    await db.markChange.create({
      data: {
        markId: mark.id,
        change: "MARK",
        oldMark: null,
        newMark: "40.0",
        reason: "Handed in on paper",
        changedById: ctx.officer.id,
        changedAt: at(1),
      },
    });
    const { body } = await timeline(ctx.student.id, ctx.cookie);
    expect(body.items[0]).toMatchObject({
      summary: expect.stringContaining("NS to 40.0"),
      details: { oldMark: null, newMark: "40.0" },
    });
  });

  it("judges a late flag against the student's own extension", async () => {
    const ctx = await setup();
    const assessment = await createAssessment({
      moduleId: ctx.mod.id,
      createdById: ctx.officer.id,
      deadline: at(1),
    });
    await createExtension({
      assessmentId: assessment.id,
      studentId: ctx.student.id,
      newDeadline: at(10),
    });
    const submission = await createSubmission({
      assessmentId: assessment.id,
      studentId: ctx.student.id,
      submittedAt: at(5),
    });
    await createSubmissionFile({ submissionId: submission.id, uploadedAt: at(5) });
    const { body } = await timeline(ctx.student.id, ctx.cookie);
    expect(body.items[0]).toMatchObject({ type: "SUBMISSION", details: { late: false } });
  });

  it("never includes another student's events", async () => {
    const ctx = await setup();
    await everything(ctx);
    const other = await createStudent({ programmeId: ctx.programme.id });
    const { body } = await timeline(other.id, ctx.cookie);
    expect(body.items).toEqual([]);
  });
});

describe("GET /api/students/{id}/timeline: paging", () => {
  it("pages by cursor: limit, then before=nextBefore, with no gaps or repeats", async () => {
    const ctx = await setup();
    await everything(ctx);
    const full = (await timeline(ctx.student.id, ctx.cookie)).body.items;

    const first = await timeline(ctx.student.id, ctx.cookie, "?limit=4");
    expect(first.body.items.map((e) => e.id)).toEqual(full.slice(0, 4).map((e) => e.id));
    expect(first.body.nextBefore).toBe(first.body.items[3]!.at);

    const collected = [...first.body.items];
    let cursor = first.body.nextBefore;
    let pages = 1;
    while (cursor) {
      const next = await timeline(
        ctx.student.id,
        ctx.cookie,
        `?limit=4&before=${encodeURIComponent(cursor)}`,
      );
      expect(next.status).toBe(200);
      collected.push(...next.body.items);
      cursor = next.body.nextBefore;
      pages += 1;
    }
    expect(pages).toBe(3);
    expect(collected.map((e) => e.id)).toEqual(full.map((e) => e.id));
  });

  it("has no next page when the last page is exactly full", async () => {
    const ctx = await setup();
    await everything(ctx);
    const { body } = await timeline(ctx.student.id, ctx.cookie, "?limit=10");
    expect(body.items).toHaveLength(10);
    expect(body.nextBefore).toBeNull();
  });

  it("defaults to 50 events per page", async () => {
    const ctx = await setup();
    await db.statusChange.createMany({
      data: Array.from({ length: 55 }, (_, i) => ({
        studentId: ctx.student.id,
        fromStatus: "ENROLLED" as const,
        toStatus: "DEFERRED" as const,
        changedById: ctx.officer.id,
        changedAt: at(i),
      })),
    });
    const first = await timeline(ctx.student.id, ctx.cookie);
    expect(first.body.items).toHaveLength(50);
    expect(first.body.nextBefore).not.toBeNull();
    const second = await timeline(
      ctx.student.id,
      ctx.cookie,
      `?before=${encodeURIComponent(first.body.nextBefore!)}`,
    );
    expect(second.body.items).toHaveLength(5);
    expect(second.body.nextBefore).toBeNull();
  });

  it("keeps events at the same instant together instead of splitting them across pages", async () => {
    const ctx = await setup();
    // A publish-all writes one row per mark at the same instant.
    for (let i = 0; i < 4; i += 1) await publishAt(ctx, 5);
    await db.statusChange.create({
      data: {
        studentId: ctx.student.id,
        toStatus: "ENROLLED",
        changedById: ctx.officer.id,
        changedAt: at(1),
      },
    });
    await db.statusChange.create({
      data: {
        studentId: ctx.student.id,
        fromStatus: "ENROLLED",
        toStatus: "DEFERRED",
        changedById: ctx.officer.id,
        changedAt: at(9),
      },
    });

    const first = await timeline(ctx.student.id, ctx.cookie, "?limit=2");
    // The deferral, then all four publishes (the tie), not just one of them.
    expect(first.body.items.map((e) => e.type)).toEqual([
      "STATUS_CHANGE",
      "MARK_PUBLISHED",
      "MARK_PUBLISHED",
      "MARK_PUBLISHED",
      "MARK_PUBLISHED",
    ]);
    expect(first.body.nextBefore).toBe(at(5).toISOString());

    const second = await timeline(
      ctx.student.id,
      ctx.cookie,
      `?limit=2&before=${encodeURIComponent(first.body.nextBefore!)}`,
    );
    expect(second.body.items.map((e) => e.details.toStatus)).toEqual(["ENROLLED"]);
    expect(second.body.nextBefore).toBeNull();
  });

  it("ends cleanly when the tie at the page boundary is the oldest thing there is", async () => {
    const ctx = await setup();
    for (let i = 0; i < 3; i += 1) await publishAt(ctx, 5);
    const { body } = await timeline(ctx.student.id, ctx.cookie, "?limit=2");
    expect(body.items).toHaveLength(3);
    expect(body.nextBefore).toBeNull();
  });
});
