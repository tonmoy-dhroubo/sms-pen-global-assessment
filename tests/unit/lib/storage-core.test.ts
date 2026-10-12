import { describe, expect, it } from "vitest";
import {
  PENDING_PREFIX,
  buildPendingKey,
  buildSubmissionKey,
  contentDisposition,
  createStorage,
  isPendingKey,
  submissionPrefix,
} from "@/lib/storage-core";

const ASSESSMENT = "3f2b8c1e-6a4d-4e0b-9d57-1c2a7e5f9b10";
const STUDENT = "9a1d7c52-0b3e-4f68-8e21-5d4c3b2a1f09";
const UUID_V4 = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

describe("buildSubmissionKey", () => {
  it("is submissions/<assessmentId>/<studentId>/<uuid>.<ext>", () => {
    const key = buildSubmissionKey(ASSESSMENT, STUDENT, "pdf");
    expect(key).toMatch(new RegExp(`^submissions/${ASSESSMENT}/${STUDENT}/${UUID_V4}\.pdf$`));
    expect(buildSubmissionKey(ASSESSMENT, STUDENT, "docx")).toMatch(/\.docx$/);
  });

  it("is different every time", () => {
    expect(buildSubmissionKey(ASSESSMENT, STUDENT, "pdf")).not.toBe(
      buildSubmissionKey(ASSESSMENT, STUDENT, "pdf"),
    );
  });

  it.each(["../x", "a/b", "", "not-a-uuid", `${ASSESSMENT}/..`])(
    "refuses %j as an id, so a key cannot be steered",
    (bad) => {
      expect(() => buildSubmissionKey(bad, STUDENT, "pdf")).toThrow(TypeError);
      expect(() => buildSubmissionKey(ASSESSMENT, bad, "pdf")).toThrow(TypeError);
    },
  );

  it("refuses an extension outside the allow-list (it never comes from the uploaded name)", () => {
    expect(() => buildSubmissionKey(ASSESSMENT, STUDENT, "exe" as "pdf")).toThrow(/Unsupported/);
    expect(() => buildSubmissionKey(ASSESSMENT, STUDENT, "pdf/../x" as "pdf")).toThrow(
      /Unsupported/,
    );
  });
});

describe("buildPendingKey", () => {
  it("is pending/<assessmentId>/<studentId>/<uuid>.<ext>, apart from every final key", () => {
    const key = buildPendingKey(ASSESSMENT, STUDENT, "docx");
    expect(key).toMatch(
      new RegExp("^pending/" + ASSESSMENT + "/" + STUDENT + "/" + UUID_V4 + "\.docx$"),
    );
    expect(isPendingKey(key)).toBe(true);
    expect(key.startsWith(PENDING_PREFIX)).toBe(true);
    // A pending key can never also be a final key, and the other way round.
    expect(key.startsWith(submissionPrefix(ASSESSMENT, STUDENT))).toBe(false);
    const final = buildSubmissionKey(ASSESSMENT, STUDENT, "docx");
    expect(isPendingKey(final)).toBe(false);
  });

  it("is different every time", () => {
    expect(buildPendingKey(ASSESSMENT, STUDENT, "pdf")).not.toBe(
      buildPendingKey(ASSESSMENT, STUDENT, "pdf"),
    );
  });

  it("applies the same checks as a final key", () => {
    expect(() => buildPendingKey("../x", STUDENT, "pdf")).toThrow(TypeError);
    expect(() => buildPendingKey(ASSESSMENT, "a/b", "pdf")).toThrow(TypeError);
    expect(() => buildPendingKey(ASSESSMENT, STUDENT, "exe" as "pdf")).toThrow(/Unsupported/);
  });
});

describe("isPendingKey", () => {
  it.each([
    ["pending/x/y.pdf", true],
    ["submissions/x/y.pdf", false],
    ["tests/pending/x.pdf", false],
    ["pending", false],
    ["", false],
  ])("%j -> %s", (key, expected) => {
    expect(isPendingKey(key)).toBe(expected);
  });
});

describe("submissionPrefix", () => {
  it("covers an assessment, or one student on it, and ends with a slash", () => {
    expect(submissionPrefix(ASSESSMENT)).toBe(`submissions/${ASSESSMENT}/`);
    expect(submissionPrefix(ASSESSMENT, STUDENT)).toBe(`submissions/${ASSESSMENT}/${STUDENT}/`);
    expect(
      buildSubmissionKey(ASSESSMENT, STUDENT, "pdf").startsWith(
        submissionPrefix(ASSESSMENT, STUDENT),
      ),
    ).toBe(true);
  });
});

describe("contentDisposition", () => {
  it("quotes a plain name and repeats it in filename*", () => {
    expect(contentDisposition("Report Final.pdf")).toBe(
      `attachment; filename="Report Final.pdf"; filename*=UTF-8''Report%20Final.pdf`,
    );
  });

  it("carries a Bengali name in filename* (RFC 5987) with an ASCII fallback that keeps the extension", () => {
    const header = contentDisposition("প্রতিবেদন.pdf");
    expect(header).toBe(
      `attachment; filename="download.pdf"; filename*=UTF-8''${encodeURIComponent("প্রতিবেদন.pdf")}`,
    );
    // Decoding filename* gives the exact original name back.
    const encoded = /filename\*=UTF-8''(\S+)$/.exec(header)![1]!;
    expect(decodeURIComponent(encoded)).toBe("প্রতিবেদন.pdf");
  });

  it("keeps the ASCII part of a mixed name in the fallback", () => {
    expect(contentDisposition("Essay – রচনা (v2).docx")).toContain(
      `filename="Essay _ _ (v2).docx"`,
    );
  });

  it("percent-encodes the characters encodeURIComponent leaves alone", () => {
    const header = contentDisposition("it's (final)*.pdf");
    expect(header).toContain("filename*=UTF-8''it%27s%20%28final%29%2A.pdf");
  });

  it("neutralises quotes, semicolons and percent signs in the quoted fallback (a backslash is a separator and goes)", () => {
    const header = contentDisposition('a"b\c;d%e.pdf');
    expect(header).toMatch(/^attachment; filename="a_bc_d_e\.pdf"; /);
  });

  it("strips control characters and path separators (no header injection, no directories)", () => {
    const header = contentDisposition("evil\r\nSet-Cookie: x=1/../..\secret.pdf");
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).not.toContain("/");
    expect(header).not.toContain("\\");
    expect(header.startsWith('attachment; filename="')).toBe(true);
  });

  it("falls back to 'download' for an empty or unusable name", () => {
    expect(contentDisposition("")).toContain(`filename="download"`);
    expect(contentDisposition("   ")).toContain(`filename="download"`);
    expect(contentDisposition("\r\n")).toContain(`filename="download"`);
  });

  it("truncates a very long name", () => {
    const header = contentDisposition(`${"a".repeat(500)}.pdf`);
    expect(header.length).toBeLessThan(600);
  });
});

describe("presigned URLs (offline)", () => {
  const storage = createStorage({
    endpoint: "http://minio.internal:9000",
    publicEndpoint: "https://files.example.com",
    region: "us-east-1",
    bucket: "submissions",
    accessKeyId: "AKID",
    secretAccessKey: "secret",
    forcePathStyle: true,
  });
  const key = buildSubmissionKey(ASSESSMENT, STUDENT, "pdf");

  it("signs for the public endpoint, bucket in the path", async () => {
    const { url } = await storage.presignPut(key, "application/pdf", 1234, 600);
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://files.example.com");
    expect(parsed.pathname).toBe(`/submissions/${key}`);
    expect(parsed.searchParams.get("X-Amz-Expires")).toBe("600");
  });

  it("signs Content-Type and Content-Length so they are enforced", async () => {
    const { url, headers } = await storage.presignPut(key, "application/pdf", 1234, 600);
    expect(new URL(url).searchParams.get("X-Amz-SignedHeaders")).toBe(
      "content-length;content-type;host",
    );
    expect(headers).toEqual({ "Content-Type": "application/pdf" });
  });

  it("adds no checksum parameters (the SDK default would embed the CRC32 of an empty body)", async () => {
    const { url } = await storage.presignPut(key, "application/pdf", 1234, 600);
    const names = [...new URL(url).searchParams.keys()].map((name) => name.toLowerCase());
    expect(names.filter((name) => name.includes("checksum"))).toEqual([]);
  });

  it("reports when the URL stops working", async () => {
    const before = Date.now();
    const { expiresAt } = await storage.presignPut(key, "application/pdf", 1, 300);
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 300_000);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 300_000);
  });

  it("presigns a GET with the download name in response-content-disposition", async () => {
    const { url } = await storage.presignGet(key, "প্রতিবেদন.pdf", 300);
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://files.example.com");
    expect(parsed.searchParams.get("response-content-disposition")).toBe(
      contentDisposition("প্রতিবেদন.pdf"),
    );
  });

  it("uses the server endpoint when there is no public one", async () => {
    const internal = createStorage({
      endpoint: "http://localhost:9000",
      region: "us-east-1",
      bucket: "b",
      accessKeyId: "a",
      secretAccessKey: "s",
      forcePathStyle: true,
    });
    const { url } = await internal.presignGet(key, "x.pdf", 60);
    expect(new URL(url).origin).toBe("http://localhost:9000");
  });

  it.each([0, -1, 1.5, 604_801, Number.NaN])("rejects an expiry of %s seconds", async (seconds) => {
    await expect(storage.presignPut(key, "application/pdf", 1, seconds)).rejects.toThrow(
      RangeError,
    );
    await expect(storage.presignGet(key, "a.pdf", seconds)).rejects.toThrow(RangeError);
  });

  it.each([-1, 1.5, Number.NaN])("rejects a size of %s bytes", async (size) => {
    await expect(storage.presignPut(key, "application/pdf", size, 60)).rejects.toThrow(RangeError);
  });
});
