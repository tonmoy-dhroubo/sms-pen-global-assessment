import { route } from "@/lib/api/handler";
import { getStudentTimeline } from "@/lib/services/timeline";
import { timelineQuerySchema, type TimelineQuery } from "@/lib/validation/timeline";

type Params = { id: string };

// Staff only. A student's activity, newest first, one cursor page at a time (api.md "Students").
export const GET = route<"staff", Params, TimelineQuery>(
  { access: "staff", query: timelineQuerySchema },
  ({ params, query }) => getStudentTimeline(params.id, query),
);
