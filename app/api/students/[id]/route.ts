import { route } from "@/lib/api/handler";
import { getStudent, updateStudent } from "@/lib/services/students";
import { updateStudentSchema, type UpdateStudentInput } from "@/lib/validation/students";

type Params = { id: string };

// Staff only. GET returns the full record; PATCH edits profile fields with the `version` that was read.

export const GET = route<"staff", Params>({ access: "staff" }, ({ params }) =>
  getStudent(params.id),
);

export const PATCH = route<"staff", Params, undefined, UpdateStudentInput>(
  { access: "staff", body: updateStudentSchema },
  async ({ params, body, warn }) => {
    const { student, warnings } = await updateStudent(params.id, body);
    for (const warning of warnings) warn(warning.code, warning.message);
    return student;
  },
);
