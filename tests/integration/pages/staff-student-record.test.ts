import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixedClock } from "@/lib/services/clock";
import { getStudentSubmissions } from "@/lib/services/submissions";
import { asStaff, asStudent } from "../../support/api";
import {
  createAssessment,
  createExtension,
  createModule,
  createProgramme,
  createStaff,
  createStudent,
  createSubmission,
  createSubmissionFile,
  linkModule,
} from "../../support/factories";

// The Submissions section of the staff student record (pages.md `/staff/students/[id]`): per assessment relevant to the
// student, the deadline, status badge with late-by, and every file version with its receipt. The page is a Server
// Component, so it is called directly with the signed role cookie served through a mocked `next/headers`, and the
// element it returns is rendered to HTML (same approach as student-pages.test.ts).

let currentCookie: string | undefined;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const [cookieName, value] = (currentCookie ?? "").split("=");
      return cookieName === name && value ? { name, value } : undefined;
    },
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  usePathname: () => "/staff/students/x",
}));

const { default: StudentRecordPage } = await import("@/app/staff/students/[id]/page");

const render = async (id: string) =>
  renderToStaticMarkup(
    (await (StudentRecordPage as (props: unknown) => Promise<ReactNode>)({
      params: Promise.resolve({ id }),
    })) as ReactNode,
  );

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date("2026-10-12T08:00:00.000Z");

async function setup() {
  const staff = await createStaff();
  const programme = await createProgramme();
  const mod = await createModule();
  await linkModule(programme.id, mod.id);
  const student = await createStudent({ programmeId: programme.id });
  const make = (overrides: { title?: string; deadline?: Date; closedAt?: Date | null } = {}) =>
    createAssessment({ moduleId: mod.id, createdById: staff.id, ...overrides });
  return { staff, programme, mod, student, make };
}

beforeEach(() => {
  currentCookie = undefined;
});

describe("getStudentSubmissions", () => {
  it("lists the programme's assessments and anything the student submitted to, with status and versions", async () => {
    const { staff, student, make } = await setup();
    const onTime = await make({ title: "On time essay", deadline: new Date(NOW.getTime() + DAY) });
    const late = await make({ title: "Late report", deadline: new Date(NOW.getTime() - 3 * DAY) });
    await make({
      title: "Never handed in",
      deadline: new Date(NOW.getTime() + 5 * DAY),
    });
    const closed = await make({
      title: "Closed project",
      deadline: new Date(NOW.getTime() - 10 * DAY),
      closedAt: new Date(NOW.getTime() - 9 * DAY),
    });

    const onTimeSub = await createSubmission({
      assessmentId: onTime.id,
      studentId: student.id,
      submittedAt: new Date(NOW.getTime() - HOUR),
    });
    await createSubmissionFile({
      submissionId: onTimeSub.id,
      uploadedAt: new Date(NOW.getTime() - HOUR),
      originalName: "essay-v1.pdf",
      sha256: "b".repeat(64),
    });
    const lateSub = await createSubmission({
      assessmentId: late.id,
      studentId: student.id,
      submittedAt: new Date(NOW.getTime() - DAY),
    });
    await createSubmissionFile({
      submissionId: lateSub.id,
      uploadedAt: new Date(NOW.getTime() - 4 * DAY),
      originalName: "report-draft.pdf",
    });
    await createSubmissionFile({
      submissionId: lateSub.id,
      uploadedAt: new Date(NOW.getTime() - DAY),
      originalName: "report-final.pdf",
    });

    // Not theirs: another programme's module.
    const foreignModule = await createModule();
    await createAssessment({
      moduleId: foreignModule.id,
      createdById: staff.id,
      title: "Foreign work",
    });

    const result = await getStudentSubmissions(student.id, fixedClock(NOW));
    const byTitle = new Map(result.items.map((item) => [item.title, item]));
    expect([...byTitle.keys()].sort()).toEqual(
      ["Closed project", "Late report", "Never handed in", "On time essay"].sort(),
    );

    expect(byTitle.get("On time essay")).toMatchObject({
      id: onTime.id,
      status: "ON_TIME",
      lateBy: null,
      submission: { currentFile: { fileName: "essay-v1.pdf", sha256: "b".repeat(64) } },
    });
    const lateItem = byTitle.get("Late report")!;
    expect(lateItem.status).toBe("LATE");
    expect(lateItem.lateBy).toBe("2 days");
    expect(lateItem.submission!.versions.map((v) => v.fileName)).toEqual([
      "report-final.pdf",
      "report-draft.pdf",
    ]);
    expect(lateItem.submission!.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(byTitle.get("Never handed in")).toMatchObject({
      status: "NOT_SUBMITTED",
      submission: null,
    });
    expect(byTitle.get("Closed project")).toMatchObject({ status: "CLOSED", id: closed.id });
  });

  it("includes an assessment from outside the programme once the student has submitted to it", async () => {
    const { staff, student } = await setup();
    const other = await createModule();
    const stray = await createAssessment({
      moduleId: other.id,
      createdById: staff.id,
      title: "Stray submission",
    });
    await createSubmission({
      assessmentId: stray.id,
      studentId: student.id,
      submittedAt: new Date(),
    });
    const result = await getStudentSubmissions(student.id);
    expect(result.items.map((item) => item.title)).toContain("Stray submission");
  });

  it("uses the student's own extended deadline, so the late flag follows it", async () => {
    const { student, make } = await setup();
    const assessment = await make({ deadline: new Date(NOW.getTime() - 2 * DAY) });
    const submission = await createSubmission({
      assessmentId: assessment.id,
      studentId: student.id,
      submittedAt: new Date(NOW.getTime() - DAY),
    });
    await createSubmissionFile({
      submissionId: submission.id,
      uploadedAt: submission.lastSubmittedAt,
    });

    const before = (await getStudentSubmissions(student.id, fixedClock(NOW))).items[0]!;
    expect(before.status).toBe("LATE");

    await createExtension({
      assessmentId: assessment.id,
      studentId: student.id,
      newDeadline: new Date(NOW.getTime() + DAY),
    });
    const after = (await getStudentSubmissions(student.id, fixedClock(NOW))).items[0]!;
    expect(after).toMatchObject({ status: "ON_TIME", extended: true, lateBy: null });
  });

  it("is an empty list when the programme has no assessments, and a 404 for an unknown or malformed id", async () => {
    const programme = await createProgramme();
    const student = await createStudent({ programmeId: programme.id });
    expect((await getStudentSubmissions(student.id)).items).toEqual([]);
    await expect(
      getStudentSubmissions("00000000-0000-4000-8000-000000000000"),
    ).rejects.toMatchObject({ status: 404 });
    await expect(getStudentSubmissions("not-a-uuid")).rejects.toMatchObject({ status: 404 });
  });
});

describe("/staff/students/[id] Submissions section", () => {
  it("shows the deadline, status with late-by, versions with receipts and Download buttons", async () => {
    const { staff, student, make } = await setup();
    const late = await make({ title: "Late report", deadline: new Date(Date.now() - 3 * DAY) });
    const submission = await createSubmission({
      assessmentId: late.id,
      studentId: student.id,
      submittedAt: new Date(Date.now() - DAY),
    });
    await createSubmissionFile({
      submissionId: submission.id,
      uploadedAt: new Date(Date.now() - 2 * DAY),
      originalName: "report-draft.pdf",
      sizeBytes: 2048,
      sha256: "c".repeat(64),
    });
    await createSubmissionFile({
      submissionId: submission.id,
      uploadedAt: new Date(Date.now() - DAY),
      originalName: "report-final.pdf",
      sizeBytes: 3 * 1024 * 1024,
      sha256: "d".repeat(64),
    });
    await make({ title: "Upcoming essay", deadline: new Date(Date.now() + 2 * DAY) });

    currentCookie = asStaff(staff.id);
    const html = await render(student.id);

    expect(html).toContain("Submissions");
    expect(html).not.toContain("Coming in");
    expect(html).toContain("Late report");
    expect(html).toContain("Upcoming essay");
    expect(html).toContain("Late"); // the status badge
    expect(html).toContain("1 of 2 assessments submitted");
    expect(html).toContain("Asia/Dhaka");
    // Current version plus one earlier version, each with its fingerprint and a Download button.
    expect(html).toContain("report-final.pdf");
    expect(html).toContain("report-draft.pdf");
    expect(html).toContain("d".repeat(64));
    expect(html).toContain("c".repeat(64));
    expect(html).toContain("1 earlier version");
    expect(html).toContain("Download report-final.pdf");
    expect(html).toContain("Download report-draft.pdf");
    expect(html).toContain("Nothing submitted yet");
  });

  it("explains an empty programme with guidance", async () => {
    const staff = await createStaff();
    const programme = await createProgramme();
    const student = await createStudent({ programmeId: programme.id });
    currentCookie = asStaff(staff.id);
    const html = await render(student.id);
    expect(html).toContain("No assessments yet");
  });

  it("is staff only: a student cookie is sent to the role picker, an unknown student is a 404", async () => {
    const { staff, student } = await setup();
    currentCookie = asStudent(student.id);
    await expect(render(student.id)).rejects.toThrow("NEXT_REDIRECT /");
    currentCookie = asStaff(staff.id);
    await expect(render("00000000-0000-4000-8000-000000000000")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
