import { route } from "@/lib/api/handler";
import { listProgrammes } from "@/lib/services/programmes";

// Either role. Programmes with the modules each includes.
export const GET = route({ access: "any" }, async () => ({ items: await listProgrammes() }));
