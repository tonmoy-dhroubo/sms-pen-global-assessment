import { z } from "zod";
import { validateMark } from "@/lib/services/rules/marks";
import type { MarkError } from "@/lib/services/rules/marks";
import { reasonSchema } from "@/lib/validation/reason";
import { versionSchema } from "@/lib/validation/students";

// Request schemas for the marks endpoints (api.md "Marks and results"), shared by the marksheet grid and the Route
// Handlers. The mark rules themselves are the M04 ones (DB-019): 0-100, at most one decimal place.

/** What to say about a mark that `validateMark` refused, in words a marker can act on. */
export const MARK_MESSAGES: Record<MarkError, string> = {
  NOT_A_NUMBER: "Enter a number from 0 to 100, or NS for a non-submission.",
  OUT_OF_RANGE: "A mark must be between 0 and 100.",
  TOO_MANY_DECIMALS: "Use at most one decimal place (for example 67.5).",
};

/** The first problem with typed mark text, or `null` when it is a valid mark. */
export function markProblem(input: string | number): string | null {
  const result = validateMark(input);
  return result.ok ? null : MARK_MESSAGES[result.code];
}

/** Most marks one publish, withhold or unpublish request may name. */
export const MAX_MARK_IDS = 500;

const markValueSchema = z
  .union([z.string(), z.number()], {
    invalid_type_error: 'mark must be a number or text such as "67.5".',
  })
  .superRefine((value, ctx) => {
    const message = markProblem(value);
    if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  });

/**
 * `PUT /api/assessments/{id}/marks/{studentId}`: a `mark` or `isNonSubmission: true` (not both), the `version` that
 * was read when a mark already exists, and a `reason` when that mark is published. Whether a version or reason is
 * needed depends on the stored mark, so the service decides; here they are only checked for shape.
 */
export const putMarkSchema = z
  .object({
    mark: markValueSchema.optional(),
    isNonSubmission: z
      .boolean({ invalid_type_error: "isNonSubmission must be true or false." })
      .optional(),
    version: versionSchema.optional(),
    reason: reasonSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const hasMark = value.mark !== undefined;
    const ns = value.isNonSubmission === true;
    if (hasMark && ns) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mark"],
        message: "Send either a mark or isNonSubmission, not both.",
      });
    } else if (!hasMark && !ns) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mark"],
        message: "Enter a mark from 0 to 100, or mark the work as a non-submission.",
      });
    }
  });
export type PutMarkInput = z.infer<typeof putMarkSchema>;

const markIdsSchema = z
  .array(z.string().uuid("Each mark id must be a valid id."), {
    required_error: "Choose at least one mark.",
  })
  .min(1, "Choose at least one mark.")
  .max(MAX_MARK_IDS, `Choose at most ${MAX_MARK_IDS} marks at a time.`)
  .transform((ids) => [...new Set(ids.map((id) => id.toLowerCase()))]);

/**
 * `POST /api/marks/publish`: exactly one scope (`assessmentId`, `studentId` or `markIds`), and `dryRun` to ask what
 * would happen without changing anything.
 */
export const publishSchema = z
  .object({
    assessmentId: z.string().uuid("assessmentId must be an assessment id.").optional(),
    studentId: z.string().uuid("studentId must be a student id.").optional(),
    markIds: markIdsSchema.optional(),
    dryRun: z.boolean({ invalid_type_error: "dryRun must be true or false." }).default(false),
  })
  .superRefine((value, ctx) => {
    const scopes = [value.assessmentId, value.studentId, value.markIds].filter(
      (scope) => scope !== undefined,
    ).length;
    if (scopes !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assessmentId"],
        message: "Send exactly one of assessmentId, studentId or markIds.",
      });
    }
  });
export type PublishInput = z.infer<typeof publishSchema>;

/** The scope a publish applies to, once validated. */
export type PublishScope = { assessmentId: string } | { studentId: string } | { markIds: string[] };

/** The one scope a validated publish body names (the schema guarantees there is exactly one). */
export function publishScopeOf(input: PublishInput): PublishScope {
  if (input.assessmentId) return { assessmentId: input.assessmentId };
  if (input.studentId) return { studentId: input.studentId };
  return { markIds: input.markIds ?? [] };
}

/** `POST /api/marks/withhold` and `POST /api/marks/unpublish`: the marks and the reason, which is required. */
export const releaseChangeSchema = z.object({
  markIds: markIdsSchema,
  reason: reasonSchema,
});
export type ReleaseChangeInput = z.infer<typeof releaseChangeSchema>;

/** The mark entry form of the grid is a single text box; `NS` (any case) means a non-submission. */
export function parseMarkText(
  text: string,
):
  | { kind: "empty" }
  | { kind: "ns" }
  | { kind: "mark"; value: string }
  | { kind: "invalid"; message: string } {
  const trimmed = text.trim();
  if (trimmed === "") return { kind: "empty" };
  if (trimmed.toLowerCase() === "ns") return { kind: "ns" };
  const message = markProblem(trimmed);
  return message ? { kind: "invalid", message } : { kind: "mark", value: trimmed };
}
