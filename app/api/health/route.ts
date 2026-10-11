import { respond, route } from "@/lib/api/handler";
import { checkDatabase } from "@/lib/services/health";

// Liveness for the app and its dependencies; 503 if any is down. Storage is added in M06.
export const GET = route({ access: "public" }, async ({ requestId }) => {
  const result = { db: await checkDatabase(requestId) };
  const healthy = Object.values(result).every((status) => status === "ok");
  return respond(result, { status: healthy ? 200 : 503 });
});
