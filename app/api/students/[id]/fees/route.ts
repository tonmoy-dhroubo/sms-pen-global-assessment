import { route } from "@/lib/api/handler";
import { getStudentFees } from "@/lib/services/fees";

type Params = { id: string };

// Staff only. A student's fee summary, charges and payments (voided ones included, with who and why).
export const GET = route<"staff", Params>({ access: "staff" }, ({ params }) =>
  getStudentFees(params.id),
);
