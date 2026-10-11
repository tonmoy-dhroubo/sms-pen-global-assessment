import { z } from "zod";
import { DEFAULT_OPTIONS_LIMIT, MAX_OPTIONS_LIMIT } from "@/lib/services/identity";

// Request schemas for /api/session (api.md "Session"). Shared by the role-switcher UI and the handlers.

export const switchSessionSchema = z.discriminatedUnion(
  "role",
  [
    z.object({ role: z.literal("staff"), staffId: z.string().uuid("Choose a staff member.") }),
    z.object({ role: z.literal("student"), studentId: z.string().uuid("Choose a student.") }),
  ],
  { errorMap: () => ({ message: 'role must be "staff" or "student".' }) },
);
export type SwitchSessionInput = z.infer<typeof switchSessionSchema>;

export const sessionOptionsQuerySchema = z.object({
  q: z.string().trim().max(100, "Search text is too long.").optional(),
  limit: z.coerce
    .number({ invalid_type_error: "limit must be a number." })
    .int("limit must be a whole number.")
    .min(1, "limit must be at least 1.")
    .max(MAX_OPTIONS_LIMIT, `limit can be at most ${MAX_OPTIONS_LIMIT}.`)
    .default(DEFAULT_OPTIONS_LIMIT),
});
export type SessionOptionsQuery = z.infer<typeof sessionOptionsQuerySchema>;
