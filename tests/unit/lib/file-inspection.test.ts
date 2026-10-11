import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  inspectDocx,
  inspectPdf,
  inspectUpload,
  listZipEntries,
} from "@/lib/services/file-inspection";
import { buildDocx, buildMacroDocx, buildZip, readerOf } from "../../support/zip";

const FIXTURES = path.resolve(import.meta.dirname, "../../../db/seed/fixtures");
const SAMPLE_PDF = readFileSync(path.join(FIXTURES, "sample.pdf"));
const SAMPLE_DOCX = readFileSync(path.join(FIXTURES, "sample.docx"));

async function docx(buffer: Buffer) {
  return inspectDocx(buffer.subarray(0, 8), buffer.length, readerOf(buffer));
}

describe("inspectPdf", () => {
  it("accepts a file that starts with %PDF-", () => {
    expect(inspectPdf(SAMPLE_PDF.subarray(0, 8))).toEqual({ ok: true });
  });

  it.each([
    ["plain text", Buffer.from("hello world, definitely not a pdf")],
    ["a ZIP", buildDocx()],
    ["too short", Buffer.from("%PDF")],
    ["empty", Buffer.alloc(0)],
    ["the signature in lower case", Buffer.from("%pdf-1.7")],
  ])("rejects %s", (_name, bytes) => {
    const result = inspectPdf(bytes.subarray(0, 8));
    expect(result.ok).toBe(false);
  });
});

describe("listZipEntries", () => {
  it("lists the names in a real DOCX", async () => {
    const names = await listZipEntries(SAMPLE_DOCX.length, readerOf(SAMPLE_DOCX));
    expect(names).toContain("word/document.xml");
    expect(names).toContain("[Content_Types].xml");
  });

  it("finds the end record behind a trailing comment", async () => {
    const zip = buildZip([{ name: "a.txt", data: "x" }], {
      comment: "PK\x05\x06 looks like a signature",
    });
    expect(await listZipEntries(zip.length, readerOf(zip))).toEqual(["a.txt"]);
  });

  it("reads UTF-8 names", async () => {
    const zip = buildZip([{ name: "word/প্রতিবেদন.xml" }]);
    expect(await listZipEntries(zip.length, readerOf(zip))).toEqual(["word/প্রতিবেদন.xml"]);
  });

  it("reads only the tail and the directory, not the whole file", async () => {
    const big = buildZip([{ name: "word/document.xml", data: Buffer.alloc(3 * 1024 * 1024, 7) }]);
    const lengths: number[] = [];
    const read = readerOf(big);
    await listZipEntries(big.length, async (offset, length) => {
      lengths.push(length);
      return read(offset, length);
    });
    expect(lengths.reduce((a, b) => a + b, 0)).toBeLessThan(70_000); // the 64 KiB tail window plus the tiny directory, of a 3 MiB file;
  });

  it.each([
    ["a file smaller than an end record", Buffer.from("PK")],
    ["random bytes", Buffer.alloc(400, 0xab)],
    ["an empty archive", buildZip([])],
  ])("throws for %s", async (_name, bytes) => {
    await expect(listZipEntries(bytes.length, readerOf(bytes))).rejects.toThrow();
  });

  it("throws when the directory offset points outside the file", async () => {
    const zip = buildZip([{ name: "a.txt", data: "x" }]);
    zip.writeUInt32LE(zip.length + 100, zip.length - 22 + 16);
    await expect(listZipEntries(zip.length, readerOf(zip))).rejects.toThrow();
  });

  it("throws for a directory larger than the cap", async () => {
    const zip = buildZip([{ name: "a.txt", data: "x" }]);
    zip.writeUInt32LE(3 * 1024 * 1024, zip.length - 22 + 12);
    await expect(listZipEntries(zip.length, readerOf(zip))).rejects.toThrow(/too large/);
  });

  it("throws for ZIP64 markers", async () => {
    const zip = buildZip([{ name: "a.txt", data: "x" }]);
    zip.writeUInt16LE(0xffff, zip.length - 22 + 10);
    await expect(listZipEntries(zip.length, readerOf(zip))).rejects.toThrow(/ZIP64/);
  });

  it("throws for a corrupted directory entry", async () => {
    const zip = buildZip([{ name: "a.txt", data: "x" }]);
    const directoryOffset = zip.readUInt32LE(zip.length - 22 + 16);
    zip.writeUInt32LE(0, directoryOffset); // wreck the entry signature
    await expect(listZipEntries(zip.length, readerOf(zip))).rejects.toThrow(/bad directory entry/);
  });

  it("throws for an entry whose name runs past the directory", async () => {
    const zip = buildZip([{ name: "a.txt", data: "x" }]);
    const directoryOffset = zip.readUInt32LE(zip.length - 22 + 16);
    zip.writeUInt16LE(5000, directoryOffset + 28);
    await expect(listZipEntries(zip.length, readerOf(zip))).rejects.toThrow(/truncated/);
  });
});

describe("inspectDocx", () => {
  it("accepts the sample DOCX and a structurally valid one", async () => {
    expect(await docx(SAMPLE_DOCX)).toEqual({ ok: true });
    expect(await docx(buildDocx())).toEqual({ ok: true });
  });

  it("rejects a macro-enabled document even with a .docx name", async () => {
    const result = await docx(buildMacroDocx());
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/macros/);
  });

  it("rejects a macro project in any folder, whatever its case", async () => {
    expect((await docx(buildDocx([{ name: "xl/VBAProject.BIN" }]))).ok).toBe(false);
  });

  it("rejects a ZIP that is not a Word document", async () => {
    expect((await docx(buildZip([{ name: "photo.jpg", data: "x" }]))).ok).toBe(false);
  });

  it("rejects a PDF, text and an empty buffer pretending to be a DOCX", async () => {
    expect((await docx(SAMPLE_PDF)).ok).toBe(false);
    expect((await docx(Buffer.from("just some text, not an archive at all"))).ok).toBe(false);
    expect((await docx(Buffer.alloc(0))).ok).toBe(false);
  });

  it("rejects an archive with the right start but a broken end", async () => {
    const zip = buildDocx();
    expect((await docx(zip.subarray(0, zip.length - 30))).ok).toBe(false);
  });
});

describe("inspectUpload", () => {
  it("dispatches on the kind", async () => {
    expect(await inspectUpload("pdf", SAMPLE_PDF.length, readerOf(SAMPLE_PDF))).toEqual({
      ok: true,
    });
    expect(await inspectUpload("docx", SAMPLE_DOCX.length, readerOf(SAMPLE_DOCX))).toEqual({
      ok: true,
    });
    expect((await inspectUpload("pdf", SAMPLE_DOCX.length, readerOf(SAMPLE_DOCX))).ok).toBe(false);
    expect((await inspectUpload("docx", SAMPLE_PDF.length, readerOf(SAMPLE_PDF))).ok).toBe(false);
  });
});
