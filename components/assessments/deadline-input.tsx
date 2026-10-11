"use client";

import { useId } from "react";
import { Notice } from "@/components/shared/notice";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { APP_TIME_ZONE, formatDateTime, isLocalTime } from "@/lib/services/rules/time";
import { calendarDateProblem } from "@/lib/validation/dates";
import { toDeadlineInstant } from "@/lib/validation/assessments";

// The deadline of an assessment, typed as a date and a time on a clock in Asia/Dhaka (D-018) and stored as a UTC
// instant. The time zone is stated in the label and the hint, and a line under the fields shows what will be saved,
// both in Dhaka time and in UTC, so nobody has to guess. The component is controlled by two strings (`YYYY-MM-DD` and
// `HH:mm`); `toDeadlineInstant` (lib/validation/assessments.ts) turns them into the instant the API receives.

export interface DeadlineInputProps {
  /** `YYYY-MM-DD`, as typed. */
  date: string;
  /** `HH:mm` (24-hour), as typed. */
  time: string;
  onDateChange: (date: string) => void;
  onTimeChange: (time: string) => void;
  /** Problems to show under each field (from the form's validation or the server). */
  dateError?: string;
  timeError?: string;
  disabled?: boolean;
  /**
   * The server's "now" (ISO). The "deadline is in the past" notice is judged against it, so the first render on the
   * server and in the browser agree.
   */
  now?: string;
  /** Base for the element ids (so two inputs on a page do not clash). */
  idPrefix?: string;
}

/** The instant the typed date and time mean in Dhaka, or `null` while they are incomplete or not real. */
export function deadlineInstant(date: string, time: string): Date | null {
  if (calendarDateProblem(date, "required") || !isLocalTime(time)) return null;
  try {
    return new Date(toDeadlineInstant(date, time));
  } catch {
    return null;
  }
}

function utcText(instant: Date): string {
  // `2026-10-11T17:59:00.000Z` -> `2026-10-11 17:59 UTC`
  return `${instant.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function DeadlineInput({
  date,
  time,
  onDateChange,
  onTimeChange,
  dateError,
  timeError,
  disabled,
  now,
  idPrefix,
}: DeadlineInputProps) {
  const generated = useId();
  const prefix = idPrefix ?? `deadline-${generated.replace(/:/g, "")}`;
  const instant = deadlineInstant(date, time);
  const inPast =
    instant !== null && now !== undefined && instant.getTime() <= new Date(now).getTime();

  return (
    <fieldset className="grid gap-3" disabled={disabled}>
      <legend className="mb-1 text-sm font-medium">
        Deadline <span className="font-normal text-muted-foreground">({APP_TIME_ZONE} time)</span>
      </legend>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={dateError ? true : undefined}>
          <FieldLabel htmlFor={`${prefix}-date`}>Date</FieldLabel>
          <Input
            id={`${prefix}-date`}
            type="date"
            value={date}
            onChange={(event) => onDateChange(event.target.value)}
            aria-invalid={dateError ? true : undefined}
            aria-describedby={`${prefix}-hint`}
          />
          {dateError ? <FieldError errors={[{ message: dateError }]} /> : null}
        </Field>
        <Field data-invalid={timeError ? true : undefined}>
          <FieldLabel htmlFor={`${prefix}-time`}>Time (24-hour)</FieldLabel>
          <Input
            id={`${prefix}-time`}
            type="time"
            value={time}
            onChange={(event) => onTimeChange(event.target.value)}
            aria-invalid={timeError ? true : undefined}
            aria-describedby={`${prefix}-hint`}
          />
          {timeError ? <FieldError errors={[{ message: timeError }]} /> : null}
        </Field>
      </div>
      <FieldDescription id={`${prefix}-hint`}>
        Enter the date and time as they read in Bangladesh ({APP_TIME_ZONE}, UTC+6). Students see
        the same time.
      </FieldDescription>
      <p data-slot="deadline-preview" className="text-sm" aria-live="polite">
        {instant ? (
          <>
            Will be saved as{" "}
            <strong className="font-medium">
              {formatDateTime(instant)} ({APP_TIME_ZONE})
            </strong>
            <span className="text-muted-foreground"> = {utcText(instant)}</span>
          </>
        ) : (
          <span className="text-muted-foreground">Choose a date and a time.</span>
        )}
      </p>
      {inPast ? (
        <Notice>
          This deadline is in the past. You can still save it, for example when entering an
          assessment that has already run; every submission will be marked late.
        </Notice>
      ) : null}
    </fieldset>
  );
}
