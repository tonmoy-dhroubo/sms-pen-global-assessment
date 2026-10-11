import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { type Env, parseEnv } from "@/lib/env-schema";
import { createStorage, type Storage } from "@/lib/storage-core";

// What the command-line scripts need: the validated environment, a Prisma client and a storage client. They cannot use
// `lib/db` and `lib/storage` (those import `server-only`, which only works inside Next.js), so they build their own
// from the same environment variables.

export function loadEnv(): Env {
  return parseEnv(process.env);
}

export function createPrisma(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export function createStorageFromEnv(env: Env): Storage {
  return createStorage({
    endpoint: env.S3_ENDPOINT,
    publicEndpoint: env.S3_PUBLIC_ENDPOINT,
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  });
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
