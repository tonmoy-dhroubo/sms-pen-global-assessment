import { respond, route } from "@/lib/api/handler";
import { recordPayment } from "@/lib/services/fees";
import { recordPaymentSchema, type RecordPaymentInput } from "@/lib/validation/fees";

type Params = { id: string };

// Staff only. Records a payment against a student; an overpayment succeeds with an OVERPAYMENT warning.
export const POST = route<"staff", Params, undefined, RecordPaymentInput>(
  { access: "staff", body: recordPaymentSchema },
  async ({ params, body, identity, warn }) => {
    const { warnings, ...result } = await recordPayment(params.id, body, identity.staff.id);
    for (const warning of warnings) warn(warning.code, warning.message);
    return respond(result, { status: 201 });
  },
);
