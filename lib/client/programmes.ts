import { apiRequest } from "@/lib/client/api";
import type { FeeSchedule } from "@/lib/services/programmes";
import type { FeeScheduleInput } from "@/lib/validation/programmes";

// Browser call behind the fee schedule dialog (api.md "Programmes and modules").

export type { FeeSchedule };

export type ScheduleResponse = FeeSchedule & {
  warnings?: { code: string; message: string }[];
};

export function replaceFeeScheduleRequest(
  programmeId: string,
  academicYear: string,
  body: FeeScheduleInput,
): Promise<ScheduleResponse> {
  return apiRequest(`/api/programmes/${programmeId}/fees/${encodeURIComponent(academicYear)}`, {
    method: "PUT",
    body,
  });
}
