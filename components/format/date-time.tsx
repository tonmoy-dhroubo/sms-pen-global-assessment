import { cn } from "@/lib/utils";
import { formatDate, formatDateTime, formatRelative } from "@/lib/services/rules/time";

// Dates and times in Asia/Dhaka (D-018), using the M04 formatters. The API sends timestamps as ISO strings and
// calendar dates as `YYYY-MM-DD`; both are accepted here.

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A `YYYY-MM-DD` string is a calendar date (never shifted by a time zone); anything else is an instant. */
function isDateOnly(value: Date | string): value is string {
  return typeof value === "string" && DATE_ONLY.test(value);
}

export function toInstant(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export interface DateTimeProps {
  value: Date | string;
  /** Show only the date (`11 Oct 2026`). Always true for a `YYYY-MM-DD` value. */
  dateOnly?: boolean;
  className?: string;
}

/** `11 Oct 2026, 23:59` (or `11 Oct 2026`), inside a `<time>` element carrying the machine-readable value. */
export function DateTime({ value, dateOnly = false, className }: DateTimeProps) {
  if (isDateOnly(value)) {
    return (
      <time dateTime={value} className={className}>
        {formatDate(value)}
      </time>
    );
  }
  const instant = toInstant(value);
  if (Number.isNaN(instant.getTime())) return <span className={className}>&mdash;</span>;
  return (
    <time dateTime={instant.toISOString()} className={className}>
      {dateOnly ? formatDate(instant) : formatDateTime(instant)}
    </time>
  );
}

export interface RelativeTimeProps {
  value: Date | string;
  /**
   * The moment to measure from. Server pages pass their own `now` so the text is the same on the server and in
   * the browser; without it the current time is used.
   */
  now?: Date | string;
  /** Also show the exact date-time after the relative text. */
  withExact?: boolean;
  className?: string;
}

/** "in 2 days" / "3 days ago" / "just now". The full date-time is available as the hover title. */
export function RelativeTime({ value, now, withExact = false, className }: RelativeTimeProps) {
  const target = toInstant(value);
  if (Number.isNaN(target.getTime())) return <span className={className}>&mdash;</span>;
  const reference = now ? toInstant(now) : new Date();

  return (
    <time
      dateTime={target.toISOString()}
      title={formatDateTime(target)}
      // The text is measured from "now"; a client render a moment after the server's may differ in the last minute.
      suppressHydrationWarning
      className={cn(className)}
    >
      {formatRelative(target, reference)}
      {withExact ? ` (${formatDateTime(target)})` : null}
    </time>
  );
}
