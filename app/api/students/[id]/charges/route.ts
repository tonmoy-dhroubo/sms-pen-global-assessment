import { respond, route } from "@/lib/api/handler";
import { addCharge } from "@/lib/services/fees";
import { createChargeSchema, type CreateChargeInput } from "@/lib/validation/fees";

type Params = { id: string };

// Staff only. Adds an adjustment or a waiver to a student's account (waivers are entered positive, stored negative).
export const POST = route<"staff", Params, undefined, CreateChargeInput>(
  { access: "staff", body: createChargeSchema },
  async ({ params, body, identity, warn }) => {
    const { warnings, ...result } = await addCharge(params.id, body, identity.staff.id);
    for (const warning of warnings) warn(warning.code, warning.message);
    return respond(result, { status: 201 });
  },
);
