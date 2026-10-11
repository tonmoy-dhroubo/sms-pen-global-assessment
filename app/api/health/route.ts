import { respond, route } from "@/lib/api/handler";
import { checkDatabase, checkStorage } from "@/lib/services/health";

// Liveness for the app and its dependencies; 503 if any is down.
export const GET = route({ access: "public" }, async ({ requestId }) => {
  const [dbStatus, storageStatus] = await Promise.all([
    checkDatabase(requestId),
    checkStorage(requestId),
  ]);
  const result = { db: dbStatus, storage: storageStatus };
  const healthy = Object.values(result).every((status) => status === "ok");
  return respond(result, { status: healthy ? 200 : 503 });
});
