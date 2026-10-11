import { describe, expect, it } from "vitest";
import { GET as modulesRoute } from "@/app/api/modules/route";
import { PUT as scheduleRoute } from "@/app/api/programmes/[id]/fees/[academicYear]/route";
import { GET as readRoute } from "@/app/api/programmes/[id]/route";
import { GET as listRoute } from "@/app/api/programmes/route";
import { POST as createStudentRoute } from "@/app/api/students/route";
import { db } from "@/lib/db";
import { sessionFor, todayIn } from "@/lib/services/rules/time";
import { asStaff, asStudent, call } from "../../support/api";
import {
  createFeeCharge,
  createProgramme,
  createProgrammeFee,
  createStaff,
  createStudent,
} from "../../support/factories";

// Integration tests for programmes, modules and fee schedules (api.md "Programmes and modules").

type ErrorBody = {
  error: { code: string; message: string; details?: Record<string, unknown> };
};

interface ScheduleBody {
  academicYear: string;
  instalments: { instalment: number; amount: string; dueDate: string }[];
  total: string;
  billedStudents: number;
  warnings?: { code: string; message: string }[];
}

const SESSION = sessionFor(new Date());
const TODAY = todayIn(new Date());
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

function shiftDays(days: number): string {
  const [year, month, day] = TODAY.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

async function setup() {
  const staff = await createStaff();
  const programme = await createProgramme({ code: "BSC-CSE", name: "BSc CSE", durationYears: 4 });
  return { staff, programme, cookie: asStaff(staff.id) };
}

function put(cookie: string | undefined, programmeId: string, academicYear: string, body: unknown) {
  return call<ScheduleBody & ErrorBody>(scheduleRoute, {
    method: "PUT",
    path: `/api/programmes/${programmeId}/fees/${academicYear}`,
    cookie,
    params: { id: programmeId, academicYear },
    body,
  });
}

const row = (instalment: number, amount: string, dueDate: string) => ({
  instalment,
  amount,
  dueDate,
});

describe("access control", () => {
  const endpoints: {
    name: string;
    studentAllowed: boolean;
    run: (cookie?: string) => Promise<{ status: number }>;
  }[] = [
    {
      name: "GET /api/programmes",
      studentAllowed: true,
      run: (cookie) => call(listRoute, { path: "/api/programmes", cookie }),
    },
    {
      name: "GET /api/modules",
      studentAllowed: true,
      run: (cookie) => call(modulesRoute, { path: "/api/modules", cookie }),
    },
    {
      name: "GET /api/programmes/{id}",
      studentAllowed: false,
      run: (cookie) => call(readRoute, { path: "/x", cookie, params: { id: UNKNOWN_ID } }),
    },
    {
      name: "PUT /api/programmes/{id}/fees/{academicYear}",
      studentAllowed: false,
      run: (cookie) => put(cookie, UNKNOWN_ID, "2026-27", {}),
    },
  ];

  it.each(endpoints)("$name answers 401 without a session", async ({ run }) => {
    expect((await run()).status).toBe(401);
  });

  it.each(endpoints)("$name for a student", async ({ run, studentAllowed }) => {
    const student = await createStudent();
    const { status } = await run(asStudent(student.id));
    if (studentAllowed) expect(status).toBe(200);
    else expect(status).toBe(403);
  });
});

describe("GET /api/programmes and /api/modules", () => {
  it("lists programmes with their modules, and modules with their programmes", async () => {
    const { programme, cookie } = await setup();
    const other = await createProgramme({ code: "BBA", name: "BBA" });
    const databases = await db.module.create({ data: { code: "CSE201", title: "Databases" } });
    const maths = await db.module.create({ data: { code: "MAT101", title: "Mathematics" } });
    await db.programmeModule.createMany({
      data: [
        { programmeId: programme.id, moduleId: databases.id },
        { programmeId: programme.id, moduleId: maths.id },
        { programmeId: other.id, moduleId: maths.id },
      ],
    });

    const programmes = await call<{ items: { code: string; modules: { code: string }[] }[] }>(
      listRoute,
      {
        path: "/api/programmes",
        cookie,
      },
    );
    expect(programmes.body.items.map((p) => [p.code, p.modules.map((m) => m.code)])).toEqual([
      ["BBA", ["MAT101"]],
      ["BSC-CSE", ["CSE201", "MAT101"]],
    ]);

    const modules = await call<{ items: { code: string; programmes: { code: string }[] }[] }>(
      modulesRoute,
      {
        path: "/api/modules",
        cookie,
      },
    );
    expect(modules.body.items.map((m) => [m.code, m.programmes.map((p) => p.code)])).toEqual([
      ["CSE201", ["BSC-CSE"]],
      ["MAT101", ["BBA", "BSC-CSE"]],
    ]);
  });
});

describe("GET /api/programmes/{id}", () => {
  it("returns the fee schedules by session, newest first, with the students billed from each", async () => {
    const { programme, cookie } = await setup();
    await createProgrammeFee({
      programmeId: programme.id,
      academicYear: "2025-26",
      dueDate: "2025-09-01",
      amount: "150000.00",
    });
    const first = await createProgrammeFee({
      programmeId: programme.id,
      academicYear: SESSION,
      instalment: 1,
      amount: "80000.00",
      dueDate: shiftDays(-5),
    });
    await createProgrammeFee({
      programmeId: programme.id,
      academicYear: SESSION,
      instalment: 2,
      amount: "80000.50",
      dueDate: shiftDays(60),
    });
    const student = await createStudent({ programmeId: programme.id });
    await db.feeCharge.create({
      data: {
        studentId: student.id,
        programmeFeeId: first.id,
        kind: "PROGRAMME_FEE",
        academicYear: SESSION,
        description: "Tuition",
        amount: "80000.00",
        dueDate: new Date(`${shiftDays(-5)}T00:00:00.000Z`),
      },
    });

    const { status, body } = await call<{
      id: string;
      code: string;
      durationYears: number;
      feeSchedules: ScheduleBody[];
    }>(readRoute, {
      path: `/api/programmes/${programme.id}`,
      cookie,
      params: { id: programme.id },
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({ id: programme.id, code: "BSC-CSE", durationYears: 4 });
    expect(body.feeSchedules.map((s) => [s.academicYear, s.total, s.billedStudents])).toEqual([
      [SESSION, "160000.50", 1],
      ["2025-26", "150000.00", 0],
    ]);
    expect(body.feeSchedules[0]!.instalments).toEqual([
      row(1, "80000.00", shiftDays(-5)),
      row(2, "80000.50", shiftDays(60)),
    ]);
  });

  it("answers 404 for an unknown or malformed id", async () => {
    const { cookie } = await setup();
    for (const id of [UNKNOWN_ID, "nope"]) {
      expect(
        (await call(readRoute, { path: `/api/programmes/${id}`, cookie, params: { id } })).status,
      ).toBe(404);
    }
  });
});

describe("PUT /api/programmes/{id}/fees/{academicYear}", () => {
  it("creates a schedule for a new session, ignoring the order the instalments are sent in", async () => {
    const { programme, cookie } = await setup();
    const { status, body } = await put(cookie, programme.id, "2027-28", {
      instalments: [row(2, "60000", "2028-01-15"), row(1, "1,00,000.00", "2027-09-01")],
    });
    expect(status).toBe(200);
    expect(body).toEqual({
      academicYear: "2027-28",
      instalments: [row(1, "100000.00", "2027-09-01"), row(2, "60000.00", "2028-01-15")],
      total: "160000.00",
      billedStudents: 0,
    });
    expect(body.warnings).toBeUndefined();
  });

  it("replaces an existing schedule: amounts and dates change, extra instalments are removed", async () => {
    const { programme, cookie } = await setup();
    for (const instalment of [1, 2, 3]) {
      await createProgrammeFee({
        programmeId: programme.id,
        academicYear: "2027-28",
        instalment,
        amount: "10000.00",
        dueDate: "2027-10-01",
      });
    }
    const { status, body } = await put(cookie, programme.id, "2027-28", {
      instalments: [row(1, "30000.00", "2027-09-01"), row(2, "30000.00", "2028-01-01")],
    });
    expect(status).toBe(200);
    expect(body.instalments).toEqual([
      row(1, "30000.00", "2027-09-01"),
      row(2, "30000.00", "2028-01-01"),
    ]);
    expect(await db.programmeFee.count({ where: { programmeId: programme.id } })).toBe(2);
  });

  it("only touches the session in the URL and the programme in the URL", async () => {
    const { programme, cookie } = await setup();
    const other = await createProgramme({ code: "BBA", name: "BBA" });
    await createProgrammeFee({
      programmeId: programme.id,
      academicYear: "2026-27",
      dueDate: "2026-09-01",
      amount: "1.00",
    });
    await createProgrammeFee({
      programmeId: other.id,
      academicYear: "2027-28",
      dueDate: "2027-09-01",
      amount: "2.00",
    });
    await put(cookie, programme.id, "2027-28", { instalments: [row(1, "5000", "2027-09-01")] });
    const untouched = await db.programmeFee.findMany({ orderBy: { amount: "asc" } });
    expect(
      untouched.map((f) => [f.programmeId === programme.id, f.academicYear, f.amount.toFixed(2)]),
    ).toEqual([
      [true, "2026-27", "1.00"],
      [false, "2027-28", "2.00"],
      [true, "2027-28", "5000.00"],
    ]);
  });

  describe("existing charges never change", () => {
    async function billedStudent(
      programmeId: string,
      feeId: string,
      instalment: number,
      amount: string,
      dueDate: string,
    ) {
      const student = await createStudent({ programmeId });
      const charge = await db.feeCharge.create({
        data: {
          studentId: student.id,
          programmeFeeId: feeId,
          kind: "PROGRAMME_FEE",
          academicYear: SESSION,
          description: `Tuition ${SESSION}, instalment ${instalment}`,
          amount,
          dueDate: new Date(`${dueDate}T00:00:00.000Z`),
        },
      });
      return { student, charge };
    }

    it("leaves every FeeCharge row exactly as it was, warns, and bills only later students at the new figures", async () => {
      const { programme, cookie, staff } = await setup();
      const fee1 = await createProgrammeFee({
        programmeId: programme.id,
        academicYear: SESSION,
        instalment: 1,
        amount: "100000.00",
        dueDate: shiftDays(-10),
      });
      const fee2 = await createProgrammeFee({
        programmeId: programme.id,
        academicYear: SESSION,
        instalment: 2,
        amount: "100000.00",
        dueDate: shiftDays(60),
      });
      const a = await billedStudent(programme.id, fee1.id, 1, "100000.00", shiftDays(-10));
      const b = await billedStudent(programme.id, fee2.id, 2, "100000.00", shiftDays(60));
      await createFeeCharge({
        studentId: a.student.id,
        kind: "WAIVER",
        amount: "-5000.00",
        dueDate: shiftDays(-10),
      });
      const before = await db.feeCharge.findMany({ orderBy: [{ id: "asc" }] });

      const { status, body } = await put(cookie, programme.id, SESSION, {
        instalments: [row(1, "120000.00", shiftDays(-2)), row(2, "130000.00", shiftDays(90))],
      });
      expect(status).toBe(200);
      expect(body.instalments.map((i) => i.amount)).toEqual(["120000.00", "130000.00"]);
      expect(body.billedStudents).toBe(2);
      expect(body.warnings).toEqual([
        {
          code: "EXISTING_CHARGES_UNCHANGED",
          message: expect.stringContaining("2 students were already billed"),
        },
      ]);

      // The schedule rows changed in place; the charges that came from them are byte-for-byte the same.
      expect(await db.feeCharge.findMany({ orderBy: [{ id: "asc" }] })).toEqual(before);
      expect(
        (await db.feeCharge.findUniqueOrThrow({ where: { id: a.charge.id } })).programmeFeeId,
      ).toBe(fee1.id);
      expect(
        (await db.feeCharge.findUniqueOrThrow({ where: { id: b.charge.id } })).amount.toFixed(2),
      ).toBe("100000.00");

      // A student enrolled afterwards is billed the new figures.
      const created = await call<{ id: string; feeSummary: { charged: string } }>(
        createStudentRoute,
        {
          method: "POST",
          path: "/api/students",
          cookie: asStaff(staff.id),
          body: {
            fullName: "Newcomer Student",
            email: "newcomer@example.edu",
            dateOfBirth: "2005-03-14",
            programmeId: programme.id,
            academicYear: SESSION,
            yearOfStudy: 1,
          },
        },
      );
      expect(created.status).toBe(201);
      expect(created.body.feeSummary.charged).toBe("250000.00");
      const charges = await db.feeCharge.findMany({
        where: { studentId: created.body.id },
        orderBy: { dueDate: "asc" },
      });
      expect(charges.map((c) => c.amount.toFixed(2))).toEqual(["120000.00", "130000.00"]);
    });

    it("does not warn when nothing actually changes", async () => {
      const { programme, cookie } = await setup();
      const fee = await createProgrammeFee({
        programmeId: programme.id,
        academicYear: SESSION,
        amount: "100000.00",
        dueDate: "2026-09-01",
      });
      await billedStudent(programme.id, fee.id, 1, "100000.00", "2026-09-01");
      const { status, body } = await put(cookie, programme.id, SESSION, {
        instalments: [row(1, "100000", "2026-09-01")],
      });
      expect(status).toBe(200);
      expect(body.warnings).toBeUndefined();
    });

    it("refuses to remove an instalment students have been billed for (422) and changes nothing", async () => {
      const { programme, cookie } = await setup();
      await createProgrammeFee({
        programmeId: programme.id,
        academicYear: SESSION,
        instalment: 1,
        amount: "100000.00",
        dueDate: "2026-09-01",
      });
      const fee2 = await createProgrammeFee({
        programmeId: programme.id,
        academicYear: SESSION,
        instalment: 2,
        amount: "100000.00",
        dueDate: "2027-01-01",
      });
      await billedStudent(programme.id, fee2.id, 2, "100000.00", "2027-01-01");

      const { status, body } = await put(cookie, programme.id, SESSION, {
        instalments: [row(1, "999.00", "2026-09-01")],
      });
      expect(status).toBe(422);
      expect(body.error).toMatchObject({
        code: "BUSINESS_RULE",
        details: { rule: "FEE_INSTALMENT_IN_USE", instalments: [2] },
      });
      const fees = await db.programmeFee.findMany({
        where: { programmeId: programme.id },
        orderBy: { instalment: "asc" },
      });
      expect(fees.map((f) => f.amount.toFixed(2))).toEqual(["100000.00", "100000.00"]); // rolled back
    });
  });

  describe("validation", () => {
    it.each([
      ["no instalments", { instalments: [] }, "instalments"],
      ["no instalments key", {}, "instalments"],
      [
        "numbering that skips",
        { instalments: [row(1, "1", "2027-09-01"), row(3, "1", "2027-10-01")] },
        "instalments",
      ],
      ["numbering that starts at 2", { instalments: [row(2, "1", "2027-09-01")] }, "instalments"],
      [
        "a repeated number",
        { instalments: [row(1, "1", "2027-09-01"), row(1, "2", "2027-10-01")] },
        "instalments",
      ],
      ["a zero amount", { instalments: [row(1, "0", "2027-09-01")] }, "instalments.0.amount"],
      ["a negative amount", { instalments: [row(1, "-5", "2027-09-01")] }, "instalments.0.amount"],
      [
        "a fractional-paisa amount",
        { instalments: [row(1, "1.234", "2027-09-01")] },
        "instalments.0.amount",
      ],
      ["a bad due date", { instalments: [row(1, "1", "2027-02-30")] }, "instalments.0.dueDate"],
      [
        "a missing due date",
        { instalments: [{ instalment: 1, amount: "1" }] },
        "instalments.0.dueDate",
      ],
      [
        "a non-integer instalment number",
        { instalments: [{ ...row(1, "1", "2027-09-01"), instalment: 1.5 }] },
        "instalments.0.instalment",
      ],
      [
        "more than 12 instalments",
        { instalments: Array.from({ length: 13 }, (_, i) => row(i + 1, "1", "2027-09-01")) },
        "instalments",
      ],
    ])("rejects %s with 400", async (_name, body, field) => {
      const { programme, cookie } = await setup();
      const result = await put(cookie, programme.id, "2027-28", body);
      expect(result.status).toBe(400);
      expect(result.body.error.code).toBe("VALIDATION_ERROR");
      expect(result.body.error.details?.fieldErrors).toHaveProperty(field);
      expect(await db.programmeFee.count()).toBe(0);
    });

    it.each(["2027", "2027-29", "abcd-ef"])(
      "rejects the session %s with 400 on academicYear",
      async (session) => {
        const { programme, cookie } = await setup();
        const result = await put(cookie, programme.id, session, {
          instalments: [row(1, "1", "2027-09-01")],
        });
        expect(result.status).toBe(400);
        expect(result.body.error.details?.fieldErrors).toHaveProperty("academicYear");
      },
    );

    it("answers 404 for an unknown programme", async () => {
      const { cookie } = await setup();
      expect(
        (await put(cookie, UNKNOWN_ID, "2027-28", { instalments: [row(1, "1", "2027-09-01")] }))
          .status,
      ).toBe(404);
    });
  });

  it("copes with two simultaneous edits of the same schedule (one wins; no error)", async () => {
    const { programme, cookie } = await setup();
    const results = await Promise.all([
      put(cookie, programme.id, "2027-28", { instalments: [row(1, "1000", "2027-09-01")] }),
      put(cookie, programme.id, "2027-28", {
        instalments: [row(1, "2000", "2027-09-01"), row(2, "2000", "2028-01-01")],
      }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const fees = await db.programmeFee.findMany({ where: { programmeId: programme.id } });
    // Either edit may have gone last, but the schedule is one coherent edit, never a mix of both.
    const shape = fees.map((f) => f.amount.toFixed(2)).sort();
    expect([JSON.stringify(["1000.00"]), JSON.stringify(["2000.00", "2000.00"])]).toContain(
      JSON.stringify(shape),
    );
  });
});
