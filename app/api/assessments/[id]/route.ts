import { route } from "@/lib/api/handler";
import { getAssessment, updateAssessment } from "@/lib/services/assessments";
import { updateAssessmentSchema, type UpdateAssessmentInput } from "@/lib/validation/assessments";

type Params = { id: string };

// Staff only. GET returns the assessment with its `version` and counts; PATCH edits title, deadline and (while nobody
// has submitted) module with the `version` that was read. A deadline change answers with `LATE_FLAGS_RECALCULATED`.

export const GET = route<"staff", Params>({ access: "staff" }, ({ params }) =>
  getAssessment(params.id),
);

export const PATCH = route<"staff", Params, undefined, UpdateAssessmentInput>(
  { access: "staff", body: updateAssessmentSchema },
  async ({ params, body, warn }) => {
    const { assessment, warnings } = await updateAssessment(params.id, body);
    for (const warning of warnings) warn(warning.code, warning.message, warning.details);
    return assessment;
  },
);
