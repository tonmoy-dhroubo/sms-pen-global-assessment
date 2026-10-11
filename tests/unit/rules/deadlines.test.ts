import { describe, expect, it } from "vitest";
import {
  assessmentState,
  countLateFlagChanges,
  effectiveDeadline,
  isLate,
  isPastDeadline,
  lateBy,
} from "@/lib/services/rules/deadlines";

// Deadline: 11 Oct 2026, 23:59:00 Dhaka = 17:59:00 UTC.
const deadline = new Date("2026-10-11T17:59:00.000Z");
const after = (ms: number) => new Date(deadline.getTime() + ms);

describe("effectiveDeadline", () => {
  it("is the assessment deadline without an extension", () => {
    expect(effectiveDeadline(deadline)).toBe(deadline);
    expect(effectiveDeadline(deadline, null)).toBe(deadline);
    expect(effectiveDeadline(deadline, undefined)).toBe(deadline);
  });

  it("is the extension's new deadline when there is one", () => {
    const newDeadline = new Date("2026-10-18T17:59:00.000Z");
    expect(effectiveDeadline(deadline, { newDeadline })).toBe(newDeadline);
  });
});

describe("isLate (strictly after the deadline)", () => {
  it("is on time well before, a second before, and at exactly the deadline second", () => {
    expect(isLate(after(-3_600_000), deadline)).toBe(false);
    expect(isLate(after(-1_000), deadline)).toBe(false);
    expect(isLate(deadline, deadline)).toBe(false);
    expect(isLate(new Date("2026-10-11T17:59:00.000Z"), deadline)).toBe(false);
  });

  it("is late from the first instant after", () => {
    expect(isLate(after(1), deadline)).toBe(true);
    expect(isLate(after(1_000), deadline)).toBe(true);
    expect(isLate(new Date("2026-10-11T17:59:01.000Z"), deadline)).toBe(true);
  });

  it("follows the extension: late against the original deadline, on time against the extended one", () => {
    const uploadedAt = new Date("2026-10-13T10:00:00.000Z");
    const extended = effectiveDeadline(deadline, {
      newDeadline: new Date("2026-10-18T17:59:00.000Z"),
    });
    expect(isLate(uploadedAt, deadline)).toBe(true);
    expect(isLate(uploadedAt, extended)).toBe(false);
  });
});

describe("isPastDeadline", () => {
  it("uses the same strict comparison", () => {
    expect(isPastDeadline(deadline, deadline)).toBe(false);
    expect(isPastDeadline(after(1), deadline)).toBe(true);
    expect(isPastDeadline(after(-1), deadline)).toBe(false);
  });
});

describe("lateBy", () => {
  it("is null when on time, including at the deadline", () => {
    expect(lateBy(after(-5_000), deadline)).toBeNull();
    expect(lateBy(deadline, deadline)).toBeNull();
  });

  it("is human readable in the largest whole unit", () => {
    expect(lateBy(after(1), deadline)).toBe("less than a minute");
    expect(lateBy(after(30_000), deadline)).toBe("less than a minute");
    expect(lateBy(after(60_000), deadline)).toBe("1 minute");
    expect(lateBy(after(12 * 60_000), deadline)).toBe("12 minutes");
    expect(lateBy(after(3_600_000), deadline)).toBe("1 hour");
    expect(lateBy(after(5 * 3_600_000), deadline)).toBe("5 hours");
    expect(lateBy(after(24 * 3_600_000), deadline)).toBe("1 day");
    expect(lateBy(after(2 * 24 * 3_600_000 + 3_600_000), deadline)).toBe("2 days");
  });
});

describe("assessmentState", () => {
  const now = new Date("2026-10-12T04:00:00.000Z");
  const before = new Date("2026-10-13T17:59:00.000Z");
  const passed = new Date("2026-10-11T17:59:00.000Z");

  it("is open until the deadline, past-deadline after it, and closed whatever the deadline", () => {
    expect(assessmentState({ deadline: before, closedAt: null }, now)).toBe("open");
    expect(assessmentState({ deadline: passed, closedAt: null }, now)).toBe("past-deadline");
    expect(assessmentState({ deadline: before, closedAt: now }, now)).toBe("closed");
    expect(assessmentState({ deadline: passed, closedAt: now }, now)).toBe("closed");
    expect(assessmentState({ deadline: passed }, now)).toBe("past-deadline");
  });

  it("is still open at the deadline instant", () => {
    expect(assessmentState({ deadline: now }, now)).toBe("open");
  });
});

describe("countLateFlagChanges", () => {
  const old = new Date("2026-10-11T17:59:00.000Z");
  const hours = (h: number) => new Date(old.getTime() + h * 3_600_000);
  const submissions = [
    { studentId: "a", lastSubmittedAt: hours(-5) }, // on time under both
    { studentId: "b", lastSubmittedAt: hours(2) }, // late under the old deadline
    { studentId: "c", lastSubmittedAt: hours(30) }, // late under both when moved a day
  ];

  it("counts the submissions that flip from late to on time when the deadline moves later", () => {
    expect(countLateFlagChanges(submissions, new Map(), old, hours(24))).toBe(1);
  });

  it("counts the submissions that flip from on time to late when the deadline moves earlier", () => {
    expect(countLateFlagChanges(submissions, new Map(), old, hours(-10))).toBe(1);
    expect(countLateFlagChanges(submissions, new Map(), old, hours(-6))).toBe(1);
    expect(countLateFlagChanges(submissions, new Map(), hours(-10), hours(40))).toBe(3);
  });

  it("is zero when nobody crosses the line, and for an unchanged deadline", () => {
    expect(countLateFlagChanges(submissions, new Map(), old, hours(1))).toBe(0);
    expect(countLateFlagChanges(submissions, new Map(), old, old)).toBe(0);
    expect(countLateFlagChanges([], new Map(), old, hours(24))).toBe(0);
  });

  it("never counts a student with an extension, whose own deadline does not move", () => {
    const extensions = new Map([["b", hours(100)]]);
    expect(countLateFlagChanges(submissions, extensions, old, hours(24))).toBe(0);
  });

  it("treats arriving exactly at the new deadline as on time", () => {
    expect(
      countLateFlagChanges([{ studentId: "b", lastSubmittedAt: hours(2) }], new Map(), old, hours(2)),
    ).toBe(1);
  });
});
