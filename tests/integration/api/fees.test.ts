import { describe, expect, it } from "vitest";
import { GET as balancesRoute } from "@/app/api/fees/route";
import { POST as voidRoute } from "@/app/api/payments/[id]/void/route";
import { PATCH as patchStudentRoute } from "@/app/api/students/[id]/route";
import { POST as chargeRoute } from "@/app/api/students/[id]/charges/route";
import { GET as feesRoute } from "@/app/api/students/[id]/fees/route";
import { POST as paymentRoute } from "@/app/api/students/[id]/payments/route";
import { db } from "@/lib/db";
import { todayIn } from "@/lib/services/rules/time";
import { asStaff, asStudent, call } from "../../support/api";
import {
  createFeeCharge,
  createPayment,
  createProgramme,
  createStaff,
  createStudent,
} from "../../support/factories";

// Integration tests for fees and payments (api.md "Fees and payments"): real Postgres, handlers called directly. The
// edge cases from edge-cases.md "Fees and payments" are each covered here.

type ErrorBody = {
  error: { code: string; message: string; details?: Record<string, unknown> };
};

interface SummaryBody {
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

interface PaymentBody {
  id: string;
  studentId: string;
  amount: string;
  method: string;
  paidAt: string;
  reference: string;
  recordedBy: { id: string; fullName: string };
  recordedAt: string;
  voidedAt: string | null;
  voidReason: string | null;
}

interface ChargeBody {
  id: string;
  kind: string;
  academicYear: string;
  description: string;
  amount: string;
  dueDate: string;
  createdAt: string;
}

interface FeesBody {
  summary: SummaryBody;
  charges: ChargeBody[];
  payments: PaymentBody[];
}

type Warnings = { warnings?: { code: string; message: string }[] };

const TODAY = todayIn(new Date());
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

/** `YYYY-MM-DD` shifted by whole days from today in Dhaka. */
function shiftDays(days: number): string {
  const [year, month, day] = TODAY.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

async function setup() {
  const staff = await createStaff({ fullName: "Nusrat Jahan" });
  const programme = await createProgramme({ code: "BSC-CSE", name: "BSc CSE" });
  const student = await createStudent({ programmeId: programme.id, fullName: "Ayesha Rahman" });
  return { staff, programme, student, cookie: asStaff(staff.id) };
}

function paymentBody(overrides: Record<string, unknown> = {}) {
  return {
    amount: "5000.00",
    method: "BANK_TRANSFER",
    paidAt: TODAY,
    reference: "TRX-0001",
    ...overrides,
  };
}

function pay(cookie: string, studentId: string, body: unknown) {
  return call<{ payment: PaymentBody; summary: SummaryBody } & Warnings & ErrorBody>(paymentRoute, {
    method: "POST",
    path: `/api/students/${studentId}/payments`,
    cookie,
    params: { id: studentId },
    body,
  });
}

function charge(cookie: string, studentId: string, body: unknown) {
  return call<{ charge: ChargeBody; summary: SummaryBody } & ErrorBody>(chargeRoute, {
    method: "POST",
    path: `/api/students/${studentId}/charges`,
    cookie,
    params: { id: studentId },
    body,
  });
}

function voidIt(cookie: string, paymentId: string, body: unknown) {
  return call<{ payment: PaymentBody; summary: SummaryBody } & ErrorBody>(voidRoute, {
    method: "POST",
    path: `/api/payments/${paymentId}/void`,
    cookie,
    params: { id: paymentId },
    body,
  });
}

function fees(cookie: string, studentId: string) {
  return call<FeesBody & ErrorBody>(feesRoute, {
    path: `/api/students/${studentId}/fees`,
    cookie,
    params: { id: studentId },
  });
}

describe("access control", () => {
  const endpoints: { name: string; run: (cookie?: string) => Promise<{ status: number }> }[] = [
    {
      name: "GET /api/students/{id}/fees",
      run: (cookie) => call(feesRoute, { path: "/x", cookie, params: { id: UNKNOWN_ID } }),
    },
    {
      name: "POST /api/students/{id}/charges",
      run: (cookie) =>
        call(chargeRoute, {
          method: "POST",
          path: "/x",
          cookie,
          body: {},
          params: { id: UNKNOWN_ID },
        }),
    },
    {
      name: "POST /api/students/{id}/payments",
      run: (cookie) =>
        call(paymentRoute, {
          method: "POST",
          path: "/x",
          cookie,
          body: {},
          params: { id: UNKNOWN_ID },
        }),
    },
    {
      name: "POST /api/payments/{id}/void",
      run: (cookie) =>
        call(voidRoute, {
          method: "POST",
          path: "/x",
          cookie,
          body: {},
          params: { id: UNKNOWN_ID },
        }),
    },
    { name: "GET /api/fees", run: (cookie) => call(balancesRoute, { path: "/api/fees", cookie }) },
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

describe("GET /api/students/{id}/fees", () => {
  it("returns the summary, the charges oldest first and the payments newest first, voided ones included", async () => {
    const { student, staff, cookie } = await setup();
    await createFeeCharge({ studentId: student.id, amount: "100000.00", dueDate: shiftDays(-40) });
    await createFeeCharge({ studentId: student.id, amount: "100000.00", dueDate: shiftDays(30) });
    await createFeeCharge({
      studentId: student.id,
      kind: "WAIVER",
      amount: "-20000.00",
      dueDate: shiftDays(-40),
      description: "Merit scholarship",
    });
    await createPayment({
      studentId: student.id,
      staffId: staff.id,
      amount: "30000.00",
      paidAt: shiftDays(-20),
    });
    await createPayment({
      studentId: student.id,
      staffId: staff.id,
      amount: "999.00",
      paidAt: shiftDays(-5),
      voided: true,
    });

    const { status, body } = await fees(cookie, student.id);
    expect(status).toBe(200);
    expect(body.summary).toEqual({
      charged: "200000.00",
      waived: "20000.00",
      paid: "30000.00", // the voided payment counts for nothing
      balance: "150000.00",
      credit: "0.00",
      overdueAmount: "50000.00",
      oldestOverdueDays: 40,
      ageingBucket: "31-60",
      nextDueDate: shiftDays(30),
      feeState: "overdue",
    });
    expect(body.charges.map((c) => [c.kind, c.amount, c.dueDate])).toEqual([
      ["PROGRAMME_FEE", "100000.00", shiftDays(-40)],
      ["WAIVER", "-20000.00", shiftDays(-40)],
      ["PROGRAMME_FEE", "100000.00", shiftDays(30)],
    ]);
    expect(body.payments.map((p) => [p.amount, p.voidedAt !== null])).toEqual([
      ["999.00", true],
      ["30000.00", false],
    ]);
    expect(body.payments[0]).toMatchObject({
      voidReason: "Entered by mistake",
      recordedBy: { id: staff.id, fullName: "Nusrat Jahan" },
    });
  });

  it("returns an all-zero, paid summary for a student with no charges", async () => {
    const { student, cookie } = await setup();
    const { body } = await fees(cookie, student.id);
    expect(body.summary).toMatchObject({ charged: "0.00", balance: "0.00", feeState: "paid" });
    expect(body.charges).toEqual([]);
    expect(body.payments).toEqual([]);
  });

  it("answers 404 for an unknown or malformed id", async () => {
    const { cookie } = await setup();
    expect((await fees(cookie, UNKNOWN_ID)).status).toBe(404);
    expect((await fees(cookie, "not-a-uuid")).status).toBe(404);
  });
});

describe("POST /api/students/{id}/payments", () => {
  it("records the payment as the acting staff member and returns it with the new summary", async () => {
    const { student, staff, cookie } = await setup();
    await createFeeCharge({ studentId: student.id, amount: "10000.00", dueDate: shiftDays(-3) });

    const { status, body } = await pay(cookie, student.id, paymentBody({ amount: "4000" }));
    expect(status).toBe(201);
    expect(body.warnings).toBeUndefined();
    expect(body.payment).toMatchObject({
      studentId: student.id,
      amount: "4000.00",
      method: "BANK_TRANSFER",
      paidAt: TODAY,
      reference: "TRX-0001",
      recordedBy: { id: staff.id, fullName: "Nusrat Jahan" },
      voidedAt: null,
      voidReason: null,
    });
    expect(body.summary).toMatchObject({
      paid: "4000.00",
      balance: "6000.00",
      feeState: "overdue",
    });

    const row = await db.payment.findUniqueOrThrow({ where: { id: body.payment.id } });
    expect(row.recordedById).toBe(staff.id);
  });

  it.each(["BANK_TRANSFER", "CASH", "BKASH", "NAGAD", "CARD"])(
    "accepts the method %s",
    async (method) => {
      const { student, cookie } = await setup();
      const { status, body } = await pay(cookie, student.id, paymentBody({ method }));
      expect(status).toBe(201);
      expect(body.payment.method).toBe(method);
    },
  );

  it("accepts amounts typed with grouping and stores them with two decimals", async () => {
    const { student, cookie } = await setup();
    const { body } = await pay(cookie, student.id, paymentBody({ amount: "1,25,000.5" }));
    expect(body.payment.amount).toBe("125000.50");
  });

  describe("overpayment", () => {
    it("shows a credit, not a negative figure, with the data to display it", async () => {
      const { student, cookie } = await setup();
      await createFeeCharge({ studentId: student.id, amount: "10000.00", dueDate: shiftDays(-3) });
      await pay(cookie, student.id, paymentBody({ amount: "12500.00" }));

      const { body } = await fees(cookie, student.id);
      expect(body.summary).toMatchObject({
        balance: "-2500.00", // negative balance = credit (api.md)
        credit: "2500.00", // the same amount, positive, to display
        overdueAmount: "0.00",
        oldestOverdueDays: null,
        ageingBucket: null,
        feeState: "credit",
      });
    });

    it("succeeds with an OVERPAYMENT warning when the payment is larger than the balance", async () => {
      const { student, cookie } = await setup();
      await createFeeCharge({ studentId: student.id, amount: "10000.00", dueDate: shiftDays(10) });
      const { status, body } = await pay(cookie, student.id, paymentBody({ amount: "12500.00" }));
      expect(status).toBe(201);
      expect(body.warnings).toEqual([
        {
          code: "OVERPAYMENT",
          message: expect.stringContaining("৳2,500.00 more than the balance of ৳10,000.00"),
        },
      ]);
      expect(body.summary).toMatchObject({ feeState: "credit", credit: "2500.00" });
    });

    it("does not warn when the payment is exactly the balance, or less", async () => {
      const { student, cookie } = await setup();
      await createFeeCharge({ studentId: student.id, amount: "10000.00", dueDate: shiftDays(10) });
      const less = await pay(
        cookie,
        student.id,
        paymentBody({ amount: "9999.99", reference: "A" }),
      );
      expect(less.body.warnings).toBeUndefined();
      const exact = await pay(cookie, student.id, paymentBody({ amount: "0.01", reference: "B" }));
      expect(exact.body.warnings).toBeUndefined();
      expect(exact.body.summary).toMatchObject({ balance: "0.00", feeState: "paid" });
    });

    it("warns when the student owes nothing, and when they are already in credit", async () => {
      const { student, cookie } = await setup();
      const nothing = await pay(
        cookie,
        student.id,
        paymentBody({ amount: "100.00", reference: "A" }),
      );
      expect(nothing.body.warnings).toEqual([
        { code: "OVERPAYMENT", message: expect.stringContaining("owes nothing") },
      ]);
      const again = await pay(cookie, student.id, paymentBody({ amount: "50.00", reference: "B" }));
      expect(again.body.warnings).toEqual([
        { code: "OVERPAYMENT", message: expect.stringContaining("already ৳100.00 in credit") },
      ]);
    });
  });

  describe("payment date", () => {
    it("blocks a payment dated in the future", async () => {
      const { student, cookie } = await setup();
      const { status, body } = await pay(cookie, student.id, paymentBody({ paidAt: shiftDays(1) }));
      expect(status).toBe(400);
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.details?.fieldErrors).toEqual({
        paidAt: ["A payment cannot be dated in the future."],
      });
      expect(await db.payment.count()).toBe(0);
    });

    it("allows today and backdated payments", async () => {
      const { student, cookie } = await setup();
      const today = await pay(cookie, student.id, paymentBody({ reference: "A", paidAt: TODAY }));
      expect(today.status).toBe(201);
      const backdated = await pay(
        cookie,
        student.id,
        paymentBody({ reference: "B", paidAt: shiftDays(-400) }),
      );
      expect(backdated.status).toBe(201);
      expect(backdated.body.payment.paidAt).toBe(shiftDays(-400));
    });

    it.each(["2026-02-30", "11/10/2026", "yesterday", ""])(
      "rejects the date %j",
      async (paidAt) => {
        const { student, cookie } = await setup();
        const { status, body } = await pay(cookie, student.id, paymentBody({ paidAt }));
        expect(status).toBe(400);
        expect(body.error.details?.fieldErrors).toHaveProperty("paidAt");
      },
    );
  });

  describe("duplicate reference", () => {
    it("answers 409 CONFLICT pointing at the existing payment", async () => {
      const { student, cookie } = await setup();
      const first = await pay(
        cookie,
        student.id,
        paymentBody({ amount: "7500.00", paidAt: shiftDays(-2) }),
      );
      const second = await pay(cookie, student.id, paymentBody({ amount: "100.00" }));

      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe("CONFLICT");
      expect(second.body.error.message).toContain("TRX-0001");
      expect(second.body.error.details).toEqual({
        field: "reference",
        existing: {
          id: first.body.payment.id,
          reference: "TRX-0001",
          student: {
            id: student.id,
            studentNumber: student.studentNumber,
            fullName: "Ayesha Rahman",
          },
          amount: "7500.00",
          paidAt: shiftDays(-2),
          voided: false,
        },
      });
      expect(await db.payment.count()).toBe(1);
    });

    it("treats the reference case-insensitively and ignores surrounding or repeated spaces", async () => {
      const { student, cookie } = await setup();
      const first = await pay(cookie, student.id, paymentBody({ reference: "  trx   9f3 " }));
      expect(first.body.payment.reference).toBe("TRX 9F3"); // stored trimmed, collapsed and upper-cased
      for (const reference of ["TRX 9F3", "trx 9f3", " Trx  9F3  "]) {
        const again = await pay(cookie, student.id, paymentBody({ reference }));
        expect(again.status).toBe(409);
      }
      expect(await db.payment.count()).toBe(1);
    });

    it("clashes across students and names the other student", async () => {
      const { student, programme, cookie } = await setup();
      const other = await createStudent({ programmeId: programme.id, fullName: "Tanvir Hasan" });
      await pay(cookie, other.id, paymentBody());
      const { status, body } = await pay(cookie, student.id, paymentBody());
      expect(status).toBe(409);
      expect(body.error.details).toMatchObject({
        existing: { student: { id: other.id, fullName: "Tanvir Hasan" } },
      });
    });

    it("still blocks a reference whose payment has been voided, and says so", async () => {
      const { student, cookie } = await setup();
      const first = await pay(cookie, student.id, paymentBody());
      await voidIt(cookie, first.body.payment.id, { reason: "Wrong amount" });
      const { status, body } = await pay(cookie, student.id, paymentBody());
      expect(status).toBe(409);
      expect(body.error.message).toContain("voided");
      expect(body.error.details).toMatchObject({
        existing: { id: first.body.payment.id, voided: true },
      });
    });

    it("lets exactly one of two simultaneous identical submissions through (double click)", async () => {
      const { student, cookie } = await setup();
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          pay(cookie, student.id, paymentBody({ reference: "DOUBLE-1" })),
        ),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409, 409, 409]);
      const loser = results.find((r) => r.status === 409)!;
      expect(loser.body.error.code).toBe("CONFLICT");
      expect(loser.body.error.details).toMatchObject({ existing: { reference: "DOUBLE-1" } });
      expect(await db.payment.count()).toBe(1);
    });
  });

  describe("validation", () => {
    it.each([
      ["zero", { amount: "0" }, "amount"],
      ["negative", { amount: "-5" }, "amount"],
      ["three decimals", { amount: "10.123" }, "amount"],
      ["not a number", { amount: "abc" }, "amount"],
      ["a JSON number", { amount: 5000 }, "amount"],
      ["missing", { amount: undefined }, "amount"],
      ["too large", { amount: "99999999999" }, "amount"],
      ["unknown method", { method: "CHEQUE" }, "method"],
      ["no method", { method: undefined }, "method"],
      ["blank reference", { reference: "   " }, "reference"],
      ["missing reference", { reference: undefined }, "reference"],
      ["overlong reference", { reference: "X".repeat(65) }, "reference"],
    ])("rejects %s", async (_name, override, field) => {
      const { student, cookie } = await setup();
      const { status, body } = await pay(cookie, student.id, paymentBody(override));
      expect(status).toBe(400);
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.details?.fieldErrors).toHaveProperty(field);
      expect(await db.payment.count()).toBe(0);
    });

    it("answers 404 for an unknown student", async () => {
      const { cookie } = await setup();
      expect((await pay(cookie, UNKNOWN_ID, paymentBody())).status).toBe(404);
    });
  });

  it("is allowed for a withdrawn student", async () => {
    const { programme, cookie } = await setup();
    const gone = await createStudent({ programmeId: programme.id, status: "WITHDRAWN" });
    await createFeeCharge({ studentId: gone.id, amount: "10000.00", dueDate: shiftDays(-10) });
    const { status, body } = await pay(cookie, gone.id, paymentBody({ amount: "2500.00" }));
    expect(status).toBe(201);
    expect(body.summary.balance).toBe("7500.00");
  });
});

describe("POST /api/payments/{id}/void", () => {
  it("voids with a reason, keeps the row, and removes the payment from the balance", async () => {
    const { student, cookie } = await setup();
    await createFeeCharge({ studentId: student.id, amount: "10000.00", dueDate: shiftDays(-3) });
    const made = await pay(cookie, student.id, paymentBody({ amount: "10000.00" }));
    expect(made.body.summary.feeState).toBe("paid");

    const { status, body } = await voidIt(cookie, made.body.payment.id, {
      reason: "  Bounced cheque ",
    });
    expect(status).toBe(200);
    expect(body.payment).toMatchObject({ id: made.body.payment.id, voidReason: "Bounced cheque" });
    expect(body.payment.voidedAt).not.toBeNull();
    // Excluded from the balances: the student owes the full amount again, and is overdue again.
    expect(body.summary).toMatchObject({
      paid: "0.00",
      balance: "10000.00",
      overdueAmount: "10000.00",
      oldestOverdueDays: 3,
      feeState: "overdue",
    });

    // Never deleted or edited: still listed, amount and reference intact, marked voided.
    const listed = await fees(cookie, student.id);
    expect(listed.body.payments).toHaveLength(1);
    expect(listed.body.payments[0]).toMatchObject({
      amount: "10000.00",
      reference: "TRX-0001",
      voidReason: "Bounced cheque",
    });
    expect(listed.body.summary.paid).toBe("0.00");
  });

  it("requires a reason", async () => {
    const { student, cookie } = await setup();
    const made = await pay(cookie, student.id, paymentBody());
    for (const body of [{}, { reason: "" }, { reason: "   " }, { reason: "x".repeat(501) }]) {
      const result = await voidIt(cookie, made.body.payment.id, body);
      expect(result.status).toBe(400);
      expect(result.body.error.details?.fieldErrors).toHaveProperty("reason");
    }
    expect(
      (await db.payment.findUniqueOrThrow({ where: { id: made.body.payment.id } })).voidedAt,
    ).toBeNull();
  });

  it("answers 422 BUSINESS_RULE when the payment is already voided, and keeps the first reason", async () => {
    const { student, cookie } = await setup();
    const made = await pay(cookie, student.id, paymentBody());
    await voidIt(cookie, made.body.payment.id, { reason: "First reason" });
    const again = await voidIt(cookie, made.body.payment.id, { reason: "Second reason" });
    expect(again.status).toBe(422);
    expect(again.body.error).toMatchObject({
      code: "BUSINESS_RULE",
      details: { rule: "PAYMENT_ALREADY_VOIDED" },
    });
    expect(
      (await db.payment.findUniqueOrThrow({ where: { id: made.body.payment.id } })).voidReason,
    ).toBe("First reason");
  });

  it("lets exactly one of two simultaneous voids through", async () => {
    const { student, cookie } = await setup();
    const made = await pay(cookie, student.id, paymentBody());
    const results = await Promise.all([
      voidIt(cookie, made.body.payment.id, { reason: "A" }),
      voidIt(cookie, made.body.payment.id, { reason: "B" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
  });

  it("answers 404 for an unknown or malformed payment id", async () => {
    const { cookie } = await setup();
    expect((await voidIt(cookie, UNKNOWN_ID, { reason: "x" })).status).toBe(404);
    expect((await voidIt(cookie, "nope", { reason: "x" })).status).toBe(404);
  });
});

describe("POST /api/students/{id}/charges", () => {
  it("stores an adjustment as entered and a waiver negative, and updates the summary", async () => {
    const { student, cookie } = await setup();
    await createFeeCharge({ studentId: student.id, amount: "100000.00", dueDate: shiftDays(30) });

    const adjustment = await charge(cookie, student.id, {
      kind: "ADJUSTMENT",
      description: "Programme change: lab fee difference",
      amount: "12000",
      dueDate: shiftDays(15),
    });
    expect(adjustment.status).toBe(201);
    expect(adjustment.body.charge).toMatchObject({
      kind: "ADJUSTMENT",
      amount: "12000.00",
      description: "Programme change: lab fee difference",
      dueDate: shiftDays(15),
      academicYear: student.academicYear,
    });
    expect(adjustment.body.summary).toMatchObject({ charged: "112000.00", balance: "112000.00" });

    const waiver = await charge(cookie, student.id, {
      kind: "WAIVER",
      description: "Merit scholarship",
      amount: "20000.00", // entered positive
      dueDate: shiftDays(30),
    });
    expect(waiver.status).toBe(201);
    expect(waiver.body.charge.amount).toBe("-20000.00"); // stored negative
    expect(waiver.body.summary).toMatchObject({
      charged: "112000.00",
      waived: "20000.00",
      balance: "92000.00",
    });

    const row = await db.feeCharge.findUniqueOrThrow({ where: { id: waiver.body.charge.id } });
    expect(row.amount.toFixed(2)).toBe("-20000.00");
  });

  it("lets a backdated adjustment make a student overdue", async () => {
    const { student, cookie } = await setup();
    const { body } = await charge(cookie, student.id, {
      kind: "ADJUSTMENT",
      description: "Late registration fee",
      amount: "500.00",
      dueDate: shiftDays(-5),
    });
    expect(body.summary).toMatchObject({
      feeState: "overdue",
      overdueAmount: "500.00",
      oldestOverdueDays: 5,
    });
  });

  it.each([
    ["zero", { amount: "0" }, "amount"],
    ["negative", { amount: "-100" }, "amount"],
    ["three decimals", { amount: "1.005" }, "amount"],
    ["unknown kind", { kind: "PROGRAMME_FEE" }, "kind"],
    ["no kind", { kind: undefined }, "kind"],
    ["blank description", { description: "  " }, "description"],
    ["overlong description", { description: "d".repeat(201) }, "description"],
    ["impossible due date", { dueDate: "2026-13-01" }, "dueDate"],
    ["missing due date", { dueDate: undefined }, "dueDate"],
  ])("rejects %s", async (_name, override, field) => {
    const { student, cookie } = await setup();
    const { status, body } = await charge(cookie, student.id, {
      kind: "ADJUSTMENT",
      description: "Fee difference",
      amount: "100.00",
      dueDate: TODAY,
      ...override,
    });
    expect(status).toBe(400);
    expect(body.error.details?.fieldErrors).toHaveProperty(field);
    expect(await db.feeCharge.count()).toBe(0);
  });

  it("answers 404 for an unknown student", async () => {
    const { cookie } = await setup();
    const { status } = await charge(cookie, UNKNOWN_ID, {
      kind: "WAIVER",
      description: "x",
      amount: "1",
      dueDate: TODAY,
    });
    expect(status).toBe(404);
  });

  it("completes the programme-change flow: existing charges stay, an adjustment covers the difference", async () => {
    const { student, programme, cookie } = await setup();
    const original = await createFeeCharge({
      studentId: student.id,
      amount: "160000.00",
      dueDate: shiftDays(30),
    });
    const other = await createProgramme({ code: "BBA", name: "BBA" });

    const changed = await call<{ warnings?: { code: string }[] }>(patchStudentRoute, {
      method: "PATCH",
      path: `/api/students/${student.id}`,
      cookie,
      params: { id: student.id },
      body: { programmeId: other.id, version: student.version },
    });
    expect(changed.status).toBe(200);
    expect(changed.body.warnings).toEqual([expect.objectContaining({ code: "PROGRAMME_CHANGED" })]);
    expect(programme.id).not.toBe(other.id);

    const before = await db.feeCharge.findUniqueOrThrow({ where: { id: original.id } });
    expect(before.amount.toFixed(2)).toBe("160000.00"); // no silent recalculation

    const added = await charge(cookie, student.id, {
      kind: "ADJUSTMENT",
      description: "Programme change: BBA fee difference",
      amount: "15000.00",
      dueDate: shiftDays(30),
    });
    expect(added.body.summary.charged).toBe("175000.00");
  });
});

describe("GET /api/fees", () => {
  interface Item {
    id: string;
    fullName: string;
    status: string;
    programme: { id: string; code: string; name: string };
    feeSummary: SummaryBody;
    lastPayment: { paidAt: string; amount: string } | null;
  }
  interface ListBody {
    items: Item[];
    page: number;
    pageSize: number;
    total: number;
  }

  function list(cookie: string, query = "") {
    return call<ListBody & ErrorBody>(balancesRoute, { path: `/api/fees${query}`, cookie });
  }

  /** A student with one charge due `due` days from today, minus `paid` already paid. */
  async function owing(
    programmeId: string,
    staffId: string,
    name: string,
    options: { amount?: string; due: number; paid?: string; status?: "ENROLLED" | "WITHDRAWN" },
  ) {
    const student = await createStudent({ programmeId, fullName: name, status: options.status });
    await createFeeCharge({
      studentId: student.id,
      amount: options.amount ?? "100000.00",
      dueDate: shiftDays(options.due),
    });
    if (options.paid) {
      await createPayment({
        studentId: student.id,
        staffId,
        amount: options.paid,
        paidAt: shiftDays(-1),
      });
    }
    return student;
  }

  async function seedMix() {
    const { staff, programme, cookie } = await setup();
    const other = await createProgramme({ code: "BBA", name: "BBA" });
    const ids = {
      recent: await owing(programme.id, staff.id, "Recent Debtor", { due: -10 }),
      mid: await owing(programme.id, staff.id, "Middle Debtor", { due: -45, amount: "50000.00" }),
      old: await owing(other.id, staff.id, "Oldest Debtor", { due: -75, amount: "70000.00" }),
      notDue: await owing(programme.id, staff.id, "Not Yet Due", { due: 20 }),
      credit: await owing(programme.id, staff.id, "Credit Holder", {
        due: -5,
        amount: "10000.00",
        paid: "12000.00",
      }),
      paid: await owing(programme.id, staff.id, "Fully Paid", {
        due: -5,
        amount: "10000.00",
        paid: "10000.00",
      }),
      withdrawn: await owing(programme.id, staff.id, "Withdrawn Debtor", {
        due: -35,
        status: "WITHDRAWN",
      }),
    };
    await createStudent({ programmeId: programme.id, fullName: "No Charges At All" });
    return { cookie, programme, other, ids };
  }

  it("lists everyone with a balance (owing or in credit), and nobody who is paid up", async () => {
    const { cookie } = await seedMix();
    const { status, body } = await list(cookie);
    expect(status).toBe(200);
    expect(body).toMatchObject({ page: 1, pageSize: 25, total: 6 });
    expect(body.items.map((i) => i.fullName).sort()).toEqual([
      "Credit Holder",
      "Middle Debtor",
      "Not Yet Due",
      "Oldest Debtor",
      "Recent Debtor",
      "Withdrawn Debtor",
    ]);
  });

  it("keeps a withdrawn student who still owes money on the overdue list", async () => {
    const { cookie, ids } = await seedMix();
    const { body } = await list(cookie, "?feeState=overdue");
    const row = body.items.find((i) => i.id === ids.withdrawn.id);
    expect(row).toBeDefined();
    expect(row).toMatchObject({
      status: "WITHDRAWN",
      feeSummary: { feeState: "overdue", ageingBucket: "31-60" },
    });
  });

  it("separates outstanding-but-not-due from overdue", async () => {
    const { cookie, ids } = await seedMix();
    const outstanding = await list(cookie, "?feeState=outstanding");
    expect(outstanding.body.items.map((i) => i.id)).toEqual([ids.notDue.id]);
    expect(outstanding.body.items[0]!.feeSummary).toMatchObject({
      feeState: "outstanding",
      overdueAmount: "0.00",
      oldestOverdueDays: null,
      ageingBucket: null,
      nextDueDate: shiftDays(20),
    });
    const overdue = await list(cookie, "?feeState=overdue");
    expect(overdue.body.items.map((i) => i.id)).not.toContain(ids.notDue.id);
    expect(overdue.body.total).toBe(4);
  });

  it("filters to credit", async () => {
    const { cookie, ids } = await seedMix();
    const { body } = await list(cookie, "?feeState=credit");
    expect(body.items.map((i) => i.id)).toEqual([ids.credit.id]);
    expect(body.items[0]!.feeSummary).toMatchObject({ balance: "-2000.00", credit: "2000.00" });
  });

  it.each([
    ["1-30", ["Recent Debtor"]],
    ["31-60", ["Middle Debtor", "Withdrawn Debtor"]],
    ["60+", ["Oldest Debtor"]], // a hand-typed `+` arrives as a space and is still understood
    ["60%2B", ["Oldest Debtor"]],
  ])("filters by ageing bucket %s", async (bucket, names) => {
    const { cookie } = await seedMix();
    const { status, body } = await list(cookie, `?ageingBucket=${bucket}&sort=fullName`);
    expect(status).toBe(200);
    expect(body.items.map((i) => i.fullName)).toEqual(names);
  });

  it("filters by programme, and combines filters", async () => {
    const { cookie, other, programme } = await seedMix();
    const inOther = await list(cookie, `?programmeId=${other.id}`);
    expect(inOther.body.items.map((i) => i.fullName)).toEqual(["Oldest Debtor"]);
    const combined = await list(
      cookie,
      `?programmeId=${programme.id}&feeState=overdue&ageingBucket=31-60&sort=fullName`,
    );
    expect(combined.body.items.map((i) => i.fullName)).toEqual([
      "Middle Debtor",
      "Withdrawn Debtor",
    ]);
  });

  it("sorts by oldest overdue days (oldest first by default), overdue amount and name", async () => {
    const { cookie } = await seedMix();
    const names = (body: ListBody) => body.items.map((i) => i.fullName);

    const byDefault = await list(cookie);
    // 75, 45, 35, 10 days overdue; then the two without an overdue age, in name order.
    expect(names(byDefault.body)).toEqual([
      "Oldest Debtor",
      "Middle Debtor",
      "Withdrawn Debtor",
      "Recent Debtor",
      "Credit Holder",
      "Not Yet Due",
    ]);

    const youngest = await list(cookie, "?sort=oldestOverdueDays");
    expect(names(youngest.body)).toEqual([
      "Recent Debtor",
      "Withdrawn Debtor",
      "Middle Debtor",
      "Oldest Debtor",
      "Credit Holder", // no overdue age: last whichever way
      "Not Yet Due",
    ]);

    const byAmount = await list(cookie, "?sort=-overdueAmount");
    expect(names(byAmount.body).slice(0, 4)).toEqual([
      "Recent Debtor", // 100,000 (name order breaks the tie with the withdrawn debtor)
      "Withdrawn Debtor",
      "Oldest Debtor", // 70,000
      "Middle Debtor", // 50,000
    ]);
    expect(
      (await list(cookie, "?sort=overdueAmount")).body.items[0]!.feeSummary.overdueAmount,
    ).toBe("0.00");

    const byName = await list(cookie, "?sort=fullName");
    expect(names(byName.body)).toEqual([...names(byName.body)].sort());
    const byNameDesc = await list(cookie, "?sort=-fullName");
    expect(names(byNameDesc.body)).toEqual([...names(byName.body)].reverse());
  });

  it("pages the list and reports the total", async () => {
    const { cookie } = await seedMix();
    const first = await list(cookie, "?pageSize=4&sort=fullName");
    expect(first.body).toMatchObject({ page: 1, pageSize: 4, total: 6 });
    expect(first.body.items).toHaveLength(4);
    const second = await list(cookie, "?pageSize=4&page=2&sort=fullName");
    expect(second.body.items).toHaveLength(2);
    expect(second.body.items.map((i) => i.id)).not.toEqual(
      expect.arrayContaining(first.body.items.map((i) => i.id)),
    );
    expect((await list(cookie, "?page=9")).body.items).toEqual([]);
  });

  it("shows the last payment that has not been voided", async () => {
    const { staff, programme, cookie } = await setup();
    const student = await owing(programme.id, staff.id, "Payer", { due: -10 });
    await createPayment({
      studentId: student.id,
      staffId: staff.id,
      amount: "1000.00",
      paidAt: shiftDays(-8),
    });
    await createPayment({
      studentId: student.id,
      staffId: staff.id,
      amount: "2000.00",
      paidAt: shiftDays(-3),
    });
    await createPayment({
      studentId: student.id,
      staffId: staff.id,
      amount: "9999.00",
      paidAt: shiftDays(-1),
      voided: true,
    });
    const { body } = await list(cookie);
    expect(body.items[0]!.lastPayment).toEqual({ paidAt: shiftDays(-3), amount: "2000.00" });
  });

  it("lists a student who has only paid (a credit with no charges), and no last payment for one who never paid", async () => {
    const { staff, programme, cookie } = await setup();
    const prepaid = await createStudent({ programmeId: programme.id, fullName: "Prepaid" });
    await createPayment({ studentId: prepaid.id, staffId: staff.id, amount: "3000.00" });
    const { body } = await list(cookie);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.feeSummary.feeState).toBe("credit");
    const unpaid = await owing(programme.id, staff.id, "Never Paid", { due: -2 });
    const after = await list(cookie);
    expect(after.body.items.find((i) => i.id === unpaid.id)!.lastPayment).toBeNull();
  });

  it("agrees with the student list's fee state filter and the record's summary", async () => {
    const { cookie, ids } = await seedMix();
    const { body } = await list(cookie, "?feeState=overdue");
    for (const item of body.items) {
      const record = await fees(cookie, item.id);
      expect(item.feeSummary).toEqual(record.body.summary);
    }
    expect(body.items.map((i) => i.id)).toContain(ids.recent.id);
  });

  it.each([
    "?feeState=paid",
    "?feeState=bogus",
    "?ageingBucket=90",
    "?programmeId=not-a-uuid",
    "?sort=email",
    "?pageSize=101",
    "?page=0",
  ])("rejects the query %s with 400", async (query) => {
    const { cookie } = await setup();
    const { status, body } = await list(cookie, query);
    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});
