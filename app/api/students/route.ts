import { respond, route } from "@/lib/api/handler";
import { createStudent, listStudents } from "@/lib/services/students";
import {
  createStudentSchema,
  studentListQuerySchema,
  type CreateStudentInput,
  type StudentListQuery,
} from "@/lib/validation/students";

// Staff only. GET searches and filters the student list; POST enrols a new student (api.md "Students").

export const GET = route<"staff", Record<string, never>, StudentListQuery>(
  { access: "staff", query: studentListQuerySchema },
  ({ query }) => listStudents(query),
);

export const POST = route<"staff", Record<string, never>, undefined, CreateStudentInput>(
  { access: "staff", body: createStudentSchema },
  async ({ body, identity, warn }) => {
    const { student, warnings } = await createStudent(body, identity.staff.id);
    for (const warning of warnings) warn(warning.code, warning.message);
    return respond(student, { status: 201 });
  },
);
