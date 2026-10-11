import { describe, expect, it } from "vitest";
import {
  DATE_OF_BIRTH_MESSAGES,
  ageOn,
  dateOfBirthProblem,
  sessionStartYearOf,
} from "@/lib/services/rules/student-profile";

describe("ageOn", () => {
  it.each([
    ["2005-03-14", "2026-03-13", 20], // birthday tomorrow
    ["2005-03-14", "2026-03-14", 21], // birthday today
    ["2005-03-14", "2026-03-15", 21],
    ["2005-03-14", "2026-12-31", 21],
    ["2005-03-14", "2026-01-01", 20],
    ["2004-02-29", "2026-02-28", 21], // leap-day birthday: counted from 1 March in a non-leap year
    ["2004-02-29", "2026-03-01", 22],
    ["2004-02-29", "2028-02-29", 24],
    ["2026-10-12", "2026-10-12", 0],
    ["2026-10-13", "2026-10-12", -1], // born "tomorrow"
  ])("born %s, on %s: %i", (dob, today, expected) => {
    expect(ageOn(dob, today)).toBe(expected);
  });
});

describe("dateOfBirthProblem", () => {
  const today = "2026-10-12";

  it.each([
    ["2026-10-13", "FUTURE"],
    ["2027-01-01", "FUTURE"],
    ["2026-10-12", "TOO_YOUNG"], // born today
    ["2010-10-13", "TOO_YOUNG"], // turns 16 tomorrow
    ["2010-10-12", null], // turns 16 today
    ["2010-10-11", null],
    ["2005-03-14", null],
    ["1926-10-12", null], // turns 100 today
    ["1926-10-13", null], // turned 99 ... 100 tomorrow
    ["1925-10-13", null], // 100 until tomorrow
    ["1925-10-12", "TOO_OLD"], // turns 101 today
    ["1900-01-01", "TOO_OLD"],
  ] as const)("%s -> %s", (dob, expected) => {
    expect(dateOfBirthProblem(dob, today)).toBe(expected);
  });

  it("has a message for every problem", () => {
    expect(DATE_OF_BIRTH_MESSAGES.FUTURE).toMatch(/future/);
    expect(DATE_OF_BIRTH_MESSAGES.TOO_YOUNG).toMatch(/16/);
    expect(DATE_OF_BIRTH_MESSAGES.TOO_OLD).toMatch(/100/);
  });
});

describe("sessionStartYearOf", () => {
  it.each([
    ["2026-27", 2026],
    ["2099-00", 2099],
    ["2000-01", 2000],
    ["2025-26", 2025],
  ])("%s -> %i", (label, expected) => {
    expect(sessionStartYearOf(label)).toBe(expected);
  });

  it.each([
    "2026-28",
    "2026-26",
    "2026/27",
    "26-27",
    "2026-2027",
    "1999-00",
    "2100-01",
    "",
    "abcd-ef",
  ])("%j is not a session", (label) => {
    expect(sessionStartYearOf(label)).toBeNull();
  });
});
