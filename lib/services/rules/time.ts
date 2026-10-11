import type { DateOnly } from "./types";

// Time helpers. Nothing here reads the machine's clock or its time zone: "now" is always a parameter, and every
// conversion names its zone explicitly, so results are identical under TZ=UTC and TZ=America/New_York.
// Dates are stored in UTC and shown in one configured zone (D-018, DB-006).

/** The Registry's time zone (UTC+6, no daylight saving). Display and "today" use this zone. */
export const APP_TIME_ZONE = "Asia/Dhaka";

const MS_MINUTE = 60_000;
const MS_HOUR = 60 * MS_MINUTE;
const MS_DAY = 24 * MS_HOUR;

const MONTH_ABBREVIATIONS = [
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
] as const;

export interface ZonedParts {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The wall-clock parts of an instant in the given zone. Throws a `RangeError` for an invalid date. */
export function zonedParts(date: Date, timeZone: string = APP_TIME_ZONE): ZonedParts {
  const parts: Record<string, string> = {};
  for (const part of formatterFor(timeZone).formatToParts(date)) parts[part.type] = part.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Splits `YYYY-MM-DD` and checks it is a real calendar date. Throws a `RangeError` otherwise. */
export function parseDateOnly(value: DateOnly): { year: number; month: number; day: number } {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) throw new RangeError(`Not a YYYY-MM-DD date: "${value}"`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new RangeError(`Not a real calendar date: "${value}"`);
  }
  return { year, month, day };
}

/**
 * Normalises a calendar date. Strings are validated and returned as is. A `Date` is read in UTC, which is how Prisma
 * returns a Postgres `date` column (UTC midnight of that day) - never as an instant in a local zone.
 */
export function toDateOnly(value: Date | DateOnly): DateOnly {
  if (typeof value === "string") {
    parseDateOnly(value);
    return value;
  }
  return `${pad(value.getUTCFullYear(), 4)}-${pad(value.getUTCMonth() + 1, 2)}-${pad(value.getUTCDate(), 2)}`;
}

/** "Today" as a calendar date in the Registry's zone. */
export function todayIn(now: Date, timeZone: string = APP_TIME_ZONE): DateOnly {
  const { year, month, day } = zonedParts(now, timeZone);
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: DateOnly, to: DateOnly): number {
  const a = parseDateOnly(from);
  const b = parseDateOnly(to);
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / MS_DAY,
  );
}

// --- Wall-clock time to an instant (deadline forms) -------------------------------------------------------------------

export interface LocalDateTime {
  /** `YYYY-MM-DD` */
  date: DateOnly;
  /** `HH:mm`, 24-hour */
  time: string;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Whether the text is a 24-hour `HH:mm` time. */
export function isLocalTime(value: string): boolean {
  return TIME_PATTERN.test(value);
}

/** The offset of `timeZone` from UTC at an instant, in milliseconds (positive east of Greenwich). */
function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const p = zonedParts(new Date(instantMs), timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instantMs;
}

/**
 * The instant at which the clocks in `timeZone` read the given date and time (the inverse of `zonedParts`). Used to
 * turn the staff member's "23:59 on 11 Oct" into the UTC timestamp that is stored. Throws a `RangeError` for a date or
 * time that is not real, or one that never happens in the zone (a skipped hour at a daylight-saving change).
 */
export function zonedTimeToInstant(
  { date, time }: LocalDateTime,
  timeZone: string = APP_TIME_ZONE,
): Date {
  const { year, month, day } = parseDateOnly(date);
  const match = TIME_PATTERN.exec(time);
  if (!match) throw new RangeError(`Not an HH:mm time: "${time}"`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);

  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  // The offset depends on the instant being solved for: start from the wall clock read as UTC, correct with the offset
  // found there, then once more with the offset found at the corrected instant.
  const first = wallClockAsUtc - zoneOffsetMs(wallClockAsUtc, timeZone);
  const instant = wallClockAsUtc - zoneOffsetMs(first, timeZone);

  const check = zonedParts(new Date(instant), timeZone);
  if (
    check.year !== year ||
    check.month !== month ||
    check.day !== day ||
    check.hour !== hour ||
    check.minute !== minute
  ) {
    throw new RangeError(`${date} ${time} does not exist in ${timeZone}`);
  }
  return new Date(instant);
}

/** The date and time the clocks in `timeZone` read at an instant (to the minute; seconds are dropped). */
export function instantToLocalDateTime(
  instant: Date,
  timeZone: string = APP_TIME_ZONE,
): LocalDateTime {
  const p = zonedParts(instant, timeZone);
  return {
    date: `${pad(p.year, 4)}-${pad(p.month, 2)}-${pad(p.day, 2)}`,
    time: `${pad(p.hour, 2)}:${pad(p.minute, 2)}`,
  };
}

// --- Academic sessions (DB-015) -------------------------------------------------------------------------------------

/** Start year of the session containing the instant: sessions run July to June, judged in Dhaka time. */
export function sessionStartYear(date: Date): number {
  const { year, month } = zonedParts(date);
  return month >= 7 ? year : year - 1;
}

/** Label for a session starting in `startYear`, e.g. `2026-27`. */
export function sessionLabel(startYear: number): string {
  return `${startYear}-${pad((startYear + 1) % 100, 2)}`;
}

/** The session label for an instant, e.g. 30 Jun 2026 -> `2025-26`, 1 Jul 2026 -> `2026-27` (Dhaka time). */
export function sessionFor(date: Date): string {
  return sessionLabel(sessionStartYear(date));
}

// --- Display (D-018) -----------------------------------------------------------------------------------------------

function monthAbbreviation(month: number): string {
  return MONTH_ABBREVIATIONS[month - 1]!; // month is always 1-12 here
}

/** `11 Oct 2026`. A `Date` is shown in Dhaka time; a `YYYY-MM-DD` string is a calendar date and is not converted. */
export function formatDate(value: Date | DateOnly): string {
  const { year, month, day } = typeof value === "string" ? parseDateOnly(value) : zonedParts(value);
  return `${day} ${monthAbbreviation(month)} ${year}`;
}

/** `11 Oct 2026, 23:59` in Dhaka time. */
export function formatDateTime(value: Date): string {
  const { hour, minute } = zonedParts(value);
  return `${formatDate(value)}, ${pad(hour, 2)}:${pad(minute, 2)}`;
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/**
 * A length of time in its largest whole unit, rounded down: "2 days", "5 hours", "12 minutes". Under a minute it
 * reads "less than a minute". Used for "late by" and relative times.
 */
export function formatDuration(milliseconds: number): string {
  const ms = Math.abs(milliseconds);
  if (ms >= MS_DAY) return plural(Math.floor(ms / MS_DAY), "day");
  if (ms >= MS_HOUR) return plural(Math.floor(ms / MS_HOUR), "hour");
  if (ms >= MS_MINUTE) return plural(Math.floor(ms / MS_MINUTE), "minute");
  return "less than a minute";
}

/** "in 2 days" / "3 days ago", measured in elapsed time from `now`; within a minute either way it is "just now". */
export function formatRelative(target: Date, now: Date): string {
  const difference = target.getTime() - now.getTime();
  if (Math.abs(difference) < MS_MINUTE) return "just now";
  const duration = formatDuration(difference);
  return difference > 0 ? `in ${duration}` : `${duration} ago`;
}
