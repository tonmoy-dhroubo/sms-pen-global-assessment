import { route } from "@/lib/api/handler";
import { listSubmissions } from "@/lib/services/assessments";

type Params = { id: string };

// Staff only. Every eligible student (and anyone who already submitted) with status, lateness and file versions.
export const GET = route<"staff", Params>({ access: "staff" }, ({ params }) =>
  listSubmissions(params.id),
);
