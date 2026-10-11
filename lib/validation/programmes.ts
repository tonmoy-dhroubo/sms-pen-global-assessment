import { z } from "zod";
import { calendarDateSchema } from "@/lib/validation/dates";
import { positiveAmountSchema } from "@/lib/validation/fees";

// Fee schedule for one programme and session (api.md "Programmes and modules"): the instalments a student of that
// programme is billed when they are enrolled into the session. Shared by the schedule dialog and the endpoint.

export const MAX_INSTALMENTS = 12;

/** One instalment as the dialog edits it; the number is the row's position. */
export const instalmentRowSchema = z.object({
  amount: positiveAmountSchema,
  dueDate: calendarDateSchema("Enter the due date."),
});

/** What the schedule dialog edits: the rows in order (instalment 1, 2, ...). */
export const feeScheduleFormSchema = z.object({
  instalments: z
    .array(instalmentRowSchema)
    .min(1, "Add at least one instalment.")
    .max(MAX_INSTALMENTS, `A session can have at most ${MAX_INSTALMENTS} instalments.`),
});
export type FeeScheduleFormValues = z.infer<typeof feeScheduleFormSchema>;

/** PUT body: instalment numbers must be exactly 1..n with no gaps or repeats, in any order. */
export const feeScheduleSchema = z.object({
  instalments: z
    .array(
      instalmentRowSchema.extend({
        instalment: z
          .number({
            required_error: "Number the instalment.",
            invalid_type_error: "The instalment number must be a number.",
          })
          .int("The instalment number must be a whole number.")
          .min(1, "The instalment number must be 1 or more."),
      }),
    )
    .min(1, "Add at least one instalment.")
    .max(MAX_INSTALMENTS, `A session can have at most ${MAX_INSTALMENTS} instalments.`)
    .superRefine((rows, ctx) => {
      const numbers = rows.map((row) => row.instalment).sort((a, b) => a - b);
      if (numbers.some((value, index) => value !== index + 1)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Number the instalments 1 to ${rows.length} with no gaps or repeats.`,
        });
      }
    })
    .transform((rows) => [...rows].sort((a, b) => a.instalment - b.instalment)),
});
export type FeeScheduleInput = z.infer<typeof feeScheduleSchema>;
