import { respond, route } from "@/lib/api/handler";
import { putMark } from "@/lib/services/marks";
import { putMarkSchema, type PutMarkInput } from "@/lib/validation/marks";

type Params = { id: string; studentId: string };

// Staff only. Enters or changes one student's mark (or marks the work as a non-submission). The first entry is a
// DRAFT (201); a later change needs the `version` that was read, and a `reason` when the mark is published (200).
export const PUT = route<"staff", Params, undefined, PutMarkInput>(
  { access: "staff", body: putMarkSchema },
  async ({ params, body, identity }) => {
    const result = await putMark(params.id, params.studentId, body, identity.staff.id);
    return respond(result.mark, { status: result.created ? 201 : 200 });
  },
);
