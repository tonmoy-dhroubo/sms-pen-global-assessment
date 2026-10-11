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

export async function createProgramme(overrides: Partial<{ code: string; name: string }> = {}) {
  const n = next();
  return db.programme.create({
    data: { code: `PRG-${n}`, name: `Programme ${n}`, durationYears: 3, ...overrides },
  });
}

export async function createStudent(
  overrides: Partial<{
    fullName: string;
    email: string;
    studentNumber: string;
    programmeId: string;
    status: "ENROLLED" | "DEFERRED" | "WITHDRAWN" | "COMPLETED";
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
