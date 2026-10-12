import { route } from "@/lib/api/handler";
import { withholdMarks } from "@/lib/services/marks";
import { releaseChangeSchema, type ReleaseChangeInput } from "@/lib/validation/marks";

// Staff only. Holds results back with a required reason (DRAFT or PUBLISHED become WITHHELD).
export const POST = route<"staff", Record<string, never>, undefined, ReleaseChangeInput>(
  { access: "staff", body: releaseChangeSchema },
  ({ body, identity }) => withholdMarks(body.markIds, body.reason, identity.staff.id),
);
