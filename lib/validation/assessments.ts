import { z } from "zod";
import { parseSort } from "@/lib/list-params";
import { instantToLocalDateTime, isLocalTime, zonedTimeToInstant } from "@/lib/services/rules/time";
import { calendarDateProblem } from "@/lib/validation/dates";
import { versionSchema } from "@/lib/validation/students";

// Request schemas for /api/assessments (api.md "Assessments"). Shared by the new/edit form and the Route Handlers.
//
// The API takes the deadline as an ISO 8601 instant (UTC is stored). Staff, though, type a date and a time in
// Asia/Dhaka, so the form has its own two fields (`deadlineDate`, `deadlineTime`) and `toDeadlineInstant` turns them
// into the instant the API receives; `toDeadlineFields` goes the other way for editing.

export const ASSESSMENT_STATES = ["open", "past-deadline", "closed"] as const;
export type AssessmentStateFilter = (typeof ASSESSMENT_STATES)[number];

/** Fields the assessment list can be sorted by (`sort=deadline`, `sort=-title`). */
export const ASSESSMENT_SORT_FIELDS = ["deadline", "title", "module"] as const;
export type AssessmentSortField = (typeof ASSESSMENT_SORT_FIELDS)[number];

export const TITLE_MAX_LENGTH = 200;

/** Deadlines outside these years are almost certainly typos (a two-digit year read as year 26, say). */
const EARLIEST_DEADLINE = new Date("2000-01-01T00:00:00Z");
const LATEST_DEADLINE = new Date("2100-01-01T00:00:00Z");
const DEADLINE_RANGE_MESSAGE = "Enter a deadline between the years 2000 and 2099.";

export const moduleIdSchema = z
  .string({ required_error: "Choose a module." })
  .uuid("Choose a module.");

export const titleSchema = z
  .string({ required_error: "Enter a title." })
  .trim()
  .min(1, "Enter a title.")
  .max(TITLE_MAX_LENGTH, `Keep the title under ${TITLE_MAX_LENGTH} characters.`)
  .transform((title) => title.replace(/\s+/g, " "));

/** An ISO 8601 timestamp with an explicit offset or `Z` (e.g. `2026-10-11T17:59:00Z`), read as an instant. */
export const deadlineSchema = z
  .string({ required_error: "Enter a deadline." })
  .datetime({ offset: true, message: "Enter the deadline as an ISO 8601 timestamp." })
  .transform((value) => new Date(value))
  .refine((date) => date >= EARLIEST_DEADLINE && date < LATEST_DEADLINE, DEADLINE_RANGE_MESSAGE);

// --- The form (Dhaka date and time) -------------------------------------------------------------------------------

/** The instant a Dhaka date and time mean, or `null` while either is missing or not real. */
function localInstant(date: string, time: string): Date | null {
  try {
    return zonedTimeToInstant({ date, time });
  } catch {
    return null;
  }
}

export const deadlineDateSchema = z
  .string({ required_error: "Choose the deadline date." })
  .superRefine((value, ctx) => {
    const message = calendarDateProblem(value, "Choose the deadline date.");
    if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  });

export const deadlineTimeSchema = z
  .string({ required_error: "Enter the deadline time." })
  .refine(isLocalTime, "Enter the time as HH:mm, for example 23:59.");

/** What the new/edit form edits: the deadline as it reads on a clock in Asia/Dhaka. */
export const assessmentFormSchema = z
  .object({
    moduleId: moduleIdSchema,
    title: titleSchema,
    deadlineDate: deadlineDateSchema,
    deadlineTime: deadlineTimeSchema,
  })
  .superRefine((value, ctx) => {
    // Once date and time are each valid, the pair must also land inside the range the API accepts.
    const instant = localInstant(value.deadlineDate, value.deadlineTime);
    if (instant && (instant < EARLIEST_DEADLINE || instant >= LATEST_DEADLINE)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["deadlineDate"],
        message: DEADLINE_RANGE_MESSAGE,
      });
    }
  });
export type AssessmentFormValues = z.infer<typeof assessmentFormSchema>;

/** The UTC instant (ISO 8601) for a date and time typed in Asia/Dhaka: what the API is sent. */
export function toDeadlineInstant(date: string, time: string): string {
  return zonedTimeToInstant({ date, time }).toISOString();
}

/** The Dhaka date and time to show in the form for a stored deadline (an ISO string or a `Date`). */
export function toDeadlineFields(deadline: string | Date): {
  deadlineDate: string;
  deadlineTime: string;
} {
  const { date, time } = instantToLocalDateTime(new Date(deadline));
  return { deadlineDate: date, deadlineTime: time };
}

// --- Request bodies -------------------------------------------------------------------------------------------------

export const createAssessmentSchema = z.object({
  moduleId: moduleIdSchema,
  title: titleSchema,
  deadline: deadlineSchema,
});
export type CreateAssessmentInput = z.infer<typeof createAssessmentSchema>;

/** PATCH body: any of title, deadline and module, plus the `version` that was read (DB-016). */
export const updateAssessmentSchema = z
  .object({
    title: titleSchema.optional(),
    deadline: deadlineSchema.optional(),
    moduleId: moduleIdSchema.optional(),
    version: versionSchema,
  })
  .refine(
    (value) =>
      Object.entries(value).some(([key, field]) => key !== "version" && field !== undefined),
    "Change at least one field.",
  );
export type UpdateAssessmentInput = z.infer<typeof updateAssessmentSchema>;

// --- List query -----------------------------------------------------------------------------------------------------

const sortSchema = z
  .string()
  .refine(
    (value) => {
      const spec = parseSort(value);
      return spec !== null && (ASSESSMENT_SORT_FIELDS as readonly string[]).includes(spec.field);
    },
    `Sort by one of: ${ASSESSMENT_SORT_FIELDS.join(", ")} (prefix with - for descending).`,
  )
  .transform((value) => parseSort(value)!);

export const assessmentListQuerySchema = z.object({
  moduleId: z.string().uuid("moduleId must be a module id.").optional(),
  state: z
    .enum(ASSESSMENT_STATES, {
      errorMap: () => ({ message: `state must be one of: ${ASSESSMENT_STATES.join(", ")}.` }),
    })
    .optional(),
  page: z.coerce
    .number({ invalid_type_error: "page must be a number." })
    .int("page must be a whole number.")
    .min(1, "page must be at least 1.")
    .default(1),
  pageSize: z.coerce
    .number({ invalid_type_error: "pageSize must be a number." })
    .int("pageSize must be a whole number.")
    .min(1, "pageSize must be at least 1.")
    .max(100, "pageSize can be at most 100.")
    .default(25),
  sort: sortSchema.optional(),
});
export type AssessmentListQuery = z.infer<typeof assessmentListQuerySchema>;
