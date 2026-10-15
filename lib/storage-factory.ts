import type { Env } from "./env-schema";
import { createStorage, type Storage } from "./storage-core";
import { createFilesystemStorage, type FilesystemStorage } from "./storage-fs";

// Builds the storage adapter the environment asks for (STORAGE_DRIVER, D-045). Shared by the app (`lib/storage.ts`) and
// the command-line scripts (`db/seed/context.ts`), neither of which can share the other's `server-only` imports.

export function createFilesystemStorageFromEnv(env: Env): FilesystemStorage {
  return createFilesystemStorage({ rootDir: env.FILE_STORAGE_DIR, secret: env.SESSION_SECRET });
}

export function createStorageFromEnv(env: Env): Storage {
  if (env.STORAGE_DRIVER === "filesystem") return createFilesystemStorageFromEnv(env);
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
