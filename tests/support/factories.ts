import { db } from "@/lib/db";

// Small builders for integration-test data. Each takes overrides and returns the created row.

let counter = 0;
const next = () => ++counter;

export async function createStaff(
  overrides: Partial<{ fullName: string; email: string; jobTitle: string }> = {},
) {
  const n = next();
  return db.staff.create({
    data: {
      fullName: `Staff Member ${n}`,
      email: `staff${n}@sms.test`,
      jobTitle: "Registry Officer",
      ...overrides,
    },
  });
}

export async function createProgramme(
  overrides: Partial<{ code: string; name: string; durationYears: number }> = {},
) {
  const n = next();
  return db.programme.create({
    data: { code: `PRG-${n}`, name: `Programme ${n}`, durationYears: 3, ...overrides },
  });
}

/** One instalment of a programme's fee schedule for a session. */
export async function createProgrammeFee(input: {
  programmeId: string;
  academicYear: string;
  instalment?: number;
  amount?: string;
  /** `YYYY-MM-DD` */
  dueDate: string;
}) {
  return db.programmeFee.create({
    data: {
      programmeId: input.programmeId,
      academicYear: input.academicYear,
      instalment: input.instalment ?? 1,
      amount: input.amount ?? "100000.00",
      dueDate: new Date(`${input.dueDate}T00:00:00.000Z`),
    },
  });
}

/** A fee charge for a student (a waiver's amount must be negative, as the database requires). */
export async function createFeeCharge(input: {
  studentId: string;
  amount: string;
  /** `YYYY-MM-DD` */
  dueDate: string;
  kind?: "PROGRAMME_FEE" | "ADJUSTMENT" | "WAIVER";
  academicYear?: string;
  description?: string;
}) {
  return db.feeCharge.create({
    data: {
      studentId: input.studentId,
      kind: input.kind ?? "PROGRAMME_FEE",
      academicYear: input.academicYear ?? "2026-27",
      description: input.description ?? "Tuition",
      amount: input.amount,
      dueDate: new Date(`${input.dueDate}T00:00:00.000Z`),
    },
  });
}

/** A payment against a student, recorded by `staffId`. */
export async function createPayment(input: {
  studentId: string;
  staffId: string;
  amount: string;
  /** `YYYY-MM-DD` */
  paidAt?: string;
  voided?: boolean;
}) {
  return db.payment.create({
    data: {
      studentId: input.studentId,
      recordedById: input.staffId,
      amount: input.amount,
      method: "BANK_TRANSFER",
      paidAt: new Date(`${input.paidAt ?? "2026-01-01"}T00:00:00.000Z`),
      reference: `PAY-${next()}`,
      voidedAt: input.voided ? new Date() : null,
      voidedById: input.voided ? input.staffId : null,
      voidReason: input.voided ? "Entered by mistake" : null,
    },
  });
}

export async function createStudent(
  overrides: Partial<{
    fullName: string;
    email: string;
    studentNumber: string;
    programmeId: string;
    status: "ENROLLED" | "DEFERRED" | "WITHDRAWN" | "COMPLETED";
    dateOfBirth: Date;
    academicYear: string;
    yearOfStudy: number;
  }> = {},
) {
  const n = next();
  const programmeId = overrides.programmeId ?? (await createProgramme()).id;
  return db.student.create({
    data: {
      studentNumber: `SMS-2026-${String(n).padStart(4, "0")}`,
      fullName: `Student ${n}`,
      email: `student${n}@sms.test`,
      dateOfBirth: new Date("2005-03-14"),
      academicYear: "2026-27",
      yearOfStudy: 1,
      ...overrides,
      programmeId,
    },
  });
}
