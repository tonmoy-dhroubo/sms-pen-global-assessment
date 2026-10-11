import { route } from "@/lib/api/handler";
import { listMyAssessments } from "@/lib/services/submissions";

// The signed-in student's assessments with deadlines, whether they may upload, and their own submission. Staff get 403.
export const GET = route({ access: "student" }, ({ identity }) =>
  listMyAssessments(identity.student.id),
);
