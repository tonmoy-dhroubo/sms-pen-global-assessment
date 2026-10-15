import "server-only";
import { env } from "./env";
import type { Storage } from "./storage-core";
import { createStorageFromEnv } from "./storage-factory";
import type { FilesystemStorage } from "./storage-fs";

// The app's storage client, configured from the validated environment: S3_* for `STORAGE_DRIVER=s3` (the default), or
// `FILE_STORAGE_DIR` for `filesystem` (D-045). Created on first use, so importing this module never fails (or
// connects) on its own; a missing variable surfaces from `lib/env` when it is needed. Callers use the functions
// below; the details stay in `storage-core.ts` (S3) and `storage-fs.ts` (filesystem).

export {
  ObjectChangedError,
  ObjectNotFoundError,
  PENDING_PREFIX,
  SUBMISSION_EXTENSIONS,
  buildPendingKey,
  buildSubmissionKey,
  contentDisposition,
  isPendingKey,
  submissionPrefix,
} from "./storage-core";
export type {
  ObjectInfo,
  PresignedDownload,
  PresignedUpload,
  Storage,
  StorageConfig,
  SubmissionExtension,
} from "./storage-core";

let instance: Storage | undefined;

function storage(): Storage {
  instance ??= createStorageFromEnv(env);
  return instance;
}

/** The filesystem adapter, for the `/api/uploads` route; `null` when the app is configured for S3. */
export function filesystemStorage(): FilesystemStorage | null {
  if (env.STORAGE_DRIVER !== "filesystem") return null;
  // `createStorageFromEnv` returned the filesystem adapter for this driver.
  return storage() as FilesystemStorage;
}

export const presignPut: Storage["presignPut"] = (...args) => storage().presignPut(...args);
export const presignGet: Storage["presignGet"] = (...args) => storage().presignGet(...args);
export const headObject: Storage["headObject"] = (...args) => storage().headObject(...args);
export const readFirstBytes: Storage["readFirstBytes"] = (...args) =>
  storage().readFirstBytes(...args);
export const readRange: Storage["readRange"] = (...args) => storage().readRange(...args);
export const sha256: Storage["sha256"] = (...args) => storage().sha256(...args);
export const copyObject: Storage["copyObject"] = (...args) => storage().copyObject(...args);
export const putObject: Storage["putObject"] = (...args) => storage().putObject(...args);
export const deleteObject: Storage["deleteObject"] = (...args) => storage().deleteObject(...args);
export const deletePrefix: Storage["deletePrefix"] = (...args) => storage().deletePrefix(...args);
export const checkBucket: Storage["checkBucket"] = (...args) => storage().checkBucket(...args);
