import { route } from "@/lib/api/handler";
import { changeStatus } from "@/lib/services/students";
import { changeStatusSchema, type ChangeStatusInput } from "@/lib/validation/students";

type Params = { id: string };

// Staff only. Moves a student to a new status if the transition matrix allows it; every change is recorded.
export const POST = route<"staff", Params, undefined, ChangeStatusInput>(
  { access: "staff", body: changeStatusSchema },
  async ({ params, body, identity }) => {
    const { student } = await changeStatus(params.id, body, identity.staff.id);
    return student;
  },
);
