import { z } from "zod";
import { parseSort } from "@/lib/list-params";
import {
  DATE_OF_BIRTH_MESSAGES,
  dateOfBirthProblem,
  sessionStartYearOf,
} from "@/lib/services/rules/student-profile";
import { parseDateOnly, todayIn } from "@/lib/services/rules/time";
import { reasonSchema } from "@/lib/validation/reason";

// Request schemas for /api/students (api.md "Students"). Shared by the new/edit form, the status dialog and the
// Route Handlers, so the browser and the server say the same thing about the same input.

export const ENROLMENT_STATUSES = ["ENROLLED", "DEFERRED", "WITHDRAWN", "COMPLETED"] as const;
export type EnrolmentStatusValue = (typeof ENROLMENT_STATUSES)[number];

/** Statuses a list shows when no status filter is given: withdrawn and completed students are hidden by default. */
export const DEFAULT_STATUS_FILTER: readonly EnrolmentStatusValue[] = ["ENROLLED", "DEFERRED"];

export const FEE_STATES = ["overdue", "outstanding", "credit", "paid"] as const;

/** Fields the student list can be sorted by (`sort=fullName`, `sort=-yearOfStudy`). */
export const STUDENT_SORT_FIELDS = [
  "fullName",
  "studentNumber",
  "programme",
  "academicYear",
  "yearOfStudy",
  "status",
] as const;
export type StudentSortField = (typeof STUDENT_SORT_FIELDS)[number];

export const MAX_YEAR_OF_STUDY = 8;

// --- Profile fields ---------------------------------------------------------------------------------------------------

export const fullNameSchema = z
  .string({ required_error: "Enter the full name." })
  .trim()
  .min(2, "Enter the full name.")
  .max(120, "Keep the name under 120 characters.")
  .transform((name) => name.replace(/\s+/g, " "));

const emailFormat = z.string().email();

/** Trimmed and lower-cased (DB-007). One message at a time, so a form shows a single clear problem. */
export const emailSchema = z
  .string({ required_error: "Enter an email address." })
  .trim()
  .toLowerCase()
  .superRefine((value, ctx) => {
    const message = !value
      ? "Enter an email address."
      : value.length > 254
        ? "Keep the email address under 254 characters."
        : !emailFormat.safeParse(value).success
          ? "Enter a valid email address."
          : null;
    if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  });

function isRealDate(value: string): boolean {
  try {
    parseDateOnly(value);
    return true;
  } catch {
    return false;
  }
}

/** `YYYY-MM-DD`, a real calendar day, not in the future, and an age of 16-100 as of today in Dhaka. */
export const dateOfBirthSchema = z
  .string({ required_error: "Enter the date of birth." })
  .superRefine((value, ctx) => {
    const message = !value
      ? "Enter the date of birth."
      : !/^\d{4}-\d{2}-\d{2}$/.test(value)
        ? "Enter the date as YYYY-MM-DD."
        : !isRealDate(value)
          ? "Enter a real calendar date."
          : (() => {
              const problem = dateOfBirthProblem(value, todayIn(new Date()));
              return problem ? DATE_OF_BIRTH_MESSAGES[problem] : null;
            })();
    if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  });

export const programmeIdSchema = z
  .string({ required_error: "Choose a programme." })
  .uuid("Choose a programme.");

export const academicYearSchema = z
  .string({ required_error: "Choose a session." })
  .refine((value) => sessionStartYearOf(value) !== null, "Choose a session such as 2026-27.");

export const yearOfStudySchema = z
  .number({
    required_error: "Choose the year of study.",
    invalid_type_error: "Choose the year of study.",
  })
  .int("Choose the year of study.")
  .min(1, "Choose the year of study.")
  .max(MAX_YEAR_OF_STUDY, `The year of study is at most ${MAX_YEAR_OF_STUDY}.`);

const profileShape = {
  fullName: fullNameSchema,
  email: emailSchema,
  dateOfBirth: dateOfBirthSchema,
  programmeId: programmeIdSchema,
  academicYear: academicYearSchema,
  yearOfStudy: yearOfStudySchema,
};

/** The fields the new/edit form edits (the Student ID is assigned by the server, the status has its own dialog). */
export const studentFormSchema = z.object(profileShape);
export type StudentFormValues = z.infer<typeof studentFormSchema>;

// --- Request bodies -------------------------------------------------------------------------------------------------

export const createStudentSchema = studentFormSchema.extend({
  /** Resend with `true` after a `DUPLICATE_WARNING` to create the student anyway. */
  confirmDuplicate: z.boolean().optional(),
});
export type CreateStudentInput = z.infer<typeof createStudentSchema>;

export const versionSchema = z
  .number({
    required_error: "Send the version you read.",
    invalid_type_error: "version must be a number.",
  })
  .int("version must be a whole number.")
  .min(1, "version must be at least 1.");

/** PATCH body: any of the profile fields, plus the `version` that was read (DB-016). */
export const updateStudentSchema = z
  .object({
    fullName: fullNameSchema.optional(),
    email: emailSchema.optional(),
    dateOfBirth: dateOfBirthSchema.optional(),
    programmeId: programmeIdSchema.optional(),
    academicYear: academicYearSchema.optional(),
    yearOfStudy: yearOfStudySchema.optional(),
    version: versionSchema,
  })
  .refine(
    (value) =>
      Object.entries(value).some(([key, field]) => key !== "version" && field !== undefined),
    "Change at least one field.",
  );
export type UpdateStudentInput = z.infer<typeof updateStudentSchema>;

export const changeStatusSchema = z.object({
  toStatus: z.enum(ENROLMENT_STATUSES, {
    errorMap: () => ({ message: "Choose the new status." }),
  }),
  /** Required for some transitions (the service decides which); trimmed, at most 500 characters. */
  reason: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    reasonSchema.optional(),
  ),
  version: versionSchema,
});
export type ChangeStatusInput = z.infer<typeof changeStatusSchema>;

// --- List query -----------------------------------------------------------------------------------------------------

/** `?status=A&status=B` arrives as an array, a single `?status=A` as a string; both become an array. */
function repeatable<T extends z.ZodTypeAny>(item: T) {
  return z.preprocess(
    (value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]),
    z.array(item).optional(),
  );
}

const sortSchema = z
  .string()
  .refine(
    (value) => {
      const spec = parseSort(value);
      return spec !== null && (STUDENT_SORT_FIELDS as readonly string[]).includes(spec.field);
    },
    `Sort by one of: ${STUDENT_SORT_FIELDS.join(", ")} (prefix with - for descending).`,
  )
  .transform((value) => parseSort(value)!);

export const studentListQuerySchema = z.object({
  q: z.string().trim().max(100, "Search text is too long.").optional(),
  programmeId: z.string().uuid("programmeId must be a programme id.").optional(),
  status: repeatable(
    z.enum(ENROLMENT_STATUSES, { errorMap: () => ({ message: "Unknown status." }) }),
  ),
  academicYear: academicYearSchema.optional(),
  yearOfStudy: z.coerce
    .number({ invalid_type_error: "yearOfStudy must be a number." })
    .int("yearOfStudy must be a whole number.")
    .min(1, "yearOfStudy must be at least 1.")
    .max(MAX_YEAR_OF_STUDY, `yearOfStudy can be at most ${MAX_YEAR_OF_STUDY}.`)
    .optional(),
  feeState: z
    .enum(FEE_STATES, {
      errorMap: () => ({ message: `feeState must be one of: ${FEE_STATES.join(", ")}.` }),
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
export type StudentListQuery = z.infer<typeof studentListQuerySchema>;
