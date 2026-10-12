import type { z } from "zod";
import { csvResponse } from "@/lib/api/csv-response";
import { route } from "@/lib/api/handler";
import { exportOverdueCsv } from "@/lib/services/exports";
import { balancesQuerySchema } from "@/lib/validation/fees";

// Staff only. The overdue list as a CSV, longest overdue first. The Fees page passes the programme and ageing filters
// it is showing, so the file matches the screen (api.md "Exports").
const querySchema = balancesQuerySchema.pick({ programmeId: true, ageingBucket: true });
type Query = z.infer<typeof querySchema>;

export const GET = route<"staff", Record<string, never>, Query>(
  { access: "staff", query: querySchema },
  async ({ query }) => csvResponse(await exportOverdueCsv(query)),
);
