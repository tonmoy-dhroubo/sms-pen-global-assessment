import { describe, expect, it } from "vitest";
import {
  APP_TIME_ZONE,
  daysBetween,
  formatDate,
  formatDateTime,
  formatDuration,
  formatRelative,
  instantToLocalDateTime,
  isLocalTime,
  parseDateOnly,
  sessionFor,
  sessionLabel,
  sessionStartYear,
  toDateOnly,
  todayIn,
  zonedParts,
  zonedTimeToInstant,
} from "@/lib/services/rules/time";
import { fixedClock, systemClock } from "@/lib/services/clock";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("zone", () => {
  it("is Asia/Dhaka", () => {
    expect(APP_TIME_ZONE).toBe("Asia/Dhaka");
  });

  it("reads Dhaka wall-clock parts regardless of the machine zone", () => {
    expect(zonedParts(new Date("2026-10-11T17:59:00Z"))).toEqual({
      year: 2026,
      month: 10,
      day: 11,
      hour: 23,
      minute: 59,
      second: 0,
    });
  });

  it("renders midnight as hour 0, not 24", () => {
    expect(zonedParts(new Date("2026-10-11T18:00:00Z"))).toMatchObject({
      day: 12,
      hour: 0,
      minute: 0,
    });
  });

  it("can read another zone when asked", () => {
    expect(zonedParts(new Date("2026-01-01T03:00:00Z"), "America/New_York")).toMatchObject({
      year: 2025,
      month: 12,
      day: 31,
      hour: 22,
    });
  });

  it("throws on an invalid date", () => {
    expect(() => zonedParts(new Date("nope"))).toThrow(RangeError);
  });
});

describe("todayIn", () => {
  it("is the Dhaka calendar date", () => {
    expect(todayIn(new Date("2026-10-11T17:59:59Z"))).toBe("2026-10-11");
    expect(todayIn(new Date("2026-10-11T18:00:00Z"))).toBe("2026-10-12"); // 00:00 in Dhaka
  });

  it("differs from the UTC date late in the evening UTC", () => {
    expect(todayIn(new Date("2026-12-31T20:00:00Z"))).toBe("2027-01-01");
  });

  it("takes an explicit zone", () => {
    expect(todayIn(new Date("2026-10-11T17:59:59Z"), "UTC")).toBe("2026-10-11");
    expect(todayIn(new Date("2026-01-01T03:00:00Z"), "America/New_York")).toBe("2025-12-31");
  });
});

describe("calendar dates", () => {
  it("parses real dates", () => {
    expect(parseDateOnly("2026-02-28")).toEqual({ year: 2026, month: 2, day: 28 });
    expect(parseDateOnly("2028-02-29")).toEqual({ year: 2028, month: 2, day: 29 });
  });

  it.each([
    "2026-02-29",
    "2026-13-01",
    "2026-00-10",
    "2026-04-31",
    "26-01-01",
    "2026/01/01",
    "",
    "2026-1-1",
  ])("rejects %j", (value) => {
    expect(() => parseDateOnly(value)).toThrow(RangeError);
  });

  it("normalises strings and UTC-midnight Dates (how Prisma returns a date column)", () => {
    expect(toDateOnly("2026-07-01")).toBe("2026-07-01");
    expect(toDateOnly(new Date("2026-07-01T00:00:00Z"))).toBe("2026-07-01");
    expect(() => toDateOnly("2026-02-30")).toThrow(RangeError);
  });

  it("counts whole days, signed", () => {
    expect(daysBetween("2026-10-11", "2026-10-11")).toBe(0);
    expect(daysBetween("2026-10-11", "2026-10-12")).toBe(1);
    expect(daysBetween("2026-10-12", "2026-10-11")).toBe(-1);
    expect(daysBetween("2026-02-28", "2026-03-01")).toBe(1);
    expect(daysBetween("2027-12-31", "2028-03-01")).toBe(61);
    expect(daysBetween("2026-01-01", "2027-01-01")).toBe(365);
  });
});

describe("academic sessions (July start, Dhaka time)", () => {
  it("rolls over at midnight in Dhaka between 30 Jun and 1 Jul", () => {
    // 30 Jun 2026 23:59:59 Dhaka = 17:59:59 UTC; 1 Jul 00:00:00 Dhaka = 18:00:00 UTC on 30 Jun.
    expect(sessionFor(new Date("2026-06-30T17:59:59Z"))).toBe("2025-26");
    expect(sessionFor(new Date("2026-06-30T18:00:00Z"))).toBe("2026-27");
    expect(sessionFor(new Date("2026-07-01T00:00:00Z"))).toBe("2026-27");
  });

  it("judges the month in Dhaka, not UTC", () => {
    // Still 30 Jun in UTC but already 1 Jul in Dhaka.
    expect(new Date("2026-06-30T20:00:00Z").getUTCMonth()).toBe(5);
    expect(sessionFor(new Date("2026-06-30T20:00:00Z"))).toBe("2026-27");
  });

  it("stays in the same session through to the next 30 Jun", () => {
    expect(sessionFor(new Date("2026-10-12T00:00:00Z"))).toBe("2026-27");
    expect(sessionFor(new Date("2027-01-15T00:00:00Z"))).toBe("2026-27");
    expect(sessionFor(new Date("2027-06-30T17:59:59Z"))).toBe("2026-27");
    expect(sessionFor(new Date("2027-06-30T18:00:00Z"))).toBe("2027-28");
  });

  it("handles the new year in Dhaka time (31 Dec UTC evening is already January)", () => {
    expect(sessionStartYear(new Date("2026-12-31T20:00:00Z"))).toBe(2026);
    expect(sessionStartYear(new Date("2026-01-01T00:00:00Z"))).toBe(2025);
  });

  it("labels centuries sensibly", () => {
    expect(sessionLabel(2026)).toBe("2026-27");
    expect(sessionLabel(2009)).toBe("2009-10");
    expect(sessionLabel(2099)).toBe("2099-00");
  });
});

describe("display formats (D-018)", () => {
  it("formats dates as 11 Oct 2026", () => {
    expect(formatDate(new Date("2026-10-11T05:00:00Z"))).toBe("11 Oct 2026");
    expect(formatDate(new Date("2026-09-01T05:00:00Z"))).toBe("1 Sep 2026"); // Sep, never Sept
  });

  it("converts instants to Dhaka before formatting dates", () => {
    expect(formatDate(new Date("2026-10-11T18:00:00Z"))).toBe("12 Oct 2026");
  });

  it("does not convert calendar-date strings", () => {
    expect(formatDate("2026-10-11")).toBe("11 Oct 2026");
    expect(formatDate("2026-01-05")).toBe("5 Jan 2026");
  });

  it("formats date-times as 11 Oct 2026, 23:59", () => {
    expect(formatDateTime(new Date("2026-10-11T17:59:00Z"))).toBe("11 Oct 2026, 23:59");
    expect(formatDateTime(new Date("2026-10-11T18:05:00Z"))).toBe("12 Oct 2026, 00:05");
    expect(formatDateTime(new Date("2026-03-04T03:07:00Z"))).toBe("4 Mar 2026, 09:07");
  });

  it("covers every month name", () => {
    const names = Array.from({ length: 12 }, (_, i) =>
      formatDate(`2026-${String(i + 1).padStart(2, "0")}-15`),
    );
    expect(names.map((n) => n.split(" ")[1])).toEqual([
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ]);
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "less than a minute"],
    [59_999, "less than a minute"],
    [60_000, "1 minute"],
    [12 * 60_000, "12 minutes"],
    [59 * 60_000 + 59_999, "59 minutes"],
    [HOUR, "1 hour"],
    [5 * HOUR, "5 hours"],
    [23 * HOUR + 59 * 60_000, "23 hours"],
    [DAY, "1 day"],
    [2 * DAY, "2 days"],
    [2 * DAY + 23 * HOUR, "2 days"],
    [-5 * HOUR, "5 hours"],
  ])("%d ms -> %s", (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});

describe("formatRelative", () => {
  const now = new Date("2026-10-12T06:00:00Z");
  const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);

  it("says 'in ...' for the future and '... ago' for the past", () => {
    expect(formatRelative(at(2 * DAY), now)).toBe("in 2 days");
    expect(formatRelative(at(-3 * DAY), now)).toBe("3 days ago");
    expect(formatRelative(at(5 * HOUR), now)).toBe("in 5 hours");
    expect(formatRelative(at(-HOUR), now)).toBe("1 hour ago");
    expect(formatRelative(at(30 * 60_000), now)).toBe("in 30 minutes");
    expect(formatRelative(at(DAY), now)).toBe("in 1 day");
  });

  it("says 'just now' within a minute either way", () => {
    expect(formatRelative(now, now)).toBe("just now");
    expect(formatRelative(at(59_999), now)).toBe("just now");
    expect(formatRelative(at(-59_999), now)).toBe("just now");
    expect(formatRelative(at(60_000), now)).toBe("in 1 minute");
    expect(formatRelative(at(-60_000), now)).toBe("1 minute ago");
  });
});

describe("clock", () => {
  it("fixedClock returns the pinned instant, as a fresh Date each time", () => {
    const clock = fixedClock("2026-10-12T06:00:00Z");
    expect(clock().toISOString()).toBe("2026-10-12T06:00:00.000Z");
    expect(clock()).not.toBe(clock());
    expect(fixedClock(new Date("2026-01-01T00:00:00Z"))().toISOString()).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  it("systemClock returns the current time", () => {
    const before = Date.now();
    const value = systemClock().getTime();
    expect(value).toBeGreaterThanOrEqual(before);
    expect(value).toBeLessThanOrEqual(Date.now());
  });
});

describe("wall-clock time to an instant", () => {
  it("reads 23:59 in Dhaka as 17:59 UTC", () => {
    expect(zonedTimeToInstant({ date: "2026-10-11", time: "23:59" }).toISOString()).toBe(
      "2026-10-11T17:59:00.000Z",
    );
  });

  it("crosses the date line the right way: early morning in Dhaka is the previous day in UTC", () => {
    expect(zonedTimeToInstant({ date: "2026-10-12", time: "03:30" }).toISOString()).toBe(
      "2026-10-11T21:30:00.000Z",
    );
    expect(zonedTimeToInstant({ date: "2026-01-01", time: "00:00" }).toISOString()).toBe(
      "2025-12-31T18:00:00.000Z",
    );
  });

  it("round-trips through instantToLocalDateTime for every minute-aligned instant it is given", () => {
    for (const iso of ["2026-10-11T17:59:00Z", "2026-02-28T18:00:00Z", "2027-06-30T23:59:00Z"]) {
      const local = instantToLocalDateTime(new Date(iso));
      expect(zonedTimeToInstant(local).toISOString()).toBe(new Date(iso).toISOString());
    }
    expect(instantToLocalDateTime(new Date("2026-10-11T17:59:00Z"))).toEqual({
      date: "2026-10-11",
      time: "23:59",
    });
  });

  it("drops the seconds when reading an instant back", () => {
    expect(instantToLocalDateTime(new Date("2026-10-11T17:59:42Z")).time).toBe("23:59");
  });

  it("works for a zone with daylight saving and rejects the hour that never happens", () => {
    // New York is UTC-4 in summer and UTC-5 in winter.
    expect(
      zonedTimeToInstant({ date: "2026-07-01", time: "12:00" }, "America/New_York").toISOString(),
    ).toBe("2026-07-01T16:00:00.000Z");
    expect(
      zonedTimeToInstant({ date: "2026-12-01", time: "12:00" }, "America/New_York").toISOString(),
    ).toBe("2026-12-01T17:00:00.000Z");
    // 02:30 on 8 Mar 2026 was skipped when the clocks went forward.
    expect(() =>
      zonedTimeToInstant({ date: "2026-03-08", time: "02:30" }, "America/New_York"),
    ).toThrow(RangeError);
  });

  it("rejects dates and times that are not real", () => {
    expect(() => zonedTimeToInstant({ date: "2026-02-30", time: "10:00" })).toThrow(RangeError);
    expect(() => zonedTimeToInstant({ date: "2026-10-11", time: "24:00" })).toThrow(RangeError);
    expect(() => zonedTimeToInstant({ date: "2026-10-11", time: "9:5" })).toThrow(RangeError);
  });

  it("isLocalTime accepts HH:mm only", () => {
    expect(isLocalTime("00:00")).toBe(true);
    expect(isLocalTime("23:59")).toBe(true);
    expect(isLocalTime("24:00")).toBe(false);
    expect(isLocalTime("12:60")).toBe(false);
    expect(isLocalTime("7:30")).toBe(false);
    expect(isLocalTime("")).toBe(false);
  });
});
