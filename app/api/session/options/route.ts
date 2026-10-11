import { route } from "@/lib/api/handler";
import { listSessionOptions } from "@/lib/services/identity";
import { sessionOptionsQuerySchema } from "@/lib/validation/session";

// The role switcher's data: every staff member, and students filtered by `?q=` (name or Student ID).
// Open to anyone: it is what the "choose who you are" screen shows before there is a session.
export const GET = route({ access: "public", query: sessionOptionsQuerySchema }, ({ query }) =>
  listSessionOptions(query.q, query.limit),
);
