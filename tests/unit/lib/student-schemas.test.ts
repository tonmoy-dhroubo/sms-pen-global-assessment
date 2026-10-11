import { describe, expect, it } from "vitest";
import {
  changeStatusSchema,
  createStudentSchema,
  studentListQuerySchema,
  updateStudentSchema,
} from "@/lib/validation/students";

const UUID = "5b9f4c3e-7a1d-4c58-9a52-0d6f1b8e2a47";
const valid = {
  fullName: "Ayesha Rahman",
  email: "ayesha@example.edu",
  dateOfBirth: "2005-03-14",
  programmeId: UUID,
  academicYear: "2026-27",
  yearOfStudy: 1,
};

function errorsOf(result: {
  success: boolean;
  error?: { issues: { path: (string | number)[]; message: string }[] };
}) {
  return Object.fromEntries((result.error?.issues ?? []).map((i) => [i.path.join("."), i.message]));
}

describe("createStudentSchema", () => {
  it("accepts a complete student and normalises the text fields", () => {
    const parsed = createStudentSchema.parse({
      ...valid,
      fullName: "  Ayesha   Rahman ",
      email: "  Ayesha@Example.EDU ",
    });
    expect(parsed.fullName).toBe("Ayesha Rahman");
    expect(parsed.email).toBe("ayesha@example.edu");
    expect(parsed.confirmDuplicate).toBeUndefined();
  });

  it("explains each problem in words a registrar can act on", () => {
    const errors = errorsOf(
      createStudentSchema.safeParse({
        fullName: "",
        email: "nope",
        dateOfBirth: "",
        programmeId: "",
        academicYear: "",
        yearOfStudy: undefined,
      }),
    );
    expect(errors).toEqual({
      fullName: "Enter the full name.",
      email: "Enter a valid email address.",
      dateOfBirth: "Enter the date of birth.",
      programmeId: "Choose a programme.",
      academicYear: "Choose a session such as 2026-27.",
      yearOfStudy: "Choose the year of study.",
    });
  });

  it("rejects a date of birth in the future and an implausible age", () => {
    expect(
      errorsOf(createStudentSchema.safeParse({ ...valid, dateOfBirth: "2999-01-01" })),
    ).toEqual({
      dateOfBirth: "Date of birth cannot be in the future.",
    });
    expect(
      errorsOf(createStudentSchema.safeParse({ ...valid, dateOfBirth: "2020-01-01" })),
    ).toEqual({
      dateOfBirth: "Students must be at least 16 years old.",
    });
    expect(
      errorsOf(createStudentSchema.safeParse({ ...valid, dateOfBirth: "1900-01-01" })),
    ).toEqual({
      dateOfBirth: "Students must be at most 100 years old.",
    });
  });

  it("rejects impossible dates with a format message, not an age one", () => {
    expect(
      errorsOf(createStudentSchema.safeParse({ ...valid, dateOfBirth: "2005-02-30" })),
    ).toEqual({
      dateOfBirth: "Enter a real calendar date.",
    });
  });
});

describe("updateStudentSchema", () => {
  it("needs the version and at least one field", () => {
    expect(updateStudentSchema.safeParse({ version: 1, fullName: "New Name" }).success).toBe(true);
    expect(updateStudentSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(errorsOf(updateStudentSchema.safeParse({ fullName: "New Name" }))).toEqual({
      version: "Send the version you read.",
    });
  });
});

describe("changeStatusSchema", () => {
  it("treats a blank reason as no reason, and trims a real one", () => {
    expect(
      changeStatusSchema.parse({ toStatus: "DEFERRED", reason: "   ", version: 1 }).reason,
    ).toBeUndefined();
    expect(
      changeStatusSchema.parse({ toStatus: "DEFERRED", reason: " Medical ", version: 1 }).reason,
    ).toBe("Medical");
  });
});

describe("studentListQuerySchema", () => {
  it("applies the list defaults", () => {
    expect(studentListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25 });
  });

  it("turns a single or repeated status into an array and parses the sort", () => {
    const one = studentListQuerySchema.parse({ status: "WITHDRAWN" });
    expect(one.status).toEqual(["WITHDRAWN"]);
    const many = studentListQuerySchema.parse({
      status: ["WITHDRAWN", "COMPLETED"],
      sort: "-fullName",
    });
    expect(many.status).toEqual(["WITHDRAWN", "COMPLETED"]);
    expect(many.sort).toEqual({ field: "fullName", direction: "desc" });
  });

  it("coerces numbers from the query string and rejects bad ones", () => {
    expect(
      studentListQuerySchema.parse({ page: "3", pageSize: "50", yearOfStudy: "2" }),
    ).toMatchObject({
      page: 3,
      pageSize: 50,
      yearOfStudy: 2,
    });
    expect(studentListQuerySchema.safeParse({ pageSize: "500" }).success).toBe(false);
    expect(studentListQuerySchema.safeParse({ sort: "email" }).success).toBe(false);
    expect(studentListQuerySchema.safeParse({ feeState: "late" }).success).toBe(false);
  });
});
