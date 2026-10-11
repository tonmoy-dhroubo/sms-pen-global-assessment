import { route } from "@/lib/api/handler";
import { closeAssessment } from "@/lib/services/assessments";

type Params = { id: string };

// Staff only. Stops all uploads, late ones included. Closing a closed assessment is a 422 `ALREADY_CLOSED`.
export const POST = route<"staff", Params>({ access: "staff" }, ({ params }) =>
  closeAssessment(params.id),
);
