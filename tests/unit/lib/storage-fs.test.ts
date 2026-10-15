import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ObjectChangedError, ObjectNotFoundError } from "@/lib/storage-core";
import { UploadRejectedError, createFilesystemStorage, isSafeKey } from "@/lib/storage-fs";
import type { FilesystemStorage } from "@/lib/storage-fs";
import { verifyToken } from "@/lib/storage-token";

// The filesystem adapter on a scratch directory (D-045). The behaviour shared with the S3 adapter (round trips, ranges,
// hashing, copies, prefixes) is checked against both in tests/integration/storage; this file covers what is specific to
// files on disk: path safety, the pending-only upload URLs, length enforcement and leftovers.

const SECRET = "unit-test-secret-that-is-at-least-32-characters";
const PENDING = `pending/${randomUUID()}/${randomUUID()}/${randomUUID()}.pdf`;
const FINAL = `submissions/${randomUUID()}/${randomUUID()}/${randomUUID()}.pdf`;
const BYTES = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(500)]);

let dir: string;
let storage: FilesystemStorage;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "sms-fs-test-"));
  storage = createFilesystemStorage({ rootDir: path.join(dir, "store"), secret: SECRET });
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/** A web stream of `bytes` in chunks, the way a request body arrives. */
function body(bytes: Buffer, chunk = 100): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(new Uint8Array(bytes.subarray(offset, offset + chunk)));
      offset += chunk;
    },
  });
}

/** Every file under the storage root, as relative paths. */
async function listing(): Promise<string[]> {
  const root = path.join(dir, "store");
  const entries = await fs.readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => path.relative(root, path.join(e.parentPath, e.name)).split(path.sep).join("/"))
    .sort();
}

describe("keys", () => {
  it.each([
    "../escape.pdf",
    "pending/../../escape.pdf",
    "/absolute.pdf",
    "pending//double.pdf",
    "pending/.hidden.pdf",
    ".meta/x.json",
    "pending\\backslash.pdf",
    "C:/windows/x.pdf",
    "pending/a:b.pdf",
    "pending/nul\u0000.pdf",
    "",
    "pending/",
  ])("refuses %j everywhere", async (key) => {
    expect(isSafeKey(key)).toBe(false);
    await expect(storage.putObject(key, BYTES, "application/pdf")).rejects.toBeInstanceOf(
      TypeError,
    );
    await expect(storage.headObject(key)).rejects.toBeInstanceOf(TypeError);
    await expect(storage.readRange(key, 0, 1)).rejects.toBeInstanceOf(TypeError);
    await expect(storage.deleteObject(key)).rejects.toBeInstanceOf(TypeError);
    await expect(storage.presignGet(key, "x.pdf", 60)).rejects.toBeInstanceOf(TypeError);
  });

  it("accepts the names the server generates, and ordinary punctuation", () => {
    expect(isSafeKey(PENDING)).toBe(true);
    expect(isSafeKey("tests/a file (1)+x.pdf")).toBe(true);
  });

  it("refuses to delete outside the root through a prefix", async () => {
    await storage.ensureBucket();
    await expect(storage.deletePrefix("../")).rejects.toBeInstanceOf(TypeError);
    await expect(storage.deletePrefix("a/../..")).rejects.toBeInstanceOf(TypeError);
  });
});

describe("the storage directory", () => {
  it("is created on first use and marked as ours", async () => {
    await storage.putObject("tests/a.txt", Buffer.from("x"), "text/plain");
    expect(await fs.readdir(path.join(dir, "store"))).toContain(".sms-storage");
  });

  it("refuses a directory that already has other files, and so never deletes them", async () => {
    const foreign = path.join(dir, "documents");
    await fs.mkdir(foreign);
    await fs.writeFile(path.join(foreign, "thesis.docx"), "precious");
    const unsafe = createFilesystemStorage({ rootDir: foreign, secret: SECRET });

    await expect(unsafe.ensureBucket()).rejects.toThrow(/not empty/);
    await expect(unsafe.deletePrefix("")).rejects.toThrow(/not empty/);
    await expect(unsafe.putObject("tests/a.txt", BYTES, "text/plain")).rejects.toThrow();
    expect(await fs.readFile(path.join(foreign, "thesis.docx"), "utf8")).toBe("precious");
  });

  it("deletePrefix('') removes every object, keeps the directory, and prunes empty folders", async () => {
    await storage.putObject("a/b/c.txt", Buffer.from("x"), "text/plain");
    await storage.putObject("d.txt", Buffer.from("x"), "text/plain");
    expect(await storage.deletePrefix("")).toBe(2);
    expect(await listing()).toEqual([".sms-storage"]);
    expect(await fs.readdir(path.join(dir, "store"))).toEqual([".sms-storage"]);
  });

  it("reports ok from checkBucket and leaves no probe behind", async () => {
    await storage.checkBucket(1000);
    expect(await listing()).toEqual([".sms-storage"]);
  });

  it("deletePrefix on a directory that was never created deletes nothing", async () => {
    expect(await storage.deletePrefix("pending/")).toBe(0);
  });
});

describe("upload URLs", () => {
  it("are only issued for pending keys", async () => {
    await expect(storage.presignPut(FINAL, "application/pdf", 1, 60)).rejects.toBeInstanceOf(
      TypeError,
    );
    await expect(
      storage.presignPut("tests/x.pdf", "application/pdf", 1, 60),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it("carry a token that names the key, the type, the length and the expiry", async () => {
    const before = Date.now();
    const upload = await storage.presignPut(PENDING, "application/pdf", BYTES.length, 900);
    expect(upload.url).toMatch(/^\/api\/uploads\/v1\.[\w-]+\.[\w-]+$/);
    expect(upload.headers).toEqual({ "Content-Type": "application/pdf" });
    const checked = verifyToken(upload.url.replace("/api/uploads/", ""), SECRET);
    expect(checked).toMatchObject({
      ok: true,
      claims: { typ: "put", key: PENDING, ct: "application/pdf", len: BYTES.length },
    });
    const exp = (checked as { claims: { exp: number } }).claims.exp;
    expect(exp).toBeGreaterThanOrEqual(before + 900_000);
    expect(exp).toBeLessThan(Date.now() + 901_000);
  });

  it("reject a bad expiry or size", async () => {
    await expect(storage.presignPut(PENDING, "application/pdf", 1, 0)).rejects.toBeInstanceOf(
      RangeError,
    );
    await expect(storage.presignPut(PENDING, "application/pdf", -1, 60)).rejects.toBeInstanceOf(
      RangeError,
    );
  });
});

describe("storeUpload", () => {
  it("streams the body into place with its type and leaves no temporary file", async () => {
    const stored = await storage.storeUpload(PENDING, "application/pdf", BYTES.length, body(BYTES));
    expect(stored).toMatchObject({ sizeBytes: BYTES.length, contentType: "application/pdf" });
    expect(await storage.readFirstBytes(PENDING, 5)).toEqual(Buffer.from("%PDF-"));
    expect((await listing()).filter((p) => p.includes(".tmp-"))).toEqual([]);
  });

  it("accepts an empty body when zero bytes were declared", async () => {
    await storage.storeUpload(PENDING, "application/pdf", 0, null);
    expect((await storage.headObject(PENDING))?.sizeBytes).toBe(0);
  });

  it("rejects a body longer than declared, stores nothing and leaves no temporary file", async () => {
    await expect(
      storage.storeUpload(PENDING, "application/pdf", BYTES.length - 1, body(BYTES)),
    ).rejects.toBeInstanceOf(UploadRejectedError);
    expect(await storage.headObject(PENDING)).toBeNull();
    expect(await listing()).toEqual([".sms-storage"]);
  });

  it("rejects a body shorter than declared, stores nothing and leaves no temporary file", async () => {
    await expect(
      storage.storeUpload(PENDING, "application/pdf", BYTES.length + 1, body(BYTES)),
    ).rejects.toBeInstanceOf(UploadRejectedError);
    expect(await storage.headObject(PENDING)).toBeNull();
    expect(await listing()).toEqual([".sms-storage"]);
  });

  it("keeps the previous object when a replacement upload fails", async () => {
    await storage.storeUpload(PENDING, "application/pdf", BYTES.length, body(BYTES));
    await expect(
      storage.storeUpload(PENDING, "application/pdf", 10, body(BYTES)),
    ).rejects.toBeInstanceOf(UploadRejectedError);
    expect((await storage.headObject(PENDING))?.sizeBytes).toBe(BYTES.length);
  });
});

describe("ETags and the conditional copy (D-043)", () => {
  it("change when the object is replaced, even by one of the same size", async () => {
    await storage.putObject(PENDING, BYTES, "application/pdf");
    const first = (await storage.headObject(PENDING))!.etag;
    await storage.putObject(PENDING, Buffer.from(BYTES), "application/pdf");
    expect((await storage.headObject(PENDING))!.etag).not.toBe(first);
  });

  it("let a copy through while the source is the examined version, and keep the type", async () => {
    await storage.putObject(PENDING, BYTES, "application/pdf");
    const { etag } = (await storage.headObject(PENDING))!;
    await storage.copyObject(PENDING, FINAL, { ifMatch: etag });
    expect(await storage.headObject(FINAL)).toMatchObject({
      sizeBytes: BYTES.length,
      contentType: "application/pdf",
    });
  });

  it("refuse once the source was replaced by a same-sized upload, and write nothing", async () => {
    await storage.putObject(PENDING, BYTES, "application/pdf");
    const { etag } = (await storage.headObject(PENDING))!;
    await storage.storeUpload(PENDING, "application/pdf", BYTES.length, body(Buffer.from(BYTES)));
    await expect(storage.copyObject(PENDING, FINAL, { ifMatch: etag })).rejects.toBeInstanceOf(
      ObjectChangedError,
    );
    expect(await storage.headObject(FINAL)).toBeNull();
    expect((await listing()).filter((p) => p.includes(".tmp-"))).toEqual([]);
  });

  it("report a missing source", async () => {
    await expect(storage.copyObject(PENDING, FINAL)).rejects.toBeInstanceOf(ObjectNotFoundError);
  });

  it("leave the final copy intact when the pending object is overwritten afterwards", async () => {
    await storage.putObject(PENDING, BYTES, "application/pdf");
    await storage.copyObject(PENDING, FINAL);
    await storage.storeUpload(PENDING, "application/pdf", 3, body(Buffer.from("abc")));
    expect(await storage.sha256(FINAL)).toBe(createHash("sha256").update(BYTES).digest("hex"));
    expect((await storage.headObject(PENDING))?.sizeBytes).toBe(3);
  });
});
