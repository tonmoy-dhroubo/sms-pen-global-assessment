import { parseDateOnly, sessionStartYear, todayIn } from "@/lib/services/rules/time";
import type { DateOnly } from "@/lib/services/rules/types";

// Everything in the seed is dated relative to the moment it runs, `T` (seed-plan rule 1), in the Registry's zone,
// Asia/Dhaka. This module turns "T-21d 23:59" into a real instant, and "the July on or before T" into a session.

/** Dhaka is UTC+6 all year (no daylight saving, D-018), so a wall-clock time converts with a fixed offset. */
const DHAKA_UTC_OFFSET_HOURS = 6;
const MS_HOUR = 3_600_000;
const MS_DAY = 24 * MS_HOUR;

/** `date` plus `days` calendar days (negative to go back). */
export function addDays(date: DateOnly, days: number): DateOnly {
  const { year, month, day } = parseDateOnly(date);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** A calendar date as the UTC-midnight `Date` that Prisma expects for a Postgres `date` column. */
export function dateColumn(date: DateOnly): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/** The instant at which the Dhaka wall clock shows `date` `hour`:`minute`. */
export function dhakaInstant(date: DateOnly, hour = 0, minute = 0): Date {
  const { year, month, day } = parseDateOnly(date);
  return new Date(Date.UTC(year, month - 1, day, hour - DHAKA_UTC_OFFSET_HOURS, minute));
}

export interface Timeline {
  /** The seed moment `T`. */
  readonly now: Date;
  /** `T` as a calendar date in Dhaka. */
  readonly today: DateOnly;
  /** Start year of the current session `S` (the July on or before T). */
  readonly sessionYear: number;
  /** The calendar date `days` from today (negative = past). */
  day(days: number): DateOnly;
  /** The instant at Dhaka time `hour`:`minute` on the day `days` from today. */
  at(days: number, hour?: number, minute?: number): Date;
  /** The instant `hours` before (or, if negative, after) `base`. */
  hoursBefore(base: Date, hours: number): Date;
  /** The instant `ms` milliseconds after `base`. */
  after(base: Date, ms: number): Date;
  /** The 1 July that starts the session `k` sessions before the current one (k = 0 is the current session). */
  sessionStart(k: number): Date;
}

export function createTimeline(now: Date): Timeline {
  const today = todayIn(now);
  const sessionYear = sessionStartYear(now);
  return {
    now,
    today,
    sessionYear,
    day: (days) => addDays(today, days),
    at: (days, hour = 0, minute = 0) => dhakaInstant(addDays(today, days), hour, minute),
    hoursBefore: (base, hours) => new Date(base.getTime() - hours * MS_HOUR),
    after: (base, ms) => new Date(base.getTime() + ms),
    sessionStart: (k) => dhakaInstant(`${sessionYear - k}-07-01`, 0, 0),
  };
}

export const HOUR_MS = MS_HOUR;
export const DAY_MS = MS_DAY;
export const MINUTE_MS = 60_000;
