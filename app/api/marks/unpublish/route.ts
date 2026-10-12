import { route } from "@/lib/api/handler";
import { unpublishMarks } from "@/lib/services/marks";
import { releaseChangeSchema, type ReleaseChangeInput } from "@/lib/validation/marks";

// Staff only. Takes published results back to DRAFT, with a required reason.
export const POST = route<"staff", Record<string, never>, undefined, ReleaseChangeInput>(
  { access: "staff", body: releaseChangeSchema },
  ({ body, identity }) => unpublishMarks(body.markIds, body.reason, identity.staff.id),
);
