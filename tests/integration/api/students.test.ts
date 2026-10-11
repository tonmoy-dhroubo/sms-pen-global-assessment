import { describe, expect, it } from "vitest";
import { GET as listRoute, POST as createRoute } from "@/app/api/students/route";
import { GET as readRoute, PATCH as patchRoute } from "@/app/api/students/[id]/route";
import { POST as statusRoute } from "@/app/api/students/[id]/status/route";
import { db } from "@/lib/db";
import { sessionFor, todayIn } from "@/lib/services/rules/time";
import { asStaff, asStudent, call } from "../../support/api";
import {
  createFeeCharge,
  createPayment,
  createProgramme,
  createProgrammeFee,
  createStaff,
  createStudent,
} from "../../support/factories";

// Integration tests for the enrolment endpoints (api.md "Students"): real Postgres, handlers called directly.

type ErrorBody = {
  error: { code: string; message: string; details?: Record<string, unknown> };
};

interface FeeSummaryBody {
  charged: string;
  waived: string;
  paid: string;
  balance: string;
  credit: string;
  overdueAmount: string;
  oldestOverdueDays: number | null;
  ageingBucket: string | null;
  nextDueDate: string | null;
  feeState: string;
}

interface StudentBody {
  id: string;
  studentNumber: string;
  fullName: string;
  email: string;
  dateOfBirth: string;
  programme: { id: string; code: string; name: string; durationYears: number };
  academicYear: string;
  yearOfStudy: number;
  status: string;
  version: number;
  feeSummary: FeeSummaryBody;
  warnings?: { code: string; message: string }[];
}

interface ListBody {
  items: (StudentBody & { programme: { id: string; code: string; name: string } })[];
  page: number;
  pageSize: number;
  total: number;
}

const SESSION = sessionFor(new Date()); // the current session, e.g. 2026-27
const SESSION_YEAR = Number(SESSION.slice(0, 4));
const TODAY = todayIn(new Date());

/** `YYYY-MM-DD` shifted by whole days / years from today (Dhaka), for dates of birth and due dates. */
function shiftDays(days: number, from: string = TODAY): string {
  const [year, month, day] = from.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
function yearsAgo(years: number, extraDays = 0): string {
  const [year, month, day] = TODAY.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year - years, month - 1, day));
  // Feb 29 in a non-leap year rolls to 1 March, which is how the rule treats that birthday as well.
  return shiftDays(extraDays, date.toISOString().slice(0, 10));
}

async function setup() {
  const staff = await createStaff();
  const programme = await createProgramme({ code: "BSC-CSE", name: "BSc CSE", durationYears: 4 });
  return { staff, programme, cookie: asStaff(staff.id) };
}

function newStudentBody(programmeId: string, overrides: Record<string, unknown> = {}) {
  return {
    fullName: "Ayesha Rahman",
    email: "ayesha.rahman@example.edu",
    dateOfBirth: "2005-03-14",
    programmeId,
    academicYear: SESSION,
    yearOfStudy: 1,
    ...overrides,
  };
}

async function create(cookie: string, body: unknown) {
  return call<StudentBody & ErrorBody>(createRoute, {
    method: "POST",
    path: "/api/students",
    cookie,
    body,
  });
}

describe("access control", () => {
  const endpoints: { name: string; run: (cookie?: string) => Promise<{ status: number }> }[] = [
    {
      name: "GET /api/students",
      run: (cookie) => call(listRoute, { path: "/api/students", cookie }),
    },
    {
      name: "POST /api/students",
      run: (cookie) =>
        call(createRoute, { method: "POST", path: "/api/students", cookie, body: {} }),
    },
    {
      name: "GET /api/students/{id}",
      run: (cookie) =>
        call(readRoute, {
          path: "/api/students/x",
          cookie,
          params: { id: "00000000-0000-4000-8000-000000000000" },
        }),
    },
    {
      name: "PATCH /api/students/{id}",
      run: (cookie) =>
        call(patchRoute, {
          method: "PATCH",
          path: "/api/students/x",
          cookie,
          body: {},
          params: { id: "00000000-0000-4000-8000-000000000000" },
        }),
    },
    {
      name: "POST /api/students/{id}/status",
      run: (cookie) =>
        call(statusRoute, {
          method: "POST",
          path: "/api/students/x/status",
          cookie,
          body: {},
          params: { id: "00000000-0000-4000-8000-000000000000" },
        }),
    },
  ];

  it.each(endpoints)("$name answers 401 without a session", async ({ run }) => {
    expect((await run()).status).toBe(401);
  });

  it.each(endpoints)(
    "$name answers 403 to a student, before looking at the input",
    async ({ run }) => {
      const student = await createStudent();
      expect((await run(asStudent(student.id))).status).toBe(403);
    },
  );
});

describe("POST /api/students", () => {
  it("creates the student with the next Student ID, an initial status change and the fee schedule", async () => {
    const { programme, staff, cookie } = await setup();
    await createProgrammeFee({
      programmeId: programme.id,
      academicYear: SESSION,
      instalment: 1,
      amount: "160000.00",
      dueDate: shiftDays(-10),
    });
    await createProgrammeFee({
      programmeId: programme.id,
      academicYear: SESSION,
      instalment: 2,
      amount: "160000.00",
      dueDate: shiftDays(90),
    });

    const first = await create(cookie, newStudentBody(programme.id));
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      studentNumber: `SMS-${SESSION_YEAR}-0001`,
      fullName: "Ayesha Rahman",
      email: "ayesha.rahman@example.edu",
      dateOfBirth: "2005-03-14",
      academicYear: SESSION,
      yearOfStudy: 1,
      status: "ENROLLED",
      version: 1,
      programme: { id: programme.id, code: "BSC-CSE", name: "BSc CSE", durationYears: 4 },
    });
    expect(first.body.warnings).toBeUndefined();
    // First instalment is overdue, the second not yet due; nothing paid.
    expect(first.body.feeSummary).toMatchObject({
      charged: "320000.00",
      paid: "0.00",
      balance: "320000.00",
      overdueAmount: "160000.00",
      oldestOverdueDays: 10,
      feeState: "overdue",
      nextDueDate: shiftDays(90),
    });

    const second = await create(
      cookie,
      newStudentBody(programme.id, { fullName: "Tanvir Hasan", email: "tanvir@example.edu" }),
    );
    expect(second.body.studentNumber).toBe(`SMS-${SESSION_YEAR}-0002`);

    const history = await db.statusChange.findMany({ where: { studentId: first.body.id } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      fromStatus: null,
      toStatus: "ENROLLED",
      reason: null,
      changedById: staff.id,
    });

    const charges = await db.feeCharge.findMany({
      where: { studentId: first.body.id },
      orderBy: { dueDate: "asc" },
    });
    expect(
      charges.map((c) => [c.kind, c.description, c.amount.toFixed(2), c.academicYear]),
    ).toEqual([
      ["PROGRAMME_FEE", `Tuition ${SESSION}, instalment 1`, "160000.00", SESSION],
      ["PROGRAMME_FEE", `Tuition ${SESSION}, instalment 2`, "160000.00", SESSION],
    ]);
    expect(charges.every((c) => c.programmeFeeId !== null)).toBe(true);
  });

  it("describes a single-instalment schedule without the instalment number", async () => {
    const { programme, cookie } = await setup();
    await createProgrammeFee({
      programmeId: programme.id,
      academicYear: SESSION,
      dueDate: shiftDays(30),
    });
    const { body } = await create(cookie, newStudentBody(programme.id));
    const charge = await db.feeCharge.findFirstOrThrow({ where: { studentId: body.id } });
    expect(charge.description).toBe(`Tuition ${SESSION}`);
  });

  it("warns, and creates no charges, when the programme has no schedule for that session", async () => {
    const { programme, cookie } = await setup();
    await createProgrammeFee({
      programmeId: programme.id,
      academicYear: "2020-21",
      dueDate: "2020-09-01",
    });
    const { status, body } = await create(cookie, newStudentBody(programme.id));
    expect(status).toBe(201);
    expect(body.warnings).toEqual([expect.objectContaining({ code: "NO_FEE_SCHEDULE" })]);
    expect(await db.feeCharge.count()).toBe(0);
    expect(body.feeSummary.charged).toBe("0.00");
  });

  it("numbers per session: the ID carries the start year of the session the student enrols into", async () => {
    const { programme, cookie } = await setup();
    const earlier = await create(cookie, newStudentBody(programme.id, { academicYear: "2025-26" }));
    const later = await create(
      cookie,
      newStudentBody(programme.id, {
        fullName: "Someone Else",
        email: "else@example.edu",
        academicYear: "2026-27",
      }),
    );
    const another = await create(
      cookie,
      newStudentBody(programme.id, {
        fullName: "Third Person",
        email: "third@example.edu",
        academicYear: "2025-26",
      }),
    );
    expect(earlier.body.studentNumber).toBe("SMS-2025-0001");
    expect(later.body.studentNumber).toBe("SMS-2026-0001");
    expect(another.body.studentNumber).toBe("SMS-2025-0002");
  });

  it("gives parallel creations distinct, gap-free numbers", async () => {
    const { programme, cookie } = await setup();
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        create(
          cookie,
          newStudentBody(programme.id, {
            fullName: `Parallel Student ${index}`,
            email: `p${index}@example.edu`,
          }),
        ),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    const numbers = results.map((r) => r.body.studentNumber).sort();
    expect(numbers).toEqual(
      Array.from({ length: 6 }, (_, i) => `SMS-${SESSION_YEAR}-${String(i + 1).padStart(4, "0")}`),
    );
  });

  it("trims and lower-cases the email, and tidies the name", async () => {
    const { programme, cookie } = await setup();
    const { status, body } = await create(
      cookie,
      newStudentBody(programme.id, {
        fullName: "  Ayesha   Rahman ",
        email: "  Ayesha.Rahman@Example.EDU ",
      }),
    );
    expect(status).toBe(201);
    expect(body.email).toBe("ayesha.rahman@example.edu");
    expect(body.fullName).toBe("Ayesha Rahman");
  });

  describe("email conflicts", () => {
    it("answers 409 CONFLICT pointing at the existing record, whatever the case", async () => {
      const { programme, cookie } = await setup();
      const existing = await create(cookie, newStudentBody(programme.id));
      const { status, body } = await create(
        cookie,
        newStudentBody(programme.id, {
          fullName: "Other Person",
          email: "AYESHA.RAHMAN@example.edu",
        }),
      );
      expect(status).toBe(409);
      expect(body.error.code).toBe("CONFLICT");
      expect(body.error.details).toMatchObject({
        field: "email",
        existing: {
          id: existing.body.id,
          studentNumber: existing.body.studentNumber,
          fullName: "Ayesha Rahman",
        },
      });
      expect(await db.student.count()).toBe(1);
    });

    it("reports the email clash before a duplicate warning when both apply", async () => {
      const { programme, cookie } = await setup();
      await create(cookie, newStudentBody(programme.id));
      const { status, body } = await create(cookie, newStudentBody(programme.id));
      expect(status).toBe(409);
      expect(body.error.code).toBe("CONFLICT");
    });

    it("lets exactly one of two simultaneous saves win, and burns no Student ID", async () => {
      const { programme, cookie } = await setup();
      const [a, b] = await Promise.all([
        create(
          cookie,
          newStudentBody(programme.id, { fullName: "Racer One", dateOfBirth: "2004-01-01" }),
        ),
        create(
          cookie,
          newStudentBody(programme.id, { fullName: "Racer Two", dateOfBirth: "2003-02-02" }),
        ),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      const loser = a.status === 409 ? a : b;
      expect(loser.body.error.code).toBe("CONFLICT");
      // The next student gets number 2: the failed attempt's number was rolled back with its transaction.
      const next = await create(
        cookie,
        newStudentBody(programme.id, { fullName: "Next Person", email: "next@example.edu" }),
      );
      expect(next.body.studentNumber).toBe(`SMS-${SESSION_YEAR}-0002`);
    });
  });

  describe("probable duplicates", () => {
    it("warns with the matches when name and date of birth match under a different email", async () => {
      const { programme, cookie } = await setup();
      const existing = await create(cookie, newStudentBody(programme.id));
      const { status, body } = await create(
        cookie,
        newStudentBody(programme.id, { email: "ayesha.second@example.edu" }),
      );
      expect(status).toBe(409);
      expect(body.error.code).toBe("DUPLICATE_WARNING");
      expect(body.error.details?.matches).toEqual([
        {
          id: existing.body.id,
          studentNumber: existing.body.studentNumber,
          fullName: "Ayesha Rahman",
          email: "ayesha.rahman@example.edu",
          dateOfBirth: "2005-03-14",
          status: "ENROLLED",
          programme: { id: programme.id, code: "BSC-CSE", name: "BSc CSE" },
        },
      ]);
      expect(await db.student.count()).toBe(1);
    });

    it("ignores case, accents and spacing in the name, and counts withdrawn students", async () => {
      const { programme, cookie } = await setup();
      await createStudent({
        fullName: "José García",
        programmeId: programme.id,
        status: "WITHDRAWN",
        dateOfBirth: new Date("2004-03-09"),
      });
      const { status, body } = await create(
        cookie,
        newStudentBody(programme.id, {
          fullName: "  JOSE   garcia ",
          email: "jose@example.edu",
          dateOfBirth: "2004-03-09",
        }),
      );
      expect(status).toBe(409);
      expect(body.error.code).toBe("DUPLICATE_WARNING");
    });

    it("does not warn when only the name or only the date of birth matches", async () => {
      const { programme, cookie } = await setup();
      await create(cookie, newStudentBody(programme.id));
      const sameNameOtherDob = await create(
        cookie,
        newStudentBody(programme.id, { email: "a2@example.edu", dateOfBirth: "2005-03-15" }),
      );
      const sameDobOtherName = await create(
        cookie,
        newStudentBody(programme.id, { email: "a3@example.edu", fullName: "Someone Different" }),
      );
      expect(sameNameOtherDob.status).toBe(201);
      expect(sameDobOtherName.status).toBe(201);
    });

    it("creates the student when the warning is confirmed", async () => {
      const { programme, cookie } = await setup();
      await create(cookie, newStudentBody(programme.id));
      const { status, body } = await create(
        cookie,
        newStudentBody(programme.id, {
          email: "ayesha.second@example.edu",
          confirmDuplicate: true,
        }),
      );
      expect(status).toBe(201);
      expect(body.studentNumber).toBe(`SMS-${SESSION_YEAR}-0002`);
      expect(await db.student.count()).toBe(2);
    });
  });

  describe("date of birth", () => {
    it("rejects a date in the future", async () => {
      const { programme, cookie } = await setup();
      const { status, body } = await create(
        cookie,
        newStudentBody(programme.id, { dateOfBirth: shiftDays(1) }),
      );
      expect(status).toBe(400);
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.details?.fieldErrors).toEqual({
        dateOfBirth: ["Date of birth cannot be in the future."],
      });
    });

    it.each([
      ["turns 16 tomorrow", () => yearsAgo(16, 1), 400],
      ["turns 16 today", () => yearsAgo(16), 201],
      ["turned 16 yesterday", () => yearsAgo(16, -1), 201],
      ["turns 100 today", () => yearsAgo(100), 201],
      ["turned 101 yesterday", () => yearsAgo(101, -1), 400],
      ["turns 101 today", () => yearsAgo(101), 400],
    ])("a student who %s: %d", async (_label, dateOfBirth, expected) => {
      const { programme, cookie } = await setup();
      const { status } = await create(
        cookie,
        newStudentBody(programme.id, { dateOfBirth: dateOfBirth() }),
      );
      expect(status).toBe(expected);
    });

    it("says why: too young and too old", async () => {
      const { programme, cookie } = await setup();
      const young = await create(
        cookie,
        newStudentBody(programme.id, { dateOfBirth: yearsAgo(10) }),
      );
      const old = await create(
        cookie,
        newStudentBody(programme.id, { dateOfBirth: yearsAgo(120) }),
      );
      expect(young.body.error.details?.fieldErrors).toEqual({
        dateOfBirth: ["Students must be at least 16 years old."],
      });
      expect(old.body.error.details?.fieldErrors).toEqual({
        dateOfBirth: ["Students must be at most 100 years old."],
      });
    });

    it.each(["14/03/2005", "2005-13-01", "2005-02-30", ""])(
      "rejects %j as not a date",
      async (value) => {
        const { programme, cookie } = await setup();
        const { status, body } = await create(
          cookie,
          newStudentBody(programme.id, { dateOfBirth: value }),
        );
        expect(status).toBe(400);
        expect(Object.keys(body.error.details?.fieldErrors as object)).toEqual(["dateOfBirth"]);
      },
    );
  });

  describe("validation", () => {
    it("lists every missing or invalid field at once", async () => {
      const { cookie } = await setup();
      const { status, body } = await create(cookie, {
        fullName: "A",
        email: "not-an-email",
        academicYear: "2026/27",
        yearOfStudy: 0,
      });
      expect(status).toBe(400);
      expect(Object.keys(body.error.details?.fieldErrors as object).sort()).toEqual([
        "academicYear",
        "dateOfBirth",
        "email",
        "fullName",
        "programmeId",
        "yearOfStudy",
      ]);
    });

    it("rejects a session label that is not consecutive", async () => {
      const { programme, cookie } = await setup();
      const { status } = await create(
        cookie,
        newStudentBody(programme.id, { academicYear: "2026-29" }),
      );
      expect(status).toBe(400);
    });

    it("rejects a programme that does not exist", async () => {
      const { cookie } = await setup();
      const { status, body } = await create(
        cookie,
        newStudentBody("00000000-0000-4000-8000-000000000000"),
      );
      expect(status).toBe(400);
      expect(body.error.details?.fieldErrors).toEqual({ programmeId: ["Choose a programme."] });
    });

    it("rejects a year of study beyond the programme's length", async () => {
      const { programme, cookie } = await setup();
      const { status, body } = await create(
        cookie,
        newStudentBody(programme.id, { yearOfStudy: 5 }),
      );
      expect(status).toBe(400);
      expect(Object.keys(body.error.details?.fieldErrors as object)).toEqual(["yearOfStudy"]);
    });

    it("rejects a body that is not JSON", async () => {
      const { cookie } = await setup();
      const { status } = await create(cookie, "{not json");
      expect(status).toBe(400);
    });
  });
});

describe("GET /api/students", () => {
  async function seedStudents() {
    const { programme, cookie, staff } = await setup();
    const other = await createProgramme({ code: "BBA", name: "BBA" });
    const make = (n: number, o: Parameters<typeof createStudent>[0] = {}) =>
      createStudent({
        programmeId: programme.id,
        studentNumber: `SMS-2026-${String(n).padStart(4, "0")}`,
        ...o,
      });
    return { programme, other, cookie, staff, make };
  }

  const list = (cookie: string, query = "") =>
    call<ListBody & ErrorBody>(listRoute, { path: `/api/students${query}`, cookie });

  it("hides withdrawn and completed students by default", async () => {
    const { cookie, make } = await seedStudents();
    await make(1, { fullName: "Enrolled One" });
    await make(2, { fullName: "Deferred Two", status: "DEFERRED" });
    await make(3, { fullName: "Withdrawn Three", status: "WITHDRAWN" });
    await make(4, { fullName: "Completed Four", status: "COMPLETED" });

    const { status, body } = await list(cookie);
    expect(status).toBe(200);
    expect(body.items.map((s) => s.fullName)).toEqual(["Deferred Two", "Enrolled One"]);
    expect(body).toMatchObject({ page: 1, pageSize: 25, total: 2 });
  });

  it("shows exactly the statuses asked for, repeatable", async () => {
    const { cookie, make } = await seedStudents();
    await make(1, { fullName: "Enrolled One" });
    await make(3, { fullName: "Withdrawn Three", status: "WITHDRAWN" });
    await make(4, { fullName: "Completed Four", status: "COMPLETED" });

    const withdrawn = await list(cookie, "?status=WITHDRAWN");
    expect(withdrawn.body.items.map((s) => s.fullName)).toEqual(["Withdrawn Three"]);

    const both = await list(cookie, "?status=WITHDRAWN&status=COMPLETED");
    expect(both.body.items.map((s) => s.fullName)).toEqual(["Completed Four", "Withdrawn Three"]);

    const all = await list(
      cookie,
      "?status=ENROLLED&status=DEFERRED&status=WITHDRAWN&status=COMPLETED",
    );
    expect(all.body.total).toBe(3);
  });

  it("rejects an unknown status", async () => {
    const { cookie } = await seedStudents();
    const { status } = await list(cookie, "?status=GRADUATED");
    expect(status).toBe(400);
  });

  describe("search", () => {
    it("finds a partial Student ID", async () => {
      const { cookie, make } = await seedStudents();
      await make(7, { fullName: "Seven Student" });
      await make(17, { fullName: "Seventeen Student" });
      await make(23, { fullName: "Other Student" });

      expect((await list(cookie, "?q=0007")).body.items.map((s) => s.studentNumber)).toEqual([
        "SMS-2026-0007",
      ]);
      expect((await list(cookie, "?q=sms-2026-0023")).body.items).toHaveLength(1);
      expect((await list(cookie, "?q=2026")).body.total).toBe(3);
    });

    it("finds names regardless of case and accents", async () => {
      const { cookie, make } = await seedStudents();
      await make(1, { fullName: "José García" });
      await make(2, { fullName: "Zoë Müller" });
      await make(3, { fullName: "Ayesha Rahman" });

      for (const q of ["jose", "JOSÉ", "garcia", "García", "jose gar", "ose garc"]) {
        const { body } = await list(cookie, `?q=${encodeURIComponent(q)}`);
        expect(
          body.items.map((s) => s.fullName),
          q,
        ).toEqual(["José García"]);
      }
      expect((await list(cookie, "?q=zoe%20muller")).body.items.map((s) => s.fullName)).toEqual([
        "Zoë Müller",
      ]);
      expect((await list(cookie, "?q=ayesha")).body.items).toHaveLength(1);
    });

    it("finds an email address, whole or in part", async () => {
      const { cookie, make } = await seedStudents();
      await make(1, { fullName: "Alpha", email: "alpha.one@registry.example.edu" });
      await make(2, { fullName: "Beta", email: "beta@elsewhere.org" });

      expect(
        (await list(cookie, "?q=alpha.one%40registry")).body.items.map((s) => s.fullName),
      ).toEqual(["Alpha"]);
      expect((await list(cookie, "?q=ELSEWHERE")).body.items.map((s) => s.fullName)).toEqual([
        "Beta",
      ]);
    });

    it("treats % and _ as ordinary characters", async () => {
      const { cookie, make } = await seedStudents();
      await make(1, { fullName: "Plain Name" });
      await make(2, { fullName: "Fifty% Off" });
      expect(
        (await list(cookie, `?q=${encodeURIComponent("%")}`)).body.items.map((s) => s.fullName),
      ).toEqual(["Fifty% Off"]);
      expect((await list(cookie, "?q=_")).body.total).toBe(0);
    });

    it("does not reveal withdrawn students unless asked, even when they match", async () => {
      const { cookie, make } = await seedStudents();
      await make(1, { fullName: "Habib Left", status: "WITHDRAWN" });
      expect((await list(cookie, "?q=habib")).body.total).toBe(0);
      expect((await list(cookie, "?q=habib&status=WITHDRAWN")).body.total).toBe(1);
    });
  });

  describe("filters", () => {
    it("filters by programme, session and year of study", async () => {
      const { cookie, make, other } = await seedStudents();
      await make(1, { fullName: "Cse Year One" });
      await make(2, { fullName: "Cse Year Two", yearOfStudy: 2 });
      await make(3, { fullName: "Bba Student", programmeId: other.id });
      await make(4, { fullName: "Old Session", academicYear: "2025-26" });

      expect(
        (await list(cookie, `?programmeId=${other.id}`)).body.items.map((s) => s.fullName),
      ).toEqual(["Bba Student"]);
      expect((await list(cookie, "?yearOfStudy=2")).body.items.map((s) => s.fullName)).toEqual([
        "Cse Year Two",
      ]);
      expect(
        (await list(cookie, "?academicYear=2025-26")).body.items.map((s) => s.fullName),
      ).toEqual(["Old Session"]);
      expect(
        (await list(cookie, `?academicYear=2026-27&yearOfStudy=2&programmeId=${other.id}`)).body
          .total,
      ).toBe(0);
    });

    it("includes the fee summary and overdue age on every row", async () => {
      const { cookie, make, staff } = await seedStudents();
      const owes = await make(1, { fullName: "Owes Money" });
      await createFeeCharge({ studentId: owes.id, amount: "100000.00", dueDate: shiftDays(-45) });
      await createPayment({ studentId: owes.id, staffId: staff.id, amount: "40000.00" });

      const { body } = await list(cookie);
      expect(body.items[0]!.feeSummary).toEqual({
        charged: "100000.00",
        waived: "0.00",
        paid: "40000.00",
        balance: "60000.00",
        credit: "0.00",
        overdueAmount: "60000.00",
        oldestOverdueDays: 45,
        ageingBucket: "31-60",
        nextDueDate: null,
        feeState: "overdue",
      });
    });

    it("filters by fee state using the M04 rule (voided payments ignored, oldest charge settled first)", async () => {
      const { cookie, make, staff } = await seedStudents();
      const overdue = await make(1, { fullName: "Overdue Student" });
      await createFeeCharge({ studentId: overdue.id, amount: "100000.00", dueDate: shiftDays(-5) });

      const outstanding = await make(2, { fullName: "Outstanding Student" });
      await createFeeCharge({
        studentId: outstanding.id,
        amount: "100000.00",
        dueDate: shiftDays(30),
      });

      const credit = await make(3, { fullName: "Credit Student" });
      await createFeeCharge({ studentId: credit.id, amount: "100000.00", dueDate: shiftDays(-5) });
      await createPayment({ studentId: credit.id, staffId: staff.id, amount: "120000.00" });

      const paid = await make(4, { fullName: "Paid Student" });
      await createFeeCharge({ studentId: paid.id, amount: "100000.00", dueDate: shiftDays(-5) });
      await createPayment({ studentId: paid.id, staffId: staff.id, amount: "100000.00" });

      // A voided payment must not count: this student is still overdue.
      const voided = await make(5, { fullName: "Voided Payment Student" });
      await createFeeCharge({ studentId: voided.id, amount: "100000.00", dueDate: shiftDays(-5) });
      await createPayment({
        studentId: voided.id,
        staffId: staff.id,
        amount: "100000.00",
        voided: true,
      });

      // An overdue charge and a later one not yet due: payments settle the OLDEST charge first (D-028), so 100,000
      // covers the overdue one and the student only has something outstanding.
      const settledOldest = await make(6, { fullName: "Settled Oldest" });
      await createFeeCharge({
        studentId: settledOldest.id,
        amount: "100000.00",
        dueDate: shiftDays(-5),
      });
      await createFeeCharge({
        studentId: settledOldest.id,
        amount: "100000.00",
        dueDate: shiftDays(60),
      });
      await createPayment({ studentId: settledOldest.id, staffId: staff.id, amount: "100000.00" });

      const names = async (feeState: string) =>
        (await list(cookie, `?feeState=${feeState}`)).body.items.map((s) => s.fullName);

      expect(await names("overdue")).toEqual(["Overdue Student", "Voided Payment Student"]);
      expect(await names("outstanding")).toEqual(["Outstanding Student", "Settled Oldest"]);
      expect(await names("credit")).toEqual(["Credit Student"]);
      expect(await names("paid")).toEqual(["Paid Student"]);
    });

    it("keeps a withdrawn student who still owes money on the overdue list when asked for", async () => {
      const { cookie, make } = await seedStudents();
      const gone = await make(1, { fullName: "Left Owing", status: "WITHDRAWN" });
      await createFeeCharge({ studentId: gone.id, amount: "50000.00", dueDate: shiftDays(-70) });
      const body = (await list(cookie, "?feeState=overdue&status=WITHDRAWN")).body;
      expect(body.items.map((s) => s.fullName)).toEqual(["Left Owing"]);
      expect(body.items[0]!.feeSummary.ageingBucket).toBe("60+");
    });

    it("pages the fee-state results and reports the filtered total", async () => {
      const { cookie, make } = await seedStudents();
      for (let n = 1; n <= 5; n++) {
        const student = await make(n, { fullName: `Overdue ${n}` });
        await createFeeCharge({ studentId: student.id, amount: "1000.00", dueDate: shiftDays(-1) });
      }
      await make(6, { fullName: "Fine Student" });
      const page2 = await list(cookie, "?feeState=overdue&pageSize=2&page=2");
      expect(page2.body.items.map((s) => s.fullName)).toEqual(["Overdue 3", "Overdue 4"]);
      expect(page2.body).toMatchObject({ page: 2, pageSize: 2, total: 5 });
    });
  });

  describe("sorting and paging", () => {
    it("sorts by name (accent-insensitive) by default, and either way on request", async () => {
      const { cookie, make } = await seedStudents();
      await make(1, { fullName: "Émile Zola" });
      await make(2, { fullName: "Adam Smith" });
      await make(3, { fullName: "Zed Last" });

      const names = async (q: string) => (await list(cookie, q)).body.items.map((s) => s.fullName);
      expect(await names("")).toEqual(["Adam Smith", "Émile Zola", "Zed Last"]);
      expect(await names("?sort=-fullName")).toEqual(["Zed Last", "Émile Zola", "Adam Smith"]);
      expect(await names("?sort=-studentNumber")).toEqual(["Zed Last", "Adam Smith", "Émile Zola"]);
    });

    it("sorts by programme, session, year of study and status", async () => {
      const { cookie, make, other } = await seedStudents();
      await make(1, { fullName: "B", yearOfStudy: 3, academicYear: "2024-25" });
      await make(2, { fullName: "A", programmeId: other.id, yearOfStudy: 1 });
      const names = async (q: string) => (await list(cookie, q)).body.items.map((s) => s.fullName);
      expect(await names("?sort=programme")).toEqual(["A", "B"]); // BBA before BSC-CSE
      expect(await names("?sort=-yearOfStudy")).toEqual(["B", "A"]);
      expect(await names("?sort=academicYear")).toEqual(["B", "A"]);
      expect(await names("?sort=status")).toHaveLength(2);
    });

    it("pages with a stable order and reports the total", async () => {
      const { cookie, make } = await seedStudents();
      for (let n = 1; n <= 7; n++) await make(n, { fullName: `Same Name` });
      const seen: string[] = [];
      for (const page of [1, 2, 3, 4]) {
        const { body } = await list(cookie, `?pageSize=2&page=${page}`);
        expect(body.total).toBe(7);
        seen.push(...body.items.map((s) => s.studentNumber));
      }
      expect(seen).toEqual(Array.from({ length: 7 }, (_, i) => `SMS-2026-000${i + 1}`));
      expect((await list(cookie, "?pageSize=2&page=9")).body.items).toEqual([]);
    });

    it.each([
      "?sort=password",
      "?sort=-",
      "?pageSize=101",
      "?pageSize=0",
      "?page=0",
      "?page=abc",
      "?yearOfStudy=0",
    ])("rejects %s", async (query) => {
      const { cookie } = await seedStudents();
      const { status, body } = await list(cookie, query);
      expect(status).toBe(400);
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });
  });
});

describe("GET /api/students/{id}", () => {
  it("returns the full record with version and fee summary", async () => {
    const { programme, cookie } = await setup();
    const student = await createStudent({ programmeId: programme.id, fullName: "Ayesha Rahman" });
    const { status, body } = await call<StudentBody>(readRoute, {
      path: `/api/students/${student.id}`,
      cookie,
      params: { id: student.id },
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({
      id: student.id,
      studentNumber: student.studentNumber,
      fullName: "Ayesha Rahman",
      dateOfBirth: "2005-03-14",
      version: 1,
      status: "ENROLLED",
      programme: { code: "BSC-CSE", durationYears: 4 },
      feeSummary: { charged: "0.00", balance: "0.00", feeState: "paid" },
    });
  });

  it.each([
    ["an unknown id", "00000000-0000-4000-8000-000000000000"],
    ["a malformed id", "not-a-uuid"],
  ])("answers 404 for %s", async (_label, id) => {
    const { cookie } = await setup();
    const { status, body } = await call<ErrorBody>(readRoute, {
      path: `/api/students/${id}`,
      cookie,
      params: { id },
    });
    expect(status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

describe("PATCH /api/students/{id}", () => {
  const patch = (cookie: string, id: string, body: unknown) =>
    call<StudentBody & ErrorBody>(patchRoute, {
      method: "PATCH",
      path: `/api/students/${id}`,
      cookie,
      body,
      params: { id },
    });

  it("updates the fields sent and bumps the version", async () => {
    const { programme, cookie } = await setup();
    const student = await createStudent({ programmeId: programme.id });
    const { status, body } = await patch(cookie, student.id, {
      version: 1,
      fullName: "  Renamed   Student ",
      email: "New.Email@Example.edu",
      dateOfBirth: "2004-01-02",
      yearOfStudy: 2,
      academicYear: "2027-28",
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({
      fullName: "Renamed Student",
      email: "new.email@example.edu",
      dateOfBirth: "2004-01-02",
      yearOfStudy: 2,
      academicYear: "2027-28",
      version: 2,
      studentNumber: student.studentNumber, // never changes
      status: "ENROLLED", // not editable here
    });
    expect(body.warnings).toBeUndefined();
  });

  it("changes the programme without touching existing fee charges, and says so", async () => {
    const { programme, cookie } = await setup();
    const other = await createProgramme({ code: "BBA", name: "BBA", durationYears: 3 });
    await createProgrammeFee({
      programmeId: other.id,
      academicYear: SESSION,
      amount: "260000.00",
      dueDate: shiftDays(30),
    });
    const student = await createStudent({ programmeId: programme.id });
    const charge = await createFeeCharge({
      studentId: student.id,
      amount: "160000.00",
      dueDate: shiftDays(-3),
    });

    const { status, body } = await patch(cookie, student.id, { version: 1, programmeId: other.id });
    expect(status).toBe(200);
    expect(body.programme.id).toBe(other.id);
    expect(body.warnings).toEqual([expect.objectContaining({ code: "PROGRAMME_CHANGED" })]);
    // No silent recalculation: the one charge is exactly as it was, and no new one appeared.
    const charges = await db.feeCharge.findMany({ where: { studentId: student.id } });
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({ id: charge.id, kind: "PROGRAMME_FEE" });
    expect(charges[0]!.amount.toFixed(2)).toBe("160000.00");
    expect(body.feeSummary.charged).toBe("160000.00");
  });

  it("checks the year of study against the programme it ends up in", async () => {
    const { programme, cookie } = await setup();
    const short = await createProgramme({ code: "DIP", name: "Diploma", durationYears: 2 });
    const student = await createStudent({ programmeId: programme.id, yearOfStudy: 3 });
    const { status, body } = await patch(cookie, student.id, { version: 1, programmeId: short.id });
    expect(status).toBe(400);
    expect(Object.keys(body.error.details?.fieldErrors as object)).toEqual(["yearOfStudy"]);
    const unchanged = await db.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(unchanged).toMatchObject({ programmeId: programme.id, version: 1 });
  });

  it("answers 409 VERSION_CONFLICT with the current version when the record changed", async () => {
    const { programme, cookie } = await setup();
    const student = await createStudent({ programmeId: programme.id });
    const first = await patch(cookie, student.id, { version: 1, fullName: "First Editor" });
    expect(first.status).toBe(200);

    const second = await patch(cookie, student.id, { version: 1, fullName: "Second Editor" });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("VERSION_CONFLICT");
    expect(second.body.error.details).toEqual({ currentVersion: 2 });
    const stored = await db.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(stored.fullName).toBe("First Editor");
  });

  it("lets only one of two simultaneous saves of the same version through", async () => {
    const { programme, cookie } = await setup();
    const student = await createStudent({ programmeId: programme.id });
    const results = await Promise.all([
      patch(cookie, student.id, { version: 1, fullName: "Editor A" }),
      patch(cookie, student.id, { version: 1, fullName: "Editor B" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await db.student.findUniqueOrThrow({ where: { id: student.id } })).version).toBe(2);
  });

  it("refuses an email that belongs to someone else, but allows keeping your own", async () => {
    const { programme, cookie } = await setup();
    const a = await createStudent({ programmeId: programme.id, email: "a@example.edu" });
    const b = await createStudent({ programmeId: programme.id, email: "b@example.edu" });
    const clash = await patch(cookie, b.id, { version: 1, email: "A@Example.edu" });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe("CONFLICT");
    expect(clash.body.error.details).toMatchObject({ field: "email", existing: { id: a.id } });

    const own = await patch(cookie, b.id, { version: 1, email: "B@example.edu" });
    expect(own.status).toBe(200);
    expect(own.body.version).toBe(1); // lower-cased to what it already was: nothing changed
  });

  it("does not move the version when nothing actually changes", async () => {
    const { programme, cookie } = await setup();
    const student = await createStudent({ programmeId: programme.id, fullName: "Same Name" });
    const { status, body } = await patch(cookie, student.id, { version: 1, fullName: "Same Name" });
    expect(status).toBe(200);
    expect(body.version).toBe(1);
  });

  it("validates dates of birth like the create endpoint", async () => {
    const { programme, cookie } = await setup();
    const student = await createStudent({ programmeId: programme.id });
    const { status, body } = await patch(cookie, student.id, {
      version: 1,
      dateOfBirth: shiftDays(5),
    });
    expect(status).toBe(400);
    expect(body.error.details?.fieldErrors).toEqual({
      dateOfBirth: ["Date of birth cannot be in the future."],
    });
  });

  it("needs a version and at least one field", async () => {
    const { programme, cookie } = await setup();
    const student = await createStudent({ programmeId: programme.id });
    const noVersion = await patch(cookie, student.id, { fullName: "No Version" });
    expect(noVersion.status).toBe(400);
    expect(Object.keys(noVersion.body.error.details?.fieldErrors as object)).toEqual(["version"]);
    const nothing = await patch(cookie, student.id, { version: 1 });
    expect(nothing.status).toBe(400);
    expect(nothing.body.error.details?.formErrors).toEqual(["Change at least one field."]);
  });

  it("does not change the status, Student ID or version through the body", async () => {
    const { programme, cookie } = await setup();
    const student = await createStudent({ programmeId: programme.id });
    await patch(cookie, student.id, {
      version: 1,
      fullName: "Edited",
      status: "WITHDRAWN",
      studentNumber: "SMS-9999-0001",
    });
    const stored = await db.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(stored).toMatchObject({
      status: "ENROLLED",
      studentNumber: student.studentNumber,
      version: 2,
    });
  });

  it("answers 404 for an unknown student", async () => {
    const { cookie } = await setup();
    const { status } = await patch(cookie, "00000000-0000-4000-8000-000000000000", {
      version: 1,
      fullName: "Nobody",
    });
    expect(status).toBe(404);
  });
});

describe("POST /api/students/{id}/status", () => {
  type Status = "ENROLLED" | "DEFERRED" | "WITHDRAWN" | "COMPLETED";
  const STATUSES: Status[] = ["ENROLLED", "DEFERRED", "WITHDRAWN", "COMPLETED"];

  // The table from api.md "Status transitions", written out independently of the rules module.
  // true = allowed without a reason, "reason" = allowed with a reason, false = not allowed.
  const MATRIX: Record<Status, Record<Status, true | "reason" | false>> = {
    ENROLLED: { ENROLLED: false, DEFERRED: "reason", WITHDRAWN: "reason", COMPLETED: true },
    DEFERRED: { ENROLLED: true, DEFERRED: false, WITHDRAWN: "reason", COMPLETED: false },
    WITHDRAWN: { ENROLLED: "reason", DEFERRED: false, WITHDRAWN: false, COMPLETED: false },
    COMPLETED: { ENROLLED: false, DEFERRED: false, WITHDRAWN: false, COMPLETED: false },
  };

  const change = (cookie: string, id: string, body: unknown) =>
    call<StudentBody & ErrorBody>(statusRoute, {
      method: "POST",
      path: `/api/students/${id}/status`,
      cookie,
      body,
      params: { id },
    });

  const cases = STATUSES.flatMap((from) =>
    STATUSES.map((to) => ({ from, to, rule: MATRIX[from][to] })),
  );

  it.each(cases.filter((c) => c.rule !== false))(
    "allows $from -> $to ($rule) and records it",
    async ({ from, to, rule }) => {
      const { programme, cookie, staff } = await setup();
      const student = await createStudent({ programmeId: programme.id, status: from });
      const reason = rule === "reason" ? "  Documented reason  " : undefined;

      const { status, body } = await change(cookie, student.id, {
        toStatus: to,
        reason,
        version: 1,
      });
      expect(status).toBe(200);
      expect(body).toMatchObject({ id: student.id, status: to, version: 2 });

      const history = await db.statusChange.findMany({ where: { studentId: student.id } });
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        fromStatus: from,
        toStatus: to,
        reason: reason ? "Documented reason" : null,
        changedById: staff.id,
      });
    },
  );

  it.each(cases.filter((c) => c.rule === "reason"))(
    "refuses $from -> $to without a reason (400 on reason), changing nothing",
    async ({ from, to }) => {
      const { programme, cookie } = await setup();
      const student = await createStudent({ programmeId: programme.id, status: from });
      for (const reason of [undefined, "", "   "]) {
        const { status, body } = await change(cookie, student.id, {
          toStatus: to,
          reason,
          version: 1,
        });
        expect(status).toBe(400);
        expect(body.error.code).toBe("VALIDATION_ERROR");
        expect(Object.keys(body.error.details?.fieldErrors as object)).toEqual(["reason"]);
      }
      const stored = await db.student.findUniqueOrThrow({ where: { id: student.id } });
      expect(stored).toMatchObject({ status: from, version: 1 });
      expect(await db.statusChange.count()).toBe(0);
    },
  );

  it.each(cases.filter((c) => c.rule === false))(
    "refuses $from -> $to with 422 BUSINESS_RULE, changing nothing",
    async ({ from, to }) => {
      const { programme, cookie } = await setup();
      const student = await createStudent({ programmeId: programme.id, status: from });
      const { status, body } = await change(cookie, student.id, {
        toStatus: to,
        reason: "A perfectly good reason",
        version: 1,
      });
      expect(status).toBe(422);
      expect(body.error.code).toBe("BUSINESS_RULE");
      expect(body.error.details).toMatchObject({ rule: "STATUS_TRANSITION", from, to });
      const stored = await db.student.findUniqueOrThrow({ where: { id: student.id } });
      expect(stored).toMatchObject({ status: from, version: 1 });
      expect(await db.statusChange.count()).toBe(0);
    },
  );

  it("keeps a reason that was given for a transition that does not need one", async () => {
    const { programme, cookie } = await setup();
    const student = await createStudent({ programmeId: programme.id, status: "DEFERRED" });
    await change(cookie, student.id, {
      toStatus: "ENROLLED",
      reason: "Returned from leave",
      version: 1,
    });
    const row = await db.statusChange.findFirstOrThrow({ where: { studentId: student.id } });
    expect(row.reason).toBe("Returned from leave");
  });

  it("builds a history, oldest first, as the student moves through the matrix", async () => {
    const { programme, cookie } = await setup();
    const student = await createStudent({ programmeId: programme.id });
    await change(cookie, student.id, { toStatus: "WITHDRAWN", reason: "Moved abroad", version: 1 });
    await change(cookie, student.id, {
      toStatus: "ENROLLED",
      reason: "Re-admitted after appeal",
      version: 2,
    });
    const last = await change(cookie, student.id, { toStatus: "COMPLETED", version: 3 });
    expect(last.body).toMatchObject({ status: "COMPLETED", version: 4 });
    const history = await db.statusChange.findMany({
      where: { studentId: student.id },
      orderBy: { changedAt: "asc" },
    });
    expect(history.map((h) => [h.fromStatus, h.toStatus, h.reason])).toEqual([
      ["ENROLLED", "WITHDRAWN", "Moved abroad"],
      ["WITHDRAWN", "ENROLLED", "Re-admitted after appeal"],
      ["ENROLLED", "COMPLETED", null],
    ]);
  });

  it("answers 409 VERSION_CONFLICT for a stale version, changing nothing", async () => {
    const { programme, cookie } = await setup();
    const student = await createStudent({ programmeId: programme.id });
    // Someone edits the record first, so version 1 is out of date.
    await call(patchRoute, {
      method: "PATCH",
      path: "/x",
      cookie,
      body: { version: 1, fullName: "Edited First" },
      params: { id: student.id },
    });
    const { status, body } = await change(cookie, student.id, {
      toStatus: "DEFERRED",
      reason: "Medical leave",
      version: 1,
    });
    expect(status).toBe(409);
    expect(body.error.code).toBe("VERSION_CONFLICT");
    expect(body.error.details).toEqual({ currentVersion: 2 });
    expect(await db.statusChange.count()).toBe(0);
    expect((await db.student.findUniqueOrThrow({ where: { id: student.id } })).status).toBe(
      "ENROLLED",
    );
  });

  it("lets only one of two simultaneous changes from the same version through", async () => {
    const { programme, cookie } = await setup();
    const student = await createStudent({ programmeId: programme.id });
    const results = await Promise.all([
      change(cookie, student.id, { toStatus: "DEFERRED", reason: "Medical leave", version: 1 }),
      change(cookie, student.id, { toStatus: "WITHDRAWN", reason: "Moved abroad", version: 1 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await db.statusChange.count()).toBe(1);
  });

  it("validates the body", async () => {
    const { programme, cookie } = await setup();
    const student = await createStudent({ programmeId: programme.id });
    const bad = await change(cookie, student.id, { toStatus: "GRADUATED", version: "one" });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.details?.fieldErrors as object).sort()).toEqual([
      "toStatus",
      "version",
    ]);
    const tooLong = await change(cookie, student.id, {
      toStatus: "DEFERRED",
      reason: "x".repeat(501),
      version: 1,
    });
    expect(tooLong.status).toBe(400);
  });

  it("answers 404 for an unknown student", async () => {
    const { cookie } = await setup();
    const { status } = await change(cookie, "00000000-0000-4000-8000-000000000000", {
      toStatus: "COMPLETED",
      version: 1,
    });
    expect(status).toBe(404);
  });
});
