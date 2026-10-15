import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { type Env, parseEnv } from "@/lib/env-schema";
import { createStorageFromEnv } from "@/lib/storage-factory";

export { createStorageFromEnv };

// What the command-line scripts need: the validated environment, a Prisma client and a storage client. They cannot use
// `lib/db` and `lib/storage` (those import `server-only`, which only works inside Next.js), so they build their own
// from the same environment variables.

export function loadEnv(): Env {
  return parseEnv(process.env);
}

export function createPrisma(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

/** The storage endpoint the local-only guard must check: S3 only (the filesystem driver is local by definition). */
export function storageTargets(env: Env): Record<string, string> {
  return env.S3_ENDPOINT ? { S3_ENDPOINT: env.S3_ENDPOINT } : {};
}

/** Writes a line to stdout (the scripts' only output channel). */
export const print = (line = ""): void => {
  process.stdout.write(`${line}\n`);
};

/** Prints an error the way the scripts want it (message only, no stack) and exits non-zero. */
export function fail(error: unknown): never {
  process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
