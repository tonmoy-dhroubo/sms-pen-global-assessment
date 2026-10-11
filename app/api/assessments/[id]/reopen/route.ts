import { route } from "@/lib/api/handler";
import { reopenAssessment } from "@/lib/services/assessments";

type Params = { id: string };

// Staff only. Clears `closedAt` so uploads are accepted again. Reopening an open assessment is a 422 `NOT_CLOSED`.
export const POST = route<"staff", Params>({ access: "staff" }, ({ params }) =>
  reopenAssessment(params.id),
);
