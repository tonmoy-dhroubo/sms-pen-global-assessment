import { createHash, randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// The S3 wrapper (D-006, D-012, D-013). It speaks plain S3, so the same code serves MinIO locally and Supabase
// Storage when hosted. This file has no `server-only` and no environment access so it can be unit-tested;
// `lib/storage.ts` wires it to the validated environment.

export interface StorageConfig {
  /** Endpoint the server uses to reach storage. */
  endpoint: string;
  /** Endpoint embedded in presigned URLs, for the browser. Defaults to `endpoint`. */
  publicEndpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Bucket in the path rather than the hostname: `true` for both MinIO and Supabase. */
  forcePathStyle: boolean;
}

export interface PresignedUpload {
  url: string;
  /** Headers the browser must send with the PUT, exactly as given (the URL signs them). */
  headers: { "Content-Type": string };
  expiresAt: Date;
}

export interface PresignedDownload {
  url: string;
  expiresAt: Date;
}

export interface ObjectInfo {
  sizeBytes: number;
  contentType: string | null;
  /** When the object finished arriving in the bucket (second resolution). The basis for D-023. */
  lastModified: Date;
  etag: string | null;
}

/** Thrown when an operation needs an object that does not exist. */
export class ObjectNotFoundError extends Error {
  constructor(readonly key: string) {
    super(`Storage object not found: ${key}`);
    this.name = "ObjectNotFoundError";
  }
}

// --- Object keys -------------------------------------------------------------------------------------------------

/** The only file types a submission may have. The extension comes from here, never from the uploaded name. */
export const SUBMISSION_EXTENSIONS = ["pdf", "docx"] as const;
export type SubmissionExtension = (typeof SUBMISSION_EXTENSIONS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(label: string, value: string): void {
  if (!UUID.test(value)) throw new TypeError(`${label} must be a UUID, got "${value}"`);
}

/** Everything stored for an assessment (or, with `studentId`, for one student on it). Ends with `/`. */
export function submissionPrefix(assessmentId: string, studentId?: string): string {
  assertUuid("assessmentId", assessmentId);
  if (studentId === undefined) return `submissions/${assessmentId}/`;
  assertUuid("studentId", studentId);
  return `submissions/${assessmentId}/${studentId}/`;
}

/**
 * `submissions/<assessmentId>/<studentId>/<uuid>.<ext>`. Server-generated: the uploaded file name is never part of
 * a key (it is kept only as database metadata), so a key can never carry path tricks or unexpected characters.
 */
export function buildSubmissionKey(
  assessmentId: string,
  studentId: string,
  extension: SubmissionExtension,
): string {
  if (!SUBMISSION_EXTENSIONS.includes(extension)) {
    throw new TypeError(`Unsupported submission extension "${extension}"`);
  }
  return `${submissionPrefix(assessmentId, studentId)}${randomUUID()}.${extension}`;
}

// --- Download file names -----------------------------------------------------------------------------------------

const MAX_NAME_LENGTH = 200;

/** Everything except printable ASCII and the characters that need escaping in a quoted header value. */
function asciiFallback(name: string): string {
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 && /^\.[A-Za-z0-9]{1,10}$/.test(name.slice(dot)) ? name.slice(dot) : "";
  const base = (extension ? name.slice(0, dot) : name)
    .replace(/[^\x20-\x7e]|["\\/%;]/g, "_")
    .replace(/_{2,}/g, "_")
    .trim();
  return `${/[A-Za-z0-9]/.test(base) ? base : "download"}${extension}`;
}

/** RFC 5987 `value-chars`: percent-encode everything but unreserved characters, plus the ones `encodeURIComponent` leaves. */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * A `Content-Disposition` header value for downloading with the student's original file name (RFC 6266): a plain
 * ASCII `filename` fallback for old clients, and `filename*` (RFC 5987) carrying the exact UTF-8 name, so a Bengali
 * name such as "প্রতিবেদন.pdf" survives. Control characters and path separators are removed.
 */
export function contentDisposition(fileName: string): string {
  const cleaned = Array.from(fileName.normalize("NFC"))
    // Control characters (header injection) and the path separators.
    .filter((char) => !/[\x00-\x1f\x7f]/.test(char) && char !== "/" && char !== "\\")
    .slice(0, MAX_NAME_LENGTH)
    .join("")
    .trim();
  const name = cleaned === "" ? "download" : cleaned;
  return `attachment; filename="${asciiFallback(name)}"; filename*=UTF-8''${encodeRfc5987(name)}`;
}

// --- The client --------------------------------------------------------------------------------------------------

/** SigV4 allows presigned URLs to live at most 7 days. */
const MAX_PRESIGN_SECONDS = 7 * 24 * 60 * 60;

function assertExpiry(expiresIn: number): void {
  if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > MAX_PRESIGN_SECONDS) {
    throw new RangeError(
      `expiresIn must be a whole number of seconds between 1 and ${MAX_PRESIGN_SECONDS}`,
    );
  }
}

function isMissingObject(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NoSuchKey" || e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404;
}

function isInvalidRange(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "InvalidRange" || e?.$metadata?.httpStatusCode === 416;
}

export function createStorage(config: StorageConfig) {
  const credentials = {
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  };
  const make = (endpoint: string) =>
    new S3Client({
      endpoint,
      region: config.region,
      credentials,
      forcePathStyle: config.forcePathStyle,
      // Since mid-2025 the SDK adds CRC32 checksums to every request by default. For a presigned PUT the URL is
      // signed before the file exists, so it embeds the CRC32 of an empty body ("AAAAAA=="), which is wrong for
      // the real upload: AWS S3 rejects that, and S3-compatible servers vary. Only compute checksums when an
      // operation requires them (DeleteObjects does), and skip response validation for the same compatibility.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });

  // Server-side calls use `endpoint`; presigned URLs are signed for the host the browser will call (the host is
  // part of the signature, so it cannot be swapped after signing).
  const client = make(config.endpoint);
  const signer =
    config.publicEndpoint && config.publicEndpoint !== config.endpoint
      ? make(config.publicEndpoint)
      : client;
  const Bucket = config.bucket;

  return {
    bucket: config.bucket,

    /**
     * A presigned `PUT` URL for one object. The signature covers `Content-Type` and `Content-Length`, so the
     * object stored is exactly the declared type and size: a PUT with a different type, or a body of a different
     * length, gets 403 SignatureDoesNotMatch. (Key, bucket, method and expiry are bound as always.) The browser
     * sends `headers`; it sets Content-Length itself from the file.
     */
    async presignPut(
      key: string,
      contentType: string,
      sizeBytes: number,
      expiresIn: number,
    ): Promise<PresignedUpload> {
      assertExpiry(expiresIn);
      if (!Number.isInteger(sizeBytes) || sizeBytes < 0) {
        throw new RangeError("sizeBytes must be a non-negative whole number");
      }
      const url = await getSignedUrl(
        signer,
        new PutObjectCommand({
          Bucket,
          Key: key,
          ContentType: contentType,
          ContentLength: sizeBytes,
        }),
        {
          expiresIn,
          // By default the presigner signs only `host`; these two must be signed to be enforced.
          signableHeaders: new Set(["content-type", "content-length"]),
        },
      );
      return {
        url,
        headers: { "Content-Type": contentType },
        expiresAt: new Date(Date.now() + expiresIn * 1000),
      };
    },

    /** A presigned `GET` URL that downloads the object under `downloadName` (the original file name). */
    async presignGet(
      key: string,
      downloadName: string,
      expiresIn: number,
    ): Promise<PresignedDownload> {
      assertExpiry(expiresIn);
      const url = await getSignedUrl(
        signer,
        new GetObjectCommand({
          Bucket,
          Key: key,
          ResponseContentDisposition: contentDisposition(downloadName),
        }),
        { expiresIn },
      );
      return { url, expiresAt: new Date(Date.now() + expiresIn * 1000) };
    },

    /** Size, type and arrival time of an object, or `null` if it does not exist. */
    async headObject(key: string): Promise<ObjectInfo | null> {
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return {
          sizeBytes: head.ContentLength ?? 0,
          contentType: head.ContentType ?? null,
          lastModified: head.LastModified ?? new Date(0),
          etag: head.ETag ?? null,
        };
      } catch (error) {
        if (isMissingObject(error)) return null;
        throw error;
      }
    },

    /**
     * `length` bytes starting at `offset` (fewer if the object ends first), read with a ranged GET. For signature
     * checks and for reading the end of a ZIP file without downloading the rest.
     */
    async readRange(key: string, offset: number, length: number): Promise<Buffer> {
      if (!Number.isInteger(offset) || offset < 0) {
        throw new RangeError("offset must be a non-negative whole number");
      }
      if (!Number.isInteger(length) || length < 1) {
        throw new RangeError("length must be a positive whole number");
      }
      try {
        const result = await client.send(
          new GetObjectCommand({
            Bucket,
            Key: key,
            Range: `bytes=${offset}-${offset + length - 1}`,
          }),
        );
        return Buffer.from((await result.Body?.transformToByteArray()) ?? []);
      } catch (error) {
        if (isMissingObject(error)) throw new ObjectNotFoundError(key);
        // A range that starts at or past the end (or any range on an empty object) is "not satisfiable": no bytes.
        if (isInvalidRange(error)) return Buffer.alloc(0);
        throw error;
      }
    },

    /** The first `n` bytes (fewer if the object is shorter), read with a ranged GET. For signature checks. */
    async readFirstBytes(key: string, n: number): Promise<Buffer> {
      if (!Number.isInteger(n) || n < 1) throw new RangeError("n must be a positive whole number");
      return this.readRange(key, 0, n);
    },

    /** Lower-case hex SHA-256 of the whole object, hashed as it streams (never held in memory). */
    async sha256(key: string): Promise<string> {
      let body: Readable | undefined;
      try {
        const result = await client.send(new GetObjectCommand({ Bucket, Key: key }));
        body = result.Body as Readable | undefined;
      } catch (error) {
        if (isMissingObject(error)) throw new ObjectNotFoundError(key);
        throw error;
      }
      const hash = createHash("sha256");
      if (body) for await (const chunk of body) hash.update(chunk as Uint8Array);
      return hash.digest("hex");
    },

    /** Server-side upload (seed data, tests). Browsers use `presignPut` instead. */
    async putObject(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void> {
      await client.send(
        new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },

    /** Deletes one object. Deleting a key that does not exist is not an error (S3 semantics). */
    async deleteObject(key: string): Promise<void> {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },

    /** Deletes every object whose key starts with `prefix` (all pages of the listing). Returns how many. */
    async deletePrefix(prefix: string): Promise<number> {
      let deleted = 0;
      let continuationToken: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({
            Bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          }),
        );
        const keys = (page.Contents ?? []).flatMap((object) =>
          object.Key === undefined ? [] : [{ Key: object.Key }],
        );
        if (keys.length > 0) {
          const result = await client.send(
            new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys, Quiet: true } }),
          );
          if (result.Errors?.length) {
            const first = result.Errors[0]!;
            throw new Error(
              `Could not delete ${result.Errors.length} object(s): ${first.Key}: ${first.Message}`,
            );
          }
          deleted += keys.length;
        }
        continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (continuationToken);
      return deleted;
    },

    /**
     * Creates the (private) bucket if it does not exist yet; does nothing if it does. For scripts that set up a
     * fresh environment (the seed in CI). Locally `minio-init` creates the bucket; the app never calls this.
     */
    async ensureBucket(): Promise<void> {
      try {
        await client.send(new HeadBucketCommand({ Bucket }));
      } catch (error) {
        if (!isMissingObject(error)) throw error; // 404: the bucket is missing; anything else is a real failure
        await client.send(new CreateBucketCommand({ Bucket }));
      }
    },

    /** Throws unless the bucket exists and the credentials can reach it. Used by the health check. */
    async checkBucket(timeoutMs: number): Promise<void> {
      await client.send(new HeadBucketCommand({ Bucket }), {
        abortSignal: AbortSignal.timeout(timeoutMs),
      });
    },
  };
}

export type Storage = ReturnType<typeof createStorage>;
