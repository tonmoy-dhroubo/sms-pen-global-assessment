import "dotenv/config";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { parseEnv } from "@/lib/env-schema";
import type { Storage } from "@/lib/storage-core";
import { createStorageFromEnv } from "@/lib/storage-factory";

// Object-storage plumbing for the integration harness, mirroring test-db.ts: the suite gets its own bucket, creates
// it if needed, empties it before the run, and refuses to touch anything that is not clearly a throw-away bucket.
//
// The suite runs against either storage adapter (D-045): `npm run test:integration` uses MinIO (the default), and
// `STORAGE_DRIVER=filesystem npm run test:integration` uses a throw-away directory and needs no MinIO.

/** Which adapter this run exercises. */
export const isFilesystemRun = (): boolean => process.env.STORAGE_DRIVER === "filesystem";

/** The only directory the filesystem runs use; the dev directory (`./storage`) is never touched. */
export const TEST_STORAGE_DIR = path.resolve("storage-test");

function assertTestDir(dir: string): string {
  if (!path.basename(dir).endsWith("-test")) {
    throw new Error(
      `Refusing to use directory "${dir}": the test storage directory name must end with "-test".`,
    );
  }
  return dir;
}

/** The only bucket the integration tests use. The dev bucket (`submissions`) is never touched. */
export const TEST_S3_BUCKET = "submissions-test";

/** Throws unless the bucket name ends in `-test`; returns the name. */
export function assertTestBucket(bucket: string): string {
  if (!bucket.endsWith("-test")) {
    throw new Error(
      `Refusing to use bucket "${bucket}": the test bucket name must end with "-test".`,
    );
  }
  return bucket;
}

/**
 * Points the app's S3 settings at the test bucket. `S3_BUCKET` is overwritten on purpose (like DATABASE_URL):
 * whatever .env says, tests never touch the dev bucket. Endpoint and credentials come from .env, or default to the
 * local MinIO / the CI service container.
 */
export function applyStorageTestEnv(): void {
  if (isFilesystemRun()) {
    // Overwritten on purpose, like S3_BUCKET below: whatever .env says, tests never touch the dev directory.
    process.env.FILE_STORAGE_DIR = assertTestDir(TEST_STORAGE_DIR);
    return;
  }
  const defaults: Record<string, string> = {
    S3_ENDPOINT: "http://localhost:9000",
    S3_REGION: "us-east-1",
    S3_ACCESS_KEY_ID: "minioadmin",
    S3_SECRET_ACCESS_KEY: "minioadmin",
  };
  for (const [key, value] of Object.entries(defaults)) process.env[key] ||= value;
  process.env.S3_BUCKET = assertTestBucket(TEST_S3_BUCKET);
}

function adminClient(): S3Client {
  return new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION,
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

/** Creates the test bucket if it does not exist (private, which is the default) and deletes everything in it. */
export async function prepareTestBucket(): Promise<void> {
  applyStorageTestEnv();
  if (isFilesystemRun()) {
    const dir = assertTestDir(process.env.FILE_STORAGE_DIR!);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    return;
  }
  const Bucket = assertTestBucket(process.env.S3_BUCKET!);
  const client = adminClient();
  try {
    try {
      await client.send(new HeadBucketCommand({ Bucket }));
    } catch (error) {
      if (
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404
      ) {
        throw new Error(
          `Cannot reach object storage at ${process.env.S3_ENDPOINT} (${(error as Error).message}). ` +
            "Start it with `npm run services:up` (MinIO) before running the integration tests.",
        );
      }
      await client.send(new CreateBucketCommand({ Bucket }));
    }

    let token: string | undefined;
    do {
      const page = await client.send(
        new ListObjectsV2Command({ Bucket, ContinuationToken: token }),
      );
      const Objects = (page.Contents ?? []).map((object) => ({ Key: object.Key! }));
      if (Objects.length > 0) {
        await client.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects, Quiet: true } }));
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  } finally {
    client.destroy();
  }
}

/** A storage client for the adapter this run uses, built the way the app and the command-line scripts build theirs. */
export function createTestStorage(): Storage {
  return createStorageFromEnv(parseEnv(process.env));
}
