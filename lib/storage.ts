import "server-only";
import { env } from "./env";
import { createStorage } from "./storage-core";
import type { Storage } from "./storage-core";

// The app's storage client, configured from the validated environment (S3_*). Created on first use, so importing
// this module never fails (or connects) on its own; a missing variable surfaces from `lib/env` when it is needed.
// Callers use the functions below; the S3 details stay in `storage-core.ts`.

export {
  ObjectNotFoundError,
  SUBMISSION_EXTENSIONS,
  buildSubmissionKey,
  contentDisposition,
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
  instance ??= createStorage({
    endpoint: env.S3_ENDPOINT,
    publicEndpoint: env.S3_PUBLIC_ENDPOINT,
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  });
  return instance;
}

export const presignPut: Storage["presignPut"] = (...args) => storage().presignPut(...args);
export const presignGet: Storage["presignGet"] = (...args) => storage().presignGet(...args);
export const headObject: Storage["headObject"] = (...args) => storage().headObject(...args);
export const readFirstBytes: Storage["readFirstBytes"] = (...args) =>
  storage().readFirstBytes(...args);
export const readRange: Storage["readRange"] = (...args) => storage().readRange(...args);
export const sha256: Storage["sha256"] = (...args) => storage().sha256(...args);
export const putObject: Storage["putObject"] = (...args) => storage().putObject(...args);
export const deleteObject: Storage["deleteObject"] = (...args) => storage().deleteObject(...args);
export const deletePrefix: Storage["deletePrefix"] = (...args) => storage().deletePrefix(...args);
export const checkBucket: Storage["checkBucket"] = (...args) => storage().checkBucket(...args);
