import { NotFoundError } from "@/lib/api/errors";
import { csvResponse } from "@/lib/api/csv-response";
import { route } from "@/lib/api/handler";
import { exportMarksheetCsv } from "@/lib/services/exports";

type Params = { file: string };

// Staff only. One assessment's marksheet as a CSV: `GET /api/exports/marksheet/{assessmentId}.csv` (api.md "Exports").
// Next.js cannot mix a parameter with a fixed suffix in one folder name, so the segment arrives as `<id>.csv` and the
// suffix is taken off here; anything without it is not a file this route serves.
export const GET = route<"staff", Params>({ access: "staff" }, async ({ params }) => {
  if (!params.file.endsWith(".csv")) throw new NotFoundError("Assessment not found.");
  return csvResponse(await exportMarksheetCsv(params.file.slice(0, -".csv".length)));
});
