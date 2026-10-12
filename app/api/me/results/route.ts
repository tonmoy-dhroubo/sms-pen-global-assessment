import { route } from "@/lib/api/handler";
import { getMyResults } from "@/lib/services/marks";

// The signed-in student's results: published marks with their classification, everything else as NOT_AVAILABLE only
// (no mark, no reason). Staff get 403.
export const GET = route({ access: "student" }, ({ identity }) =>
  getMyResults(identity.student.id),
);
