import { route } from "@/lib/api/handler";
import { getMarksheet } from "@/lib/services/marks";

type Params = { id: string };

// Staff only. The marksheet: every student on it with submission status and lateness, and their mark, classification
// and release status when one has been entered.
export const GET = route<"staff", Params>({ access: "staff" }, ({ params }) =>
  getMarksheet(params.id),
);
