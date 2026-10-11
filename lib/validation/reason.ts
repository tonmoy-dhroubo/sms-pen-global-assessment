import { z } from "zod";

// A free-text reason for actions that need one (status changes, voiding a payment, withholding or unpublishing
// marks, changing a published mark; api.md). Shared by the reason dialog and the endpoints that take a `reason`.

export const REASON_MAX_LENGTH = 500;

export const reasonSchema = z
  .string({ required_error: "Enter a reason." })
  .trim()
  .min(1, "Enter a reason.")
  .max(REASON_MAX_LENGTH, `Keep the reason under ${REASON_MAX_LENGTH} characters.`);

export const reasonFormSchema = z.object({ reason: reasonSchema });
export type ReasonFormValues = z.infer<typeof reasonFormSchema>;
