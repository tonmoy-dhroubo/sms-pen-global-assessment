import { describe, expect, it } from "vitest";
import {
  formatStudentNumber,
  parseStudentNumber,
  studentNumberYear,
} from "@/lib/services/rules/student-number";

describe("formatStudentNumber", () => {
  it.each([
    [2026, 1, "SMS-2026-0001"],
    [2026, 42, "SMS-2026-0042"],
    [2026, 9999, "SMS-2026-9999"],
    [2026, 10000, "SMS-2026-10000"],
    [2026, 123456, "SMS-2026-123456"],
    [2025, 7, "SMS-2025-0007"],
  ])("year %d, sequence %d -> %s", (year, sequence, expected) => {
    expect(formatStudentNumber(year, sequence)).toBe(expected);
  });

  it.each([
    [2026, 0],
    [2026, -1],
    [2026, 1.5],
    [2026, Number.NaN],
    [2026, Number.MAX_SAFE_INTEGER + 1],
    [26, 1],
    [10000, 1],
    [2026.5, 1],
  ])("rejects year %d, sequence %d", (year, sequence) => {
    expect(() => formatStudentNumber(year, sequence)).toThrow(RangeError);
  });
});

describe("parseStudentNumber", () => {
  it("reads numbers back, including ones wider than four digits", () => {
    expect(parseStudentNumber("SMS-2026-0042")).toEqual({ year: 2026, sequence: 42 });
    expect(parseStudentNumber("SMS-2026-9999")).toEqual({ year: 2026, sequence: 9999 });
    expect(parseStudentNumber("SMS-2026-10000")).toEqual({ year: 2026, sequence: 10000 });
    expect(parseStudentNumber("  SMS-2026-0042  ")).toEqual({ year: 2026, sequence: 42 });
  });

  it("round-trips with format", () => {
    for (const sequence of [1, 9, 99, 999, 9999, 10000, 99999]) {
      expect(parseStudentNumber(formatStudentNumber(2026, sequence))).toEqual({
        year: 2026,
        sequence,
      });
    }
  });

  it("widening keeps ordering by sequence, not text", () => {
    expect(parseStudentNumber("SMS-2026-10000")!.sequence).toBeGreaterThan(
      parseStudentNumber("SMS-2026-9999")!.sequence,
    );
  });

  it.each([
    "",
    "SMS-2026-42",
    "SMS-2026-000",
    "SMS-2026-0000",
    "SMS-26-0042",
    "SMS-20260-0042",
    "sms-2026-0042",
    "SMS 2026 0042",
    "SMS-2026-004a",
    "STU-2026-0042",
    "SMS-2026-0042-1",
    "SMS-2026-9999999999999999999",
  ])("returns null for %j", (value) => {
    expect(parseStudentNumber(value)).toBeNull();
  });
});

describe("studentNumberYear (DB-015)", () => {
  it("uses the start year of the session the student enrols in", () => {
    // Enrolling in January 2027 (session 2026-27) gives 2026.
    expect(studentNumberYear(new Date("2027-01-15T06:00:00Z"))).toBe(2026);
    expect(studentNumberYear(new Date("2026-10-12T06:00:00Z"))).toBe(2026);
  });

  it("rolls over at 1 July in Dhaka time", () => {
    expect(studentNumberYear(new Date("2026-06-30T17:59:59Z"))).toBe(2025);
    expect(studentNumberYear(new Date("2026-06-30T18:00:00Z"))).toBe(2026);
  });
});
