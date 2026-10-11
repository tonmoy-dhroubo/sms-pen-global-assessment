import { db } from "@/lib/db";
import { logError } from "@/lib/logger";
import { checkBucket } from "@/lib/storage";

export type DependencyStatus = "ok" | "down";

const CHECK_TIMEOUT_MS = 3000;

/** `ok` when `probe` succeeds within a few seconds; the failure is logged, never returned. */
async function check(
  name: string,
  probe: () => Promise<unknown>,
  requestId?: string,
): Promise<DependencyStatus> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      probe(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${name} check timed out after ${CHECK_TIMEOUT_MS} ms`)),
          CHECK_TIMEOUT_MS,
        );
      }),
    ]);
    return "ok";
  } catch (error) {
    logError(`Health check: ${name} is down`, error, { requestId });
    return "down";
  } finally {
    clearTimeout(timer);
  }
}

/** `ok` when a trivial query succeeds. */
export function checkDatabase(requestId?: string): Promise<DependencyStatus> {
  return check("database", () => db.$queryRaw`SELECT 1`, requestId);
}

/** `ok` when the bucket exists and the credentials can reach it. */
export function checkStorage(requestId?: string): Promise<DependencyStatus> {
  return check("storage", () => checkBucket(CHECK_TIMEOUT_MS), requestId);
}
