import "dotenv/config";
import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

// Object-storage plumbing for the integration harness, mirroring test-db.ts: the suite gets its own bucket, creates
// it if needed, empties it before the run, and refuses to touch anything that is not clearly a throw-away bucket.

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
