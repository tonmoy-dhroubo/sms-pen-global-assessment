import { route } from "@/lib/api/handler";
import { getMyFees } from "@/lib/services/fees";

// The signed-in student's own fees: summary, charges (waivers included) and the payments that count. Voided payments
// and the staff behind any row are never sent. Staff get 403.
export const GET = route({ access: "student" }, ({ identity }) => getMyFees(identity.student.id));
