import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { afterAll, describe, expect, it } from "vitest";
import {
  ObjectChangedError,
  ObjectNotFoundError,
  buildPendingKey,
  buildSubmissionKey,
  copyObject,
  deleteObject,
  deletePrefix,
  headObject,
  presignGet,
  presignPut,
  putObject,
  readFirstBytes,
  readRange,
  sha256,
} from "@/lib/storage";
import { createStorage } from "@/lib/storage-core";

// Real MinIO (the `submissions-test` bucket, see tests/support/test-storage.ts). Browser uploads are simulated with
// plain `fetch` and only the headers the API hands out, which is all a browser would send.

const RUN = randomUUID();
const ASSESSMENT = randomUUID();
const STUDENT = randomUUID();
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(2048)]);

/** Objects created by a test live under this prefix and are removed afterwards. */
const scratch = (name: string) => `tests/${RUN}/${name}`;

afterAll(async () => {
  await deletePrefix(`tests/${RUN}/`);
  await deletePrefix(`submissions/${ASSESSMENT}/`);
  await deletePrefix(`pending/${ASSESSMENT}/`);
});

async function browserPut(
  upload: { url: string; headers: Record<string, string> },
  body: Buffer,
  headers: Record<string, string> = upload.headers,
) {
  return fetch(upload.url, { method: "PUT", headers, body: new Uint8Array(body) });
}

describe("put, head, read, hash, delete", () => {
  it("round-trips an object through every operation", async () => {
    const key = scratch("round-trip.pdf");
    await putObject(key, PDF, "application/pdf");

    const info = await headObject(key);
    expect(info).toMatchObject({ sizeBytes: PDF.length, contentType: "application/pdf" });
    expect(info!.lastModified.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(info!.lastModified.getTime()).toBeLessThanOrEqual(Date.now() + 5_000);

    expect((await readFirstBytes(key, 5)).toString("latin1")).toBe("%PDF-");
    expect(await sha256(key)).toBe(createHash("sha256").update(PDF).digest("hex"));

    await deleteObject(key);
    expect(await headObject(key)).toBeNull();
    await expect(deleteObject(key)).resolves.toBeUndefined(); // deleting twice is fine
  });

  it("headObject is null for a key that was never written", async () => {
    expect(await headObject(scratch("nope.pdf"))).toBeNull();
  });

  it("readFirstBytes returns only what exists when the object is shorter than n", async () => {
    const key = scratch("short.bin");
    await putObject(key, Buffer.from("abc"), "application/octet-stream");
    expect((await readFirstBytes(key, 1024)).toString()).toBe("abc");
  });

  it("readFirstBytes returns nothing for an empty object", async () => {
    const key = scratch("empty.bin");
    await putObject(key, Buffer.alloc(0), "application/octet-stream");
    expect((await readFirstBytes(key, 8)).length).toBe(0);
    expect(await sha256(key)).toBe(createHash("sha256").digest("hex"));
  });

  it("readFirstBytes and sha256 throw ObjectNotFoundError for a missing key", async () => {
    await expect(readFirstBytes(scratch("missing"), 4)).rejects.toBeInstanceOf(ObjectNotFoundError);
    await expect(sha256(scratch("missing"))).rejects.toBeInstanceOf(ObjectNotFoundError);
  });

  it("readRange reads a slice from the middle and clips at the end of the object", async () => {
    const key = scratch("range.bin");
    await putObject(key, Buffer.from("0123456789"), "application/octet-stream");
    expect((await readRange(key, 3, 4)).toString()).toBe("3456");
    expect((await readRange(key, 6, 100)).toString()).toBe("6789");
    expect((await readRange(key, 10, 5)).length).toBe(0); // starts at the end: nothing left
    expect((await readRange(key, 50, 5)).length).toBe(0); // starts past the end
    await expect(readRange(scratch("missing"), 0, 4)).rejects.toBeInstanceOf(ObjectNotFoundError);
    await expect(readRange(key, -1, 4)).rejects.toBeInstanceOf(RangeError);
    await expect(readRange(key, 0, 0)).rejects.toBeInstanceOf(RangeError);
  });

  it("hashes a multi-megabyte object by streaming", async () => {
    const big = randomBytes(8 * 1024 * 1024);
    const key = scratch("big.bin");
    await putObject(key, big, "application/octet-stream");
    expect(await sha256(key)).toBe(createHash("sha256").update(big).digest("hex"));
  });
});

describe("presigned PUT from outside the SDK", () => {
  it("accepts a plain fetch sending only the Content-Type, and the object is then readable", async () => {
    const key = buildSubmissionKey(ASSESSMENT, STUDENT, "pdf");
    const upload = await presignPut(key, "application/pdf", PDF.length, 300);
    expect(upload.headers).toEqual({ "Content-Type": "application/pdf" });

    const response = await browserPut(upload, PDF);
    expect(response.status).toBe(200);

    expect(await headObject(key)).toMatchObject({
      sizeBytes: PDF.length,
      contentType: "application/pdf",
    });
    expect(await sha256(key)).toBe(createHash("sha256").update(PDF).digest("hex"));

    // ... and readable through presignGet, again without the SDK.
    const download = await presignGet(key, "report.pdf", 300);
    const fetched = await fetch(download.url);
    expect(fetched.status).toBe(200);
    expect(Buffer.from(await fetched.arrayBuffer()).equals(PDF)).toBe(true);
  });

  it("rejects a different Content-Type than the one declared", async () => {
    const key = buildSubmissionKey(ASSESSMENT, STUDENT, "pdf");
    const upload = await presignPut(key, "application/pdf", PDF.length, 300);
    const response = await browserPut(upload, PDF, { "Content-Type": "text/html" });
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("SignatureDoesNotMatch");
    expect(await headObject(key)).toBeNull();
  });

  it("rejects a body of a different size than the one declared", async () => {
    const key = buildSubmissionKey(ASSESSMENT, STUDENT, "pdf");
    const upload = await presignPut(key, "application/pdf", PDF.length - 1, 300);
    const response = await browserPut(upload, PDF);
    expect(response.status).toBe(403);
    expect(await headObject(key)).toBeNull();
  });

  it("cannot be redirected to another key", async () => {
    const key = buildSubmissionKey(ASSESSMENT, STUDENT, "pdf");
    const other = buildSubmissionKey(ASSESSMENT, STUDENT, "pdf");
    const upload = await presignPut(key, "application/pdf", PDF.length, 300);
    const redirected = { ...upload, url: upload.url.replace(key, other) };
    expect((await browserPut(redirected, PDF)).status).toBe(403);
    expect(await headObject(other)).toBeNull();
  });

  it("stops working after it expires", async () => {
    const key = buildSubmissionKey(ASSESSMENT, STUDENT, "pdf");
    const upload = await presignPut(key, "application/pdf", PDF.length, 1);
    await new Promise((resolve) => setTimeout(resolve, 2200));
    const response = await browserPut(upload, PDF);
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("expired");
  });

  it("works with a client signing for a different public endpoint", async () => {
    // The server reaches storage on `localhost`; the browser is told `127.0.0.1`. The URL must be signed for the
    // host the browser will call.
    const server = new URL(process.env.S3_ENDPOINT!);
    const publicEndpoint = `${server.protocol}//127.0.0.1:${server.port || "80"}`;
    const split = createStorage({
      endpoint: process.env.S3_ENDPOINT!,
      publicEndpoint,
      region: process.env.S3_REGION!,
      bucket: process.env.S3_BUCKET!,
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      forcePathStyle: true,
    });
    const key = scratch("public-endpoint.pdf");
    const upload = await split.presignPut(key, "application/pdf", PDF.length, 300);
    expect(new URL(upload.url).hostname).toBe("127.0.0.1");
    expect((await browserPut(upload, PDF)).status).toBe(200);
    expect(await headObject(key)).toMatchObject({ sizeBytes: PDF.length });

    const download = await split.presignGet(key, "x.pdf", 300);
    expect(new URL(download.url).hostname).toBe("127.0.0.1");
    expect((await fetch(download.url)).status).toBe(200);
  });
});

describe("the SDK's default checksum behaviour (why requestChecksumCalculation is WHEN_REQUIRED)", () => {
  it("embeds the CRC32 of an empty body in a presigned PUT URL when left at the default", async () => {
    const defaultClient = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      },
    });
    const url = await getSignedUrl(
      defaultClient,
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: scratch("crc.pdf"),
        ContentType: "application/pdf",
      }),
      { expiresIn: 60 },
    );
    // AAAAAA== is the base64 CRC32 of zero bytes: wrong for any real upload, hence our override.
    expect(new URL(url).searchParams.get("x-amz-checksum-crc32")).toBe("AAAAAA==");
  });
});

describe("presigned GET", () => {
  it("downloads under the original file name, including a Bengali one", async () => {
    const key = scratch("named.pdf");
    await putObject(key, PDF, "application/pdf");

    const plain = await fetch((await presignGet(key, "Final Report.pdf", 300)).url);
    expect(plain.status).toBe(200);
    expect(plain.headers.get("content-disposition")).toBe(
      `attachment; filename="Final Report.pdf"; filename*=UTF-8''Final%20Report.pdf`,
    );

    const bengali = await fetch((await presignGet(key, "প্রতিবেদন.pdf", 300)).url);
    expect(bengali.status).toBe(200);
    const header = bengali.headers.get("content-disposition")!;
    expect(header).toContain(`filename="download.pdf"`);
    expect(decodeURIComponent(/filename\*=UTF-8''(\S+)$/.exec(header)![1]!)).toBe("প্রতিবেদন.pdf");
  });

  it("denies anonymous access to the object and to the bucket", async () => {
    const key = scratch("private.pdf");
    await putObject(key, PDF, "application/pdf");
    const base = `${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET}`;
    expect((await fetch(`${base}/${key}`)).status).toBe(403);
    expect((await fetch(`${base}/?list-type=2`)).status).toBe(403);
  });

  it("is denied when the signature is tampered with", async () => {
    const key = scratch("tamper.pdf");
    await putObject(key, PDF, "application/pdf");
    const { url } = await presignGet(key, "a.pdf", 300);
    const tampered = url.replace(/X-Amz-Signature=([0-9a-f]{4})/, (_, head: string) =>
      head === "0000" ? "X-Amz-Signature=1111" : "X-Amz-Signature=0000",
    );
    expect(tampered).not.toBe(url);
    expect((await fetch(tampered)).status).toBe(403);
  });
});

describe("copyObject (confirm copies a pending upload to a final key, D-042)", () => {
  it("copies the bytes and the content type, and leaves the source in place", async () => {
    const source = scratch("copy-source.pdf");
    const destination = scratch("copy-destination.pdf");
    await putObject(source, PDF, "application/pdf");
    const head = await headObject(source);

    const copy = await copyObject(source, destination);

    expect(copy.etag).toBe(head!.etag);
    expect(await headObject(destination)).toMatchObject({
      sizeBytes: PDF.length,
      contentType: "application/pdf",
      etag: head!.etag,
    });
    expect(await sha256(destination)).toBe(createHash("sha256").update(PDF).digest("hex"));
    expect(await headObject(source)).not.toBeNull();
  });

  it("copies when the source still has the ETag that was examined", async () => {
    const source = scratch("copy-if-match.pdf");
    const destination = scratch("copy-if-match-destination.pdf");
    await putObject(source, PDF, "application/pdf");
    const { etag } = (await headObject(source))!;
    await copyObject(source, destination, { ifMatch: etag });
    expect(await headObject(destination)).not.toBeNull();
  });

  it("refuses with ObjectChangedError, and copies nothing, when the source was replaced since", async () => {
    const source = scratch("copy-replaced.pdf");
    const destination = scratch("copy-replaced-destination.pdf");
    await putObject(source, PDF, "application/pdf");
    const { etag } = (await headObject(source))!;
    await putObject(
      source,
      Buffer.concat([PDF.subarray(0, PDF.length - 1), Buffer.from("!")]),
      "application/pdf",
    );

    await expect(copyObject(source, destination, { ifMatch: etag })).rejects.toBeInstanceOf(
      ObjectChangedError,
    );
    expect(await headObject(destination)).toBeNull();
  });

  it("throws ObjectNotFoundError when the source does not exist", async () => {
    await expect(
      copyObject(scratch("copy-missing.pdf"), scratch("copy-missing-destination.pdf")),
    ).rejects.toBeInstanceOf(ObjectNotFoundError);
  });

  it("handles keys with spaces and punctuation", async () => {
    const source = scratch("a file (1)+x.pdf");
    const destination = scratch("copy of a file (1)+x.pdf");
    await putObject(source, PDF, "application/pdf");
    await copyObject(source, destination);
    expect((await headObject(destination))!.sizeBytes).toBe(PDF.length);
  });

  it("the copy is unaffected when the source is later overwritten through its presigned URL", async () => {
    const source = buildPendingKey(ASSESSMENT, STUDENT, "pdf");
    const destination = buildSubmissionKey(ASSESSMENT, STUDENT, "pdf");
    const upload = await presignPut(source, "application/pdf", PDF.length, 300);
    expect((await browserPut(upload, PDF)).status).toBe(200);

    await copyObject(source, destination);

    const other = Buffer.from(PDF);
    other[other.length - 1] = other[other.length - 1]! ^ 0xff;
    expect((await browserPut(upload, other)).status).toBe(200); // the URL still works on the pending key ...
    expect(await sha256(source)).toBe(createHash("sha256").update(other).digest("hex"));
    expect(await sha256(destination)).toBe(createHash("sha256").update(PDF).digest("hex")); // ... and only there
  });
});

describe("deletePrefix", () => {
  it("deletes only the prefix, across more than one page of results", async () => {
    const prefix = scratch("many/");
    const count = 1005; // S3 lists 1000 keys per page
    const keys = Array.from(
      { length: count },
      (_, i) => `${prefix}${String(i).padStart(4, "0")}.txt`,
    );
    for (let i = 0; i < keys.length; i += 50) {
      await Promise.all(
        keys.slice(i, i + 50).map((key) => putObject(key, Buffer.from("x"), "text/plain")),
      );
    }
    const keep = scratch("many-but-not-this.txt"); // starts with the same text but is not under the prefix
    await putObject(keep, Buffer.from("x"), "text/plain");

    expect(await deletePrefix(prefix)).toBe(count);

    expect(await headObject(keys[0]!)).toBeNull();
    expect(await headObject(keys[count - 1]!)).toBeNull();
    expect(await headObject(keep)).not.toBeNull();
    expect(await deletePrefix(prefix)).toBe(0);
  }, 120_000);
});
