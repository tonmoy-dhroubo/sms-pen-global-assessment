import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { GET, PUT } from "@/app/api/uploads/[token]/route";
import { deletePrefix, headObject, presignGet, presignPut, putObject } from "@/lib/storage";
import { buildPendingKey, buildSubmissionKey } from "@/lib/storage-core";
import { signToken } from "@/lib/storage-token";
import type { TokenClaims } from "@/lib/storage-token";
import { TEST_SESSION_SECRET } from "../../support/constants";
import { isFilesystemRun } from "../../support/test-storage";

// `/api/uploads/{token}`, the filesystem driver's stand-in for S3 presigned URLs (D-045): what a stolen, edited, expired
// or misused link can and cannot do. These only make sense with STORAGE_DRIVER=filesystem; under s3 the route must not
// exist at all.

const FILESYSTEM = isFilesystemRun();
const ASSESSMENT = randomUUID();
const STUDENT = randomUUID();
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(1024)]);

afterAll(async () => {
  await deletePrefix(`pending/${ASSESSMENT}/`);
  await deletePrefix(`submissions/${ASSESSMENT}/`);
  await deletePrefix("tests/uploads-route/");
});

const tokenOf = (url: string) => url.slice(url.lastIndexOf("/") + 1);
const params = (token: string) => ({ params: Promise.resolve({ token }) });

function put(token: string, bytes: Buffer, headers: Record<string, string> = {}) {
  return PUT(
    new Request(`http://localhost:3000/api/uploads/${token}`, {
      method: "PUT",
      headers: {
        "content-type": "application/pdf",
        "content-length": String(bytes.length),
        ...headers,
      },
      body: new Uint8Array(bytes),
    }),
    params(token),
  );
}

const get = (token: string) =>
  GET(new Request(`http://localhost:3000/api/uploads/${token}`), params(token));

/** A token signed with the test secret for arbitrary claims, as only the server could. */
const signed = (claims: TokenClaims) => signToken(claims, TEST_SESSION_SECRET);
const IN_A_MINUTE = () => Date.now() + 60_000;

describe.runIf(!FILESYSTEM)("under STORAGE_DRIVER=s3", () => {
  it("does not serve the route at all", async () => {
    const token = signed({
      typ: "put",
      key: buildPendingKey(ASSESSMENT, STUDENT, "pdf"),
      ct: "application/pdf",
      len: PDF.length,
      exp: IN_A_MINUTE(),
    });
    expect((await put(token, PDF)).status).toBe(404);
    expect((await get(token)).status).toBe(404);
  });
});

describe.runIf(FILESYSTEM)("PUT /api/uploads/{token}", () => {
  it("stores the file at the one pending key, with the declared type, and answers 200", async () => {
    const key = buildPendingKey(ASSESSMENT, STUDENT, "pdf");
    const upload = await presignPut(key, "application/pdf", PDF.length, 900);

    const response = await put(tokenOf(upload.url), PDF);

    expect(response.status).toBe(200);
    expect(await headObject(key)).toMatchObject({
      sizeBytes: PDF.length,
      contentType: "application/pdf",
    });
  });

  it("answers 404 and writes nothing for a token that was edited", async () => {
    const key = buildPendingKey(ASSESSMENT, STUDENT, "pdf");
    const token = tokenOf((await presignPut(key, "application/pdf", PDF.length, 900)).url);
    const tampered = `${token.slice(0, -2)}${token.endsWith("AA") ? "BB" : "AA"}`;

    const response = await put(tampered, PDF);

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
    expect(await headObject(key)).toBeNull();
  });

  it("answers 404 for a token for another key swapped into a valid signature's place", async () => {
    const key = buildPendingKey(ASSESSMENT, STUDENT, "pdf");
    const other = buildPendingKey(ASSESSMENT, STUDENT, "pdf");
    const [version, , signature] = tokenOf(
      (await presignPut(key, "application/pdf", PDF.length, 900)).url,
    ).split(".");
    const forged = Buffer.from(
      JSON.stringify({
        typ: "put",
        key: other,
        ct: "application/pdf",
        len: PDF.length,
        exp: IN_A_MINUTE(),
      }),
    ).toString("base64url");

    expect((await put(`${version}.${forged}.${signature}`, PDF)).status).toBe(404);
    expect(await headObject(other)).toBeNull();
  });

  it("answers 403 'expired' once the link has expired, and writes nothing", async () => {
    const key = buildPendingKey(ASSESSMENT, STUDENT, "pdf");
    const token = signed({
      typ: "put",
      key,
      ct: "application/pdf",
      len: PDF.length,
      exp: Date.now() - 1000,
    });
    const response = await put(token, PDF);
    expect(response.status).toBe(403);
    expect((await response.json()).error.message).toContain("expired");
    expect(await headObject(key)).toBeNull();
  });

  it("never writes a final key, even with a correctly signed token for one", async () => {
    const finalKey = buildSubmissionKey(ASSESSMENT, STUDENT, "pdf");
    const token = signed({
      typ: "put",
      key: finalKey,
      ct: "application/pdf",
      len: PDF.length,
      exp: IN_A_MINUTE(),
    });
    expect((await put(token, PDF)).status).toBe(404);
    expect(await headObject(finalKey)).toBeNull();
  });

  it("never follows a key out of the storage directory", async () => {
    for (const key of [
      "pending/../../escape.pdf",
      "pending/../submissions/x.pdf",
      "pending/a/..\\b",
    ]) {
      const token = signed({
        typ: "put",
        key,
        ct: "application/pdf",
        len: PDF.length,
        exp: IN_A_MINUTE(),
      });
      expect((await put(token, PDF)).status).toBe(404);
    }
  });

  it("answers 403 for a different content type", async () => {
    const key = buildPendingKey(ASSESSMENT, STUDENT, "pdf");
    const token = tokenOf((await presignPut(key, "application/pdf", PDF.length, 900)).url);
    expect((await put(token, PDF, { "content-type": "text/html" })).status).toBe(403);
    expect(await headObject(key)).toBeNull();
  });

  it("answers 403 for a Content-Length other than the signed one, or none", async () => {
    const key = buildPendingKey(ASSESSMENT, STUDENT, "pdf");
    const token = tokenOf((await presignPut(key, "application/pdf", PDF.length, 900)).url);
    expect((await put(token, PDF, { "content-length": String(PDF.length - 1) })).status).toBe(403);
    expect((await put(token, PDF, { "content-length": "abc" })).status).toBe(403);
    expect(await headObject(key)).toBeNull();
  });

  it("answers 403 and keeps nothing when the body is longer or shorter than it said", async () => {
    const key = buildPendingKey(ASSESSMENT, STUDENT, "pdf");
    const token = tokenOf((await presignPut(key, "application/pdf", PDF.length, 900)).url);
    // The headers claim the signed length; the body does not match it.
    const longer = Buffer.concat([PDF, Buffer.from("extra")]);
    const shorter = PDF.subarray(0, PDF.length - 10);
    expect((await put(token, longer, { "content-length": String(PDF.length) })).status).toBe(403);
    expect((await put(token, shorter, { "content-length": String(PDF.length) })).status).toBe(403);
    expect(await headObject(key)).toBeNull();
  });

  it("does not accept a download token, nor a malformed one", async () => {
    const key = buildPendingKey(ASSESSMENT, STUDENT, "pdf");
    const download = tokenOf((await presignGet(key, "x.pdf", 60)).url);
    expect((await put(download, PDF)).status).toBe(404);
    expect((await put("not-a-token", PDF)).status).toBe(404);
  });

  it("can be used again until it expires, but only ever on its own pending key", async () => {
    const key = buildPendingKey(ASSESSMENT, STUDENT, "pdf");
    const token = tokenOf((await presignPut(key, "application/pdf", PDF.length, 900)).url);
    expect((await put(token, PDF)).status).toBe(200);
    const other = Buffer.from(PDF);
    other[other.length - 1] = other[other.length - 1]! ^ 0xff;
    expect((await put(token, other)).status).toBe(200);
    expect((await headObject(key))!.sizeBytes).toBe(PDF.length);
  });
});

describe.runIf(FILESYSTEM)("GET /api/uploads/{token}", () => {
  it("streams the file with its type, size and download name", async () => {
    const key = "tests/uploads-route/report.pdf";
    await putObject(key, PDF, "application/pdf");
    const response = await get(tokenOf((await presignGet(key, "প্রতিবেদন.pdf", 300)).url));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-length")).toBe(String(PDF.length));
    expect(response.headers.get("content-disposition")).toContain("filename*=UTF-8''");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      createHash("sha256").update(PDF).digest("hex"),
    );
  });

  it("answers 404 for an object that is gone, an edited token, an expired one, or an upload token", async () => {
    const key = "tests/uploads-route/gone.pdf";
    expect((await get(tokenOf((await presignGet(key, "x.pdf", 300)).url))).status).toBe(404);

    await putObject(key, PDF, "application/pdf");
    const token = tokenOf((await presignGet(key, "x.pdf", 300)).url);
    expect((await get(`${token}x`)).status).toBe(404);

    const expired = signed({ typ: "get", key, name: "x.pdf", exp: Date.now() - 1 });
    expect((await get(expired)).status).toBe(403);

    const upload = tokenOf(
      (await presignPut(buildPendingKey(ASSESSMENT, STUDENT, "pdf"), "application/pdf", 1, 60)).url,
    );
    expect((await get(upload)).status).toBe(404);
  });
});
