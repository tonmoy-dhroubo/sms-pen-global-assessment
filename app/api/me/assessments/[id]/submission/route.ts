import { route } from "@/lib/api/handler";
import { getMyAssessment } from "@/lib/services/submissions";

type Params = { id: string };

// One assessment with the student's own submission, every version and its receipt. 404 for anything that is not theirs.
export const GET = route<"student", Params>({ access: "student" }, ({ params, identity }) =>
  getMyAssessment(identity.student.id, params.id),
);
