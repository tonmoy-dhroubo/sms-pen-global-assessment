import { z } from "zod";

// Query for `GET /api/students/{id}/timeline` (api.md "Students"): cursor paging, newest first.

export const TIMELINE_DEFAULT_LIMIT = 50;
export const TIMELINE_MAX_LIMIT = 100;

export const timelineQuerySchema = z.object({
  /** Return only events strictly older than this instant (the previous page's `nextBefore`). */
  before: z
    .string()
    .datetime({ offset: true, message: "before must be an ISO 8601 timestamp." })
    .transform((value) => new Date(value))
    .optional(),
  limit: z.coerce
    .number({ invalid_type_error: "limit must be a number." })
    .int("limit must be a whole number.")
    .min(1, "limit must be at least 1.")
    .max(TIMELINE_MAX_LIMIT, `limit can be at most ${TIMELINE_MAX_LIMIT}.`)
    .default(TIMELINE_DEFAULT_LIMIT),
});
export type TimelineQuery = z.infer<typeof timelineQuerySchema>;
