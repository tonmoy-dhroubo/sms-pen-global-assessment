import { route } from "@/lib/api/handler";
import { voidPayment } from "@/lib/services/fees";
import { voidPaymentSchema, type VoidPaymentInput } from "@/lib/validation/fees";

type Params = { id: string };

// Staff only. Voids a payment with a reason; payments are never edited or deleted.
export const POST = route<"staff", Params, undefined, VoidPaymentInput>(
  { access: "staff", body: voidPaymentSchema },
  ({ params, body }) => voidPayment(params.id, body),
);
