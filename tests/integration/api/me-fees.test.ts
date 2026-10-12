import { describe, expect, it } from "vitest";
import { GET as getMeFees } from "@/app/api/me/fees/route";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/services/clock";
import { getMyFees } from "@/lib/services/fees";
import { todayIn } from "@/lib/services/rules/time";
import { asStaff, asStudent, call } from "../../support/api";
import {
  createFeeCharge,
  createPayment,
  createStaff,
  createStudent,
} from "../../support/factories";

// GET /api/me/fees (api.md "Student self-service"): the signed-in student's own summary, charges and the payments that
// count. The route uses the real clock, so due dates are set relative to today (Asia/Dhaka).

type Fees = Awaited<ReturnType<typeof getMyFees>>;
type ErrorBody = { error: { code: string; message: string } };

const DAY = 24 * 60 * 60 * 1000;

/** A `YYYY-MM-DD` date `days` away from today in Dhaka (negative = in the past). */
function day(days: number): string {
  const today = new Date(`${todayIn(new Date())}T00:00:00.000Z`);
  return new Date(today.getTime() + days * DAY).toISOString().slice(0, 10);
}

function fees(cookie: string | undefined, query = "") {
  return call<Fees & ErrorBody>(getMeFees, { path: `/api/me/fees${query}`, cookie });
}

describe("GET /api/me/fees", () => {
  it("returns the summary, the charges (waiver included) and the payments that count", async () => {
    const staff = await createStaff();
    const student = await createStudent();
    await createFeeCharge({
      studentId: student.id,
      amount: "160000.00",
      dueDate: day(30),
      description: "Tuition - instalment 2",
    });
    await createFeeCharge({
      studentId: student.id,
      amount: "160000.00",
      dueDate: day(-60),
      description: "Tuition - instalment 1",
    });
    await createFeeCharge({
      studentId: student.id,
      kind: "WAIVER",
      amount: "-20000.00",
      dueDate: day(-60),
      description: "Merit scholarship",
    });
    await createPayment({
      studentId: student.id,
      staffId: staff.id,
      amount: "100000.00",
      paidAt: day(-10),
    });

    const { status, body, response } = await fees(asStudent(student.id));
    expect(status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    // 160,000 - 20,000 due 60 days ago, 100,000 paid: 40,000 overdue since then; instalment 2 is the next due date.
    expect(body.summary).toEqual({
      charged: "320000.00",
      waived: "20000.00",
      paid: "100000.00",
      balance: "200000.00",
      credit: "0.00",
      overdueAmount: "40000.00",
      oldestOverdueDays: 60,
      nextDueDate: day(30),
      feeState: "overdue",
    });
    expect(body.overdue).toEqual({
      amount: "40000.00",
      days: 60,
      message: "Overdue by 60 days. Please contact the Registry office.",
    });
    expect(body.charges.map((c) => [c.description, c.kind, c.amount, c.dueDate])).toEqual([
      ["Tuition - instalment 1", "PROGRAMME_FEE", "160000.00", day(-60)],
      ["Merit scholarship", "WAIVER", "-20000.00", day(-60)],
      ["Tuition - instalment 2", "PROGRAMME_FEE", "160000.00", day(30)],
    ]);
    expect(body.payments).toHaveLength(1);
    expect(body.payments[0]).toMatchObject({ amount: "100000.00", method: "BANK_TRANSFER" });
    expect(new Date(body.now).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("exposes no staff details and no ageing bucket", async () => {
    const staff = await createStaff({ fullName: "Fatema Khanom" });
    const student = await createStudent();
    await createFeeCharge({ studentId: student.id, amount: "100000.00", dueDate: day(-5) });
    await createFeeCharge({
      studentId: student.id,
      kind: "ADJUSTMENT",
      amount: "500.00",
      dueDate: day(10),
      description: "Library fine",
    });
    await db.feeCharge.updateMany({
      where: { studentId: student.id },
      data: { createdById: staff.id },
    });
    await createPayment({ studentId: student.id, staffId: staff.id, amount: "1000.00" });

    const { body } = await fees(asStudent(student.id));
    expect(Object.keys(body.summary).sort()).toEqual([
      "balance",
      "charged",
      "credit",
      "feeState",
      "nextDueDate",
      "oldestOverdueDays",
      "overdueAmount",
      "paid",
      "waived",
    ]);
    expect(Object.keys(body.charges[0]!).sort()).toEqual([
      "academicYear",
      "amount",
      "description",
      "dueDate",
      "id",
      "kind",
    ]);
    expect(Object.keys(body.payments[0]!).sort()).toEqual([
      "amount",
      "id",
      "method",
      "paidAt",
      "reference",
    ]);
    const json = JSON.stringify(body);
    expect(json).not.toContain("Fatema");
    expect(json).not.toContain(staff.id);
    for (const key of ["recordedBy", "voidedBy", "voidReason", "createdBy", "ageingBucket"]) {
      expect(json).not.toContain(key);
    }
  });

  it("hides a voided payment entirely and does not count it", async () => {
    const staff = await createStaff();
    const student = await createStudent();
    await createFeeCharge({ studentId: student.id, amount: "100000.00", dueDate: day(10) });
    const kept = await createPayment({
      studentId: student.id,
      staffId: staff.id,
      amount: "30000.00",
    });
    const voided = await createPayment({
      studentId: student.id,
      staffId: staff.id,
      amount: "70000.00",
      voided: true,
    });

    const { body } = await fees(asStudent(student.id));
    expect(body.payments.map((p) => p.id)).toEqual([kept.id]);
    expect(body.summary.paid).toBe("30000.00");
    expect(body.summary.balance).toBe("70000.00");
    const json = JSON.stringify(body);
    expect(json).not.toContain(voided.id);
    expect(json).not.toContain(voided.reference);
    expect(json).not.toContain("Entered by mistake");
  });

  it("shows a credit as a credit, with no overdue block", async () => {
    const staff = await createStaff();
    const student = await createStudent();
    await createFeeCharge({ studentId: student.id, amount: "160000.00", dueDate: day(-20) });
    await createPayment({ studentId: student.id, staffId: staff.id, amount: "165000.00" });

    const { body } = await fees(asStudent(student.id));
    expect(body.summary).toMatchObject({
      feeState: "credit",
      balance: "-5000.00",
      credit: "5000.00",
      overdueAmount: "0.00",
      oldestOverdueDays: null,
    });
    expect(body.overdue).toBeNull();
  });

  it("is all zeros and paid for a student with no charges", async () => {
    const student = await createStudent();
    const { body } = await fees(asStudent(student.id));
    expect(body.summary).toMatchObject({ charged: "0.00", balance: "0.00", feeState: "paid" });
    expect(body.charges).toEqual([]);
    expect(body.payments).toEqual([]);
    expect(body.overdue).toBeNull();
  });

  it("does not call a charge due today overdue, and singular days read '1 day'", async () => {
    const student = await createStudent();
    await createFeeCharge({ studentId: student.id, amount: "1000.00", dueDate: day(0) });
    const dueToday = await fees(asStudent(student.id));
    expect(dueToday.body.summary.feeState).toBe("outstanding");
    expect(dueToday.body.summary.nextDueDate).toBe(day(0));
    expect(dueToday.body.overdue).toBeNull();

    const other = await createStudent();
    await createFeeCharge({ studentId: other.id, amount: "1000.00", dueDate: day(-1) });
    const oneDay = await fees(asStudent(other.id));
    expect(oneDay.body.overdue?.message).toBe(
      "Overdue by 1 day. Please contact the Registry office.",
    );
  });

  it("measures from the clock it is given", async () => {
    const student = await createStudent();
    await createFeeCharge({ studentId: student.id, amount: "1000.00", dueDate: "2026-10-01" });
    const result = await getMyFees(student.id, fixedClock("2026-10-12T06:00:00.000Z"));
    expect(result.now).toBe("2026-10-12T06:00:00.000Z");
    expect(result.summary.oldestOverdueDays).toBe(11);
  });

  it("only ever reads the signed-in student: ids in the query are ignored", async () => {
    const staff = await createStaff();
    const me = await createStudent();
    const other = await createStudent();
    await createFeeCharge({ studentId: other.id, amount: "999999.00", dueDate: day(-5) });
    const theirs = await createPayment({
      studentId: other.id,
      staffId: staff.id,
      amount: "5000.00",
    });

    const { status, body } = await fees(asStudent(me.id), `?studentId=${other.id}&id=${other.id}`);
    expect(status).toBe(200);
    expect(body.charges).toEqual([]);
    expect(body.payments).toEqual([]);
    expect(JSON.stringify(body)).not.toContain(theirs.reference);
    expect(body.summary.charged).toBe("0.00");
  });

  it("is 401 without a session and 403 for staff", async () => {
    const staff = await createStaff();
    expect((await fees(undefined)).status).toBe(401);
    const forbidden = await fees(asStaff(staff.id));
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe("FORBIDDEN");
  });
});
