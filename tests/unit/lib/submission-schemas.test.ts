import { describe, expect, it } from "vitest";
import {
  UPLOAD_MIME_TYPES,
  checkUploadFile,
  cleanFileName,
  confirmUploadSchema,
  extensionOf,
  fileNameProblem,
  formatLimit,
  uploadExtensionOf,
  uploadUrlSchema,
} from "@/lib/validation/submissions";

const MB = 1024 * 1024;

function problems(input: unknown): Record<string, string[]> {
  const result = uploadUrlSchema.safeParse(input);
  if (result.success) return {};
  const out: Record<string, string[]> = {};
  for (const issue of result.error.issues) (out[issue.path.join(".")] ??= []).push(issue.message);
  return out;
}

describe("file names", () => {
  it("reads the extension case-insensitively", () => {
    expect(extensionOf("Essay.PDF")).toBe("pdf");
    expect(extensionOf("a.b.docx")).toBe("docx");
    expect(extensionOf("noextension")).toBeNull();
    expect(extensionOf(".pdf")).toBeNull();
    expect(extensionOf("trailingdot.")).toBeNull();
    expect(uploadExtensionOf("x.DOCX")).toBe("docx");
    expect(uploadExtensionOf("x.doc")).toBeNull();
  });

  it("drops folders and normalises", () => {
    expect(cleanFileName("C:\\Users\\me\\essay.pdf")).toBe("essay.pdf");
    expect(cleanFileName("../../etc/passwd.pdf")).toBe("passwd.pdf");
    expect(cleanFileName("  report.pdf  ")).toBe("report.pdf");
    expect(cleanFileName("e\u0301ssay.pdf")).toBe("\u00e9ssay.pdf");
  });

  it("accepts pdf and docx, and explains everything else", () => {
    expect(fileNameProblem("essay.pdf")).toBeNull();
    expect(fileNameProblem("প্রতিবেদন.docx")).toBeNull();
    expect(fileNameProblem("")).toMatch(/Choose a file/);
    expect(fileNameProblem("essay.docm")).toMatch(/Macro-enabled/);
    expect(fileNameProblem("template.DOTM")).toMatch(/Macro-enabled/);
    expect(fileNameProblem("essay.doc")).toMatch(/Only PDF/);
    expect(fileNameProblem("essay.exe")).toMatch(/Only PDF/);
    expect(fileNameProblem("essay")).toMatch(/Only PDF/);
    expect(fileNameProblem("bad\u0000name.pdf")).toMatch(/not allowed/);
    expect(fileNameProblem(`${"a".repeat(252)}.pdf`)).toMatch(/Shorten/);
    expect(fileNameProblem(`${"a".repeat(251)}.pdf`)).toBeNull();
  });
});

describe("checkUploadFile (browser pre-check)", () => {
  const limit = 20 * MB;

  it("passes a normal file, including one exactly at the limit", () => {
    expect(checkUploadFile({ name: "essay.pdf", size: 1000 }, limit)).toBeNull();
    expect(checkUploadFile({ name: "essay.pdf", size: limit }, limit)).toBeNull();
  });

  it("reports the first problem in plain words", () => {
    expect(checkUploadFile({ name: "essay.docm", size: 10 }, limit)).toMatch(/Macro-enabled/);
    expect(checkUploadFile({ name: "essay.pdf", size: 0 }, limit)).toMatch(/empty/);
    expect(checkUploadFile({ name: "essay.pdf", size: limit + 1 }, limit)).toBe(
      "This file is too large. The limit is 20 MB.",
    );
  });

  it("formats the limit", () => {
    expect(formatLimit(20 * MB)).toBe("20 MB");
  });
});

describe("uploadUrlSchema", () => {
  const valid = { fileName: "essay.pdf", contentType: UPLOAD_MIME_TYPES.pdf, sizeBytes: 1234 };

  it("accepts a PDF and a DOCX with the matching type", () => {
    expect(uploadUrlSchema.parse(valid)).toEqual(valid);
    expect(
      uploadUrlSchema.parse({
        fileName: "Essay.DOCX",
        contentType: UPLOAD_MIME_TYPES.docx,
        sizeBytes: 9,
      }).fileName,
    ).toBe("Essay.DOCX");
  });

  it("trims and strips folders from the file name", () => {
    expect(uploadUrlSchema.parse({ ...valid, fileName: " C:\\x\\essay.pdf " }).fileName).toBe(
      "essay.pdf",
    );
  });

  it("rejects other extensions, with .docm called out", () => {
    expect(problems({ ...valid, fileName: "essay.docm" }).fileName?.[0]).toMatch(/Macro-enabled/);
    expect(problems({ ...valid, fileName: "essay.txt" }).fileName?.[0]).toMatch(/Only PDF/);
  });

  it("requires the declared type to match the extension", () => {
    expect(problems({ ...valid, contentType: UPLOAD_MIME_TYPES.docx }).contentType?.[0]).toMatch(
      /\.pdf file must be sent as application\/pdf/,
    );
    expect(problems({ ...valid, contentType: "text/plain" }).contentType).toBeDefined();
    expect(problems({ ...valid, contentType: "APPLICATION/PDF " })).toEqual({});
  });

  it("requires a positive whole number of bytes", () => {
    expect(problems({ ...valid, sizeBytes: 0 }).sizeBytes?.[0]).toMatch(/empty/);
    expect(problems({ ...valid, sizeBytes: -5 }).sizeBytes).toBeDefined();
    expect(problems({ ...valid, sizeBytes: 1.5 }).sizeBytes).toBeDefined();
    expect(problems({ ...valid, sizeBytes: "12" }).sizeBytes).toBeDefined();
  });

  it("reports missing fields", () => {
    expect(Object.keys(problems({})).sort()).toEqual(["contentType", "fileName", "sizeBytes"]);
  });
});

describe("confirmUploadSchema", () => {
  it("needs a UUID", () => {
    expect(
      confirmUploadSchema.safeParse({ pendingUploadId: "11111111-1111-4111-8111-111111111111" })
        .success,
    ).toBe(true);
    expect(confirmUploadSchema.safeParse({ pendingUploadId: "nope" }).success).toBe(false);
    expect(confirmUploadSchema.safeParse({}).success).toBe(false);
  });
});
