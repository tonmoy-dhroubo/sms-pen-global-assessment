import { z } from "zod";
import { parseDateOnly } from "@/lib/services/rules/time";

// Calendar-date input (`YYYY-MM-DD`) shared by the fee forms and endpoints (api.md "Format").

export function isRealDate(value: string): boolean {
  try {
    parseDateOnly(value);
    return true;
  } catch {
    return false;
  }
}

/** Why a date string is unusable, as a message; `null` when it is a real `YYYY-MM-DD` date. */
export function calendarDateProblem(value: string, requiredMessage: string): string | null {
  if (!value) return requiredMessage;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Enter the date as YYYY-MM-DD.";
  if (!isRealDate(value)) return "Enter a real calendar date.";
  return null;
}

/** A real calendar day as `YYYY-MM-DD`. */
export function calendarDateSchema(requiredMessage: string) {
  return z.string({ required_error: requiredMessage }).superRefine((value, ctx) => {
    const message = calendarDateProblem(value, requiredMessage);
    if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  });
}
