import { describe, expect, it } from "vitest";
import { GET as marksheetCsvRoute } from "@/app/api/exports/marksheet/[file]/route";
import { GET as overdueCsvRoute } from "@/app/api/exports/overdue.csv/route";
import { db } from "@/lib/db";
import { todayIn } from "@/lib/services/rules/time";
import { BASE_URL, asStaff, asStudent } from "../../support/api";
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
  linkModule,
} from "../../support/factories";

// Integration tests for the CSV exports (api.md "Exports"): real Postgres, the Route Handlers called directly. The
// body is read as bytes, because `Response.text()` would strip the byte order mark this suite checks for.

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";
const DAY = 24 * 60 * 60 * 1000;

interface Download {
  status: number;
  headers: Headers;
  bytes: Uint8Array;
  /** The body as text, byte order mark kept. */
  text: string;
  /** Rows, header first, split on CRLF (no field in these tests holds a line break). */
  rows: string[];
}

async function download(
  handler: unknown,
  path: string,
  cookie: string | undefined,
  params: Record<string, string> = {},
): Promise<Download> {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  const response = await (
    handler as (r: Request, c: { params: Promise<unknown> }) => Promise<Response>
  )(new Request(`${BASE_URL}${path}`, { headers }), { params: Promise.resolve(params) });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
  return {
    status: response.status,
    headers: response.headers,
    bytes,
    text,
    rows: text.replace(/^﻿/, "").split("\r\n").filter(Boolean),
  };
}

const overdue = (cookie: string | undefined, query = "") =>
  download(overdueCsvRoute, `/api/exports/overdue.csv${query}`, cookie);
const marksheet = (cookie: string | undefined, file: string) =>
  download(marksheetCsvRoute, `/api/exports/marksheet/${file}`, cookie, { file });

async function setup() {
  const officer = await createStaff();
  const programme = await createProgramme({ code: "BSC-CSE" });
  return { officer, programme, cookie: asStaff(officer.id) };
}

/** A student whose only charge fell due `daysAgo` days ago and is unpaid. */
async function overdueStudent(
  programmeId: string,
  fullName: string,
  daysAgo: number,
  amount = "40000.00",
) {
  const student = await createStudent({ programmeId, fullName });
  const due = todayIn(new Date(Date.now() - daysAgo * DAY)); // a Dhaka calendar date, as the fee rule reads it
  await createFeeCharge({ studentId: student.id, amount, dueDate: due });
  return student;
}

describe("GET /api/exports/overdue.csv", () => {
  it("is staff only: no session 401, a student 403", async () => {
    const ctx = await setup();
    const student = await createStudent({ programmeId: ctx.programme.id });
    expect((await overdue(undefined)).status).toBe(401);
    expect((await overdue(asStudent(student.id))).status).toBe(403);
  });

  it("sends a UTF-8 CSV download with a byte order mark, CRLF lines and a dated file name", async () => {
    const ctx = await setup();
    await overdueStudent(ctx.programme.id, "Ayesha Rahman", 10);

    const file = await overdue(ctx.cookie);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(file.headers.get("cache-control")).toBe("no-store");
    const disposition = file.headers.get("content-disposition")!;
    expect(disposition).toMatch(/^attachment; filename="overdue-fees-\d{4}-\d{2}-\d{2}\.csv"/);
    expect([...file.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(file.text.endsWith("\r\n")).toBe(true);
    expect(file.rows[0]).toBe(
      "Student ID,Full name,Email,Programme code,Programme,Session,Year of study,Enrolment status,Overdue amount (BDT),Oldest overdue (days),Ageing bucket,Balance (BDT),Last payment date,Last payment amount (BDT)",
    );
  });

  it("lists only students with overdue fees, longest overdue first, with the ageing figures", async () => {
    const ctx = await setup();
    const recent = await overdueStudent(ctx.programme.id, "Recent Debtor", 5, "10000.00");
    const oldest = await overdueStudent(ctx.programme.id, "Oldest Debtor", 90, "25000.50");
    await createStudent({ programmeId: ctx.programme.id, fullName: "Clean Slate" });
    const paid = await overdueStudent(ctx.programme.id, "Paid Up", 30);
    await createPayment({ studentId: paid.id, staffId: ctx.officer.id, amount: "40000.00" });
    // Not due yet: owes money but is not overdue.
    const notDue = await createStudent({ programmeId: ctx.programme.id, fullName: "Not Due" });
    await createFeeCharge({ studentId: notDue.id, amount: "5000.00", dueDate: "2999-01-01" });

    const file = await overdue(ctx.cookie);
    expect(file.rows).toHaveLength(3);
    const [first, second] = file.rows.slice(1).map((row) => row.split(","));
    expect(first!.slice(0, 2)).toEqual([oldest.studentNumber, "Oldest Debtor"]);
    expect(first!.slice(8, 12)).toEqual(["25000.50", "90", "60+", "25000.50"]);
    expect(second!.slice(0, 2)).toEqual([recent.studentNumber, "Recent Debtor"]);
    expect(second!.slice(8, 11)).toEqual(["10000.00", "5", "1-30"]);
    expect(file.text).not.toContain("Paid Up");
    expect(file.text).not.toContain("Not Due");
    expect(file.text).not.toContain("Clean Slate");
  });

  it("includes a withdrawn student who still owes money", async () => {
    const ctx = await setup();
    const student = await overdueStudent(ctx.programme.id, "Habib Chowdhury", 45);
    await db.student.update({ where: { id: student.id }, data: { status: "WITHDRAWN" } });
    const file = await overdue(ctx.cookie);
    expect(file.rows[1]).toContain("Habib Chowdhury");
    expect(file.rows[1]).toContain("Withdrawn");
  });

  it("follows the ageing and programme filters", async () => {
    const ctx = await setup();
    const other = await createProgramme({ code: "BBA" });
    await overdueStudent(ctx.programme.id, "Old CSE", 90);
    await overdueStudent(ctx.programme.id, "Recent CSE", 5);
    await overdueStudent(other.id, "Old BBA", 90);

    const oldOnly = await overdue(ctx.cookie, "?ageingBucket=60%2B");
    expect(
      oldOnly.rows
        .slice(1)
        .map((row) => row.split(",")[1])
        .sort(),
    ).toEqual(["Old BBA", "Old CSE"]);
    const bba = await overdue(ctx.cookie, `?programmeId=${other.id}`);
    expect(bba.rows).toHaveLength(2);
    expect(bba.rows[1]).toContain("Old BBA");

    const bad = await overdue(ctx.cookie, "?ageingBucket=soon");
    expect(bad.status).toBe(400);
  });

  it("escapes commas and quotes, guards formulas and keeps Bengali text", async () => {
    const ctx = await setup();
    await overdueStudent(ctx.programme.id, 'Rahman, Ayesha "Aysha"', 10);
    await overdueStudent(ctx.programme.id, '=HYPERLINK("http://evil.example")', 20);
    await overdueStudent(ctx.programme.id, "@SUM(1+1)", 30);
    await overdueStudent(ctx.programme.id, "আয়েশা রহমান", 40);

    const file = await overdue(ctx.cookie);
    expect(file.text).toContain(',"Rahman, Ayesha ""Aysha""",');
    // A name that would run as a formula is written as text, with an apostrophe in front.
    expect(file.text).toContain(`,"'=HYPERLINK(""http://evil.example"")",`);
    expect(file.text).toContain(",'@SUM(1+1),");
    expect(file.text).not.toMatch(/,=HYPERLINK/);
    expect(file.text).toContain(",আয়েশা রহমান,");
  });
});

describe("GET /api/exports/marksheet/{assessmentId}.csv", () => {
  async function marksheetSetup() {
    const ctx = await setup();
    const mod = await createModule({ code: "CSE101", title: "Programming" });
    await linkModule(ctx.programme.id, mod.id);
    const assessment = await createAssessment({
      moduleId: mod.id,
      createdById: ctx.officer.id,
      title: "Essay 1: Ethics",
      deadline: new Date(Date.now() - 10 * DAY),
    });
    return { ...ctx, mod, assessment };
  }

  it("is staff only: no session 401, a student 403", async () => {
    const ctx = await marksheetSetup();
    const student = await createStudent({ programmeId: ctx.programme.id });
    const file = `${ctx.assessment.id}.csv`;
    expect((await marksheet(undefined, file)).status).toBe(401);
    expect((await marksheet(asStudent(student.id), file)).status).toBe(403);
  });

  it("answers 404 for an unknown or malformed assessment, or a name without .csv", async () => {
    const ctx = await marksheetSetup();
    for (const file of [
      `${UNKNOWN_ID}.csv`,
      "not-a-uuid.csv",
      ctx.assessment.id,
      `${ctx.assessment.id}.json`,
      ".csv",
    ]) {
      const result = await marksheet(ctx.cookie, file);
      expect(result.status, file).toBe(404);
      expect(result.headers.get("content-type")).toContain("application/json");
    }
  });

  it("exports every student on the marksheet with submission, mark and release status", async () => {
    const ctx = await marksheetSetup();
    const marked = await createStudent({
      programmeId: ctx.programme.id,
      fullName: "Ayesha Rahman",
    });
    const nonSubmitter = await createStudent({
      programmeId: ctx.programme.id,
      fullName: "Binte, Karim",
    });
    await createStudent({ programmeId: ctx.programme.id, fullName: "Chowdhury Unmarked" });
    await createSubmission({
      assessmentId: ctx.assessment.id,
      studentId: marked.id,
      submittedAt: new Date(ctx.assessment.deadline.getTime() + 2 * 60 * 60 * 1000),
    });
    await createMark({
      assessmentId: ctx.assessment.id,
      studentId: marked.id,
      enteredById: ctx.officer.id,
      mark: "62.5",
      releaseStatus: "PUBLISHED",
    });
    await createMark({
      assessmentId: ctx.assessment.id,
      studentId: nonSubmitter.id,
      enteredById: ctx.officer.id,
      mark: null,
      releaseStatus: "WITHHELD",
      withheldReason: "Fees unpaid, see note",
    });

    const file = await marksheet(ctx.cookie, `${ctx.assessment.id}.csv`);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(file.headers.get("content-disposition")).toMatch(
      /^attachment; filename="marksheet-cse101-essay-1-ethics-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    expect([...file.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(file.rows[0]).toBe(
      "Student ID,Full name,Programme code,Enrolment status,Currently eligible,Submission,Late by,Last submitted (Dhaka time),Mark,Classification,Release status,Withheld reason,Published at (Dhaka time)",
    );
    expect(file.rows).toHaveLength(4);

    const ayesha = file.rows.find((row) => row.includes("Ayesha Rahman"))!.split(",");
    expect(ayesha.slice(4, 7)).toEqual(["Yes", "Late", "2 hours"]);
    expect(ayesha.slice(8, 11)).toEqual(["62.5", "Merit", "Published"]);

    // A non-submission reads NS; the withheld reason (with a comma) is quoted; the name with a comma is quoted.
    const binte = file.rows.find((row) => row.includes("Binte"))!;
    expect(binte).toContain('"Binte, Karim"');
    expect(binte).toContain(",Not submitted,");
    expect(binte).toContain(",NS,NS,Withheld,");
    expect(binte).toContain('"Fees unpaid, see note"');

    // No mark yet: the mark, classification and release cells are empty.
    const empty = file.rows.find((row) => row.includes("Chowdhury Unmarked"))!;
    expect(empty).toMatch(/,Not submitted,{7}$/);
  });

  it("guards a formula-like name or reason", async () => {
    const ctx = await marksheetSetup();
    const student = await createStudent({
      programmeId: ctx.programme.id,
      fullName: "+cmd|' /C calc'!A0",
    });
    await createMark({
      assessmentId: ctx.assessment.id,
      studentId: student.id,
      enteredById: ctx.officer.id,
      releaseStatus: "WITHHELD",
      withheldReason: "=1+1",
    });
    const file = await marksheet(ctx.cookie, `${ctx.assessment.id}.csv`);
    expect(file.text).toContain(",'+cmd|' /C calc'!A0,");
    expect(file.text).toContain(",'=1+1,");
  });

  it("is just the header for an assessment nobody is on", async () => {
    const ctx = await marksheetSetup();
    const file = await marksheet(ctx.cookie, `${ctx.assessment.id}.csv`);
    expect(file.status).toBe(200);
    expect(file.rows).toHaveLength(1);
  });
});
