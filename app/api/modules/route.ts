import { route } from "@/lib/api/handler";
import { listModules } from "@/lib/services/programmes";

// Either role. Modules with the programmes that include them.
export const GET = route({ access: "any" }, async () => ({ items: await listModules() }));
