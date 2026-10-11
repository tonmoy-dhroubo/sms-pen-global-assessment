import { route } from "@/lib/api/handler";
import { ValidationError } from "@/lib/api/errors";
import { replaceFeeSchedule } from "@/lib/services/programmes";
import { academicYearSchema } from "@/lib/validation/students";
import { feeScheduleSchema, type FeeScheduleInput } from "@/lib/validation/programmes";

type Params = { id: string; academicYear: string };

// Staff only. Replaces one session's fee schedule. Only students enrolled afterwards are billed from it: charges
// that already exist never change.
export const PUT = route<"staff", Params, undefined, FeeScheduleInput>(
  { access: "staff", body: feeScheduleSchema },
  async ({ params, body, warn }) => {
    const session = academicYearSchema.safeParse(params.academicYear);
    if (!session.success)
      throw ValidationError.field("academicYear", session.error.issues[0]!.message);
    const { schedule, warnings } = await replaceFeeSchedule(params.id, session.data, body);
    for (const warning of warnings) warn(warning.code, warning.message);
    return schedule;
  },
);
