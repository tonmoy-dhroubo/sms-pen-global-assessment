import { describe, expect, it } from "vitest";
import { effectiveDeadline, isLate, isPastDeadline, lateBy } from "@/lib/services/rules/deadlines";

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
