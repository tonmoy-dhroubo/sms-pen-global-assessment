import { route } from "@/lib/api/handler";
import { getProgramme } from "@/lib/services/programmes";

type Params = { id: string };

// Staff only. A programme with its modules and its fee schedule for every session.
export const GET = route<"staff", Params>({ access: "staff" }, ({ params }) =>
  getProgramme(params.id),
);
