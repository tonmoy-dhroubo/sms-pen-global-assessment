import { route } from "@/lib/api/handler";
import { getStudentResults } from "@/lib/services/marks";

type Params = { id: string };

// Staff only. Every mark a student has, with release status and the full history of changes and releases.
export const GET = route<"staff", Params>({ access: "staff" }, ({ params }) =>
  getStudentResults(params.id),
);
