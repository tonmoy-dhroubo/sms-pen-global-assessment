import { route } from "@/lib/api/handler";
import { publishMarks } from "@/lib/services/marks";
import { publishSchema, publishScopeOf, type PublishInput } from "@/lib/validation/marks";

// Staff only. Publishes the DRAFT and WITHHELD marks of an assessment, a student, or a list of marks; `dryRun: true`
// returns the preview (counts, missing marks, students with overdue fees) without changing anything. Overdue fees and
// missing marks come back as warnings, never as a block (DB-012).
export const POST = route<"staff", Record<string, never>, undefined, PublishInput>(
  { access: "staff", body: publishSchema },
  async ({ body, identity, warn }) => {
    const { result, warnings } = await publishMarks(
      publishScopeOf(body),
      { dryRun: body.dryRun },
      identity.staff.id,
    );
    for (const warning of warnings) warn(warning.code, warning.message, warning.details);
    return result;
  },
);
