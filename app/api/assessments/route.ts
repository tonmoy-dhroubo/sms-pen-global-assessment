import { respond, route } from "@/lib/api/handler";
import { createAssessment, listAssessments } from "@/lib/services/assessments";
import {
  assessmentListQuerySchema,
  createAssessmentSchema,
  type AssessmentListQuery,
  type CreateAssessmentInput,
} from "@/lib/validation/assessments";

// Staff only. GET lists assessments with their submission, late, marking and release counts; POST creates one.

export const GET = route<"staff", Record<string, never>, AssessmentListQuery>(
  { access: "staff", query: assessmentListQuerySchema },
  ({ query }) => listAssessments(query),
);

export const POST = route<"staff", Record<string, never>, undefined, CreateAssessmentInput>(
  { access: "staff", body: createAssessmentSchema },
  async ({ body, identity, warn }) => {
    const { assessment, warnings } = await createAssessment(body, identity.staff.id);
    for (const warning of warnings) warn(warning.code, warning.message, warning.details);
    return respond(assessment, { status: 201 });
  },
);
