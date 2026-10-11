import { respond, route } from "@/lib/api/handler";
import { addCharge } from "@/lib/services/fees";
import { createChargeSchema, type CreateChargeInput } from "@/lib/validation/fees";

type Params = { id: string };

// Staff only. Adds an adjustment or a waiver to a student's account (waivers are entered positive, stored negative).
export const POST = route<"staff", Params, undefined, CreateChargeInput>(
  { access: "staff", body: createChargeSchema },
  async ({ params, body }) => respond(await addCharge(params.id, body), { status: 201 }),
);
