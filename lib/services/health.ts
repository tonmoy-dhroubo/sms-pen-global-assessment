import { db } from "@/lib/db";
import { logError } from "@/lib/logger";

export type DependencyStatus = "ok" | "down";

const CHECK_TIMEOUT_MS = 3000;

/** `ok` when a trivial query succeeds within a few seconds; the failure is logged, never returned. */
export async function checkDatabase(requestId?: string): Promise<DependencyStatus> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      db.$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`database check timed out after ${CHECK_TIMEOUT_MS} ms`)),
          CHECK_TIMEOUT_MS,
        );
      }),
    ]);
    return "ok";
  } catch (error) {
    logError("Health check: database is down", error, { requestId });
    return "down";
  } finally {
    clearTimeout(timer);
  }
}
