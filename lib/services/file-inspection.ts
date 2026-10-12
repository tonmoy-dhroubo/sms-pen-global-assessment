// Looking inside an uploaded file (D-013, api.md "Submissions and files"). A name or a declared type proves nothing, so
// confirm reads the stored object itself:
//   - a PDF must start with `%PDF-`;
//   - a DOCX is a ZIP archive whose central directory lists `word/document.xml` and no `vbaProject.bin` (that file is
//     what makes an Office document macro-enabled, whatever the extension says).
// Nothing is downloaded whole: the ZIP's end-of-central-directory record is found in the last 64 KiB, and then only the
// central directory (a list of names, capped at 2 MiB) is read, both with ranged reads. Pure apart from the reader
// callback, so it is unit-tested with in-memory buffers and used with ranged GETs in production.

/** Reads `length` bytes from `offset` (fewer if the file ends first). */
export type RangeReader = (offset: number, length: number) => Promise<Buffer>;

export type InspectionResult = { ok: true } | { ok: false; message: string };

const PDF_SIGNATURE = "%PDF-";
const ZIP_LOCAL_HEADER = 0x04034b50;
const ZIP_CENTRAL_HEADER = 0x02014b50;
const ZIP_END_RECORD = 0x06054b50;

const END_RECORD_SIZE = 22;
/** The end record is followed by a comment of at most 65,535 bytes. */
const MAX_COMMENT = 0xffff;
const CENTRAL_HEADER_SIZE = 46;
/** A central directory bigger than this is not a Word document (a real one is a few KiB). */
const MAX_CENTRAL_DIRECTORY_BYTES = 2 * 1024 * 1024;
const MAX_ENTRIES = 20_000;

const NOT_A_PDF = "This file is not a valid PDF. Check that you chose the right file.";
const NOT_A_DOCX =
  "This file is not a valid Word (.docx) document. Check that you chose the right file.";
const HAS_MACROS =
  "This Word document contains macros, which are not accepted. Save it as a plain .docx without macros and upload that.";

export function inspectPdf(header: Buffer): InspectionResult {
  return header.subarray(0, PDF_SIGNATURE.length).toString("latin1") === PDF_SIGNATURE
    ? { ok: true }
    : { ok: false, message: NOT_A_PDF };
}

/** A ZIP that cannot be read as a plain, well-formed archive. */
class ZipError extends Error {}

/** Index of the end-of-central-directory record in `tail`, or -1. Searches backwards, past any trailing comment. */
function findEndRecord(tail: Buffer): number {
  for (let at = tail.length - END_RECORD_SIZE; at >= 0; at -= 1) {
    if (tail.readUInt32LE(at) !== ZIP_END_RECORD) continue;
    const commentLength = tail.readUInt16LE(at + 20);
    // The comment must run exactly to the end of the file, or this is just four bytes that look like the signature.
    if (at + END_RECORD_SIZE + commentLength === tail.length) return at;
  }
  return -1;
}

/**
 * The entry names in a ZIP's central directory, read with ranged reads. Throws `ZipError` for anything that is not a
 * plain, well-formed archive within the size caps (ZIP64 is not supported: a Word document under the upload limit
 * never needs it).
 */
export async function listZipEntries(size: number, read: RangeReader): Promise<string[]> {
  if (size < END_RECORD_SIZE) throw new ZipError("too small to be a ZIP archive");

  const tailLength = Math.min(size, END_RECORD_SIZE + MAX_COMMENT);
  const tail = await read(size - tailLength, tailLength);
  if (tail.length !== tailLength) throw new ZipError("could not read the end of the file");

  const end = findEndRecord(tail);
  if (end < 0) throw new ZipError("no end-of-central-directory record");

  const entries = tail.readUInt16LE(end + 10);
  const directorySize = tail.readUInt32LE(end + 12);
  const directoryOffset = tail.readUInt32LE(end + 16);
  if (entries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw new ZipError("ZIP64 archives are not supported");
  }
  if (entries === 0) throw new ZipError("the archive is empty");
  if (entries > MAX_ENTRIES || directorySize > MAX_CENTRAL_DIRECTORY_BYTES) {
    throw new ZipError("the archive's directory is too large");
  }
  if (directoryOffset + directorySize > size - tailLength + end) {
    throw new ZipError("the central directory lies outside the file");
  }

  const directory = await read(directoryOffset, directorySize);
  if (directory.length !== directorySize) throw new ZipError("could not read the directory");

  const names: string[] = [];
  let at = 0;
  for (let index = 0; index < entries; index += 1) {
    if (at + CENTRAL_HEADER_SIZE > directory.length) throw new ZipError("truncated directory");
    if (directory.readUInt32LE(at) !== ZIP_CENTRAL_HEADER)
      throw new ZipError("bad directory entry");
    const flags = directory.readUInt16LE(at + 8);
    const nameLength = directory.readUInt16LE(at + 28);
    const extraLength = directory.readUInt16LE(at + 30);
    const commentLength = directory.readUInt16LE(at + 32);
    const nameStart = at + CENTRAL_HEADER_SIZE;
    const next = nameStart + nameLength + extraLength + commentLength;
    if (next > directory.length) throw new ZipError("truncated directory entry");
    // Bit 11 says the name is UTF-8; otherwise it is CP437, which is plain ASCII for every name that matters here.
    names.push(
      directory
        .subarray(nameStart, nameStart + nameLength)
        .toString(flags & 0x0800 ? "utf8" : "latin1"),
    );
    at = next;
  }
  return names;
}

/**
 * A DOCX: a ZIP that starts with a local file header, lists `word/document.xml` and carries no macro project.
 * `header` is the file's first bytes; `size` its length; `read` fetches ranges.
 */
export async function inspectDocx(
  header: Buffer,
  size: number,
  read: RangeReader,
): Promise<InspectionResult> {
  if (header.length < 4 || header.readUInt32LE(0) !== ZIP_LOCAL_HEADER) {
    return { ok: false, message: NOT_A_DOCX };
  }
  let names: string[];
  try {
    names = await listZipEntries(size, read);
  } catch (error) {
    if (error instanceof ZipError) return { ok: false, message: NOT_A_DOCX };
    throw error;
  }
  const lower = names.map((name) => name.toLowerCase());
  // `vbaProject.bin` is the macro container; refuse it wherever it sits in the archive.
  if (lower.some((name) => name === "vbaproject.bin" || name.endsWith("/vbaproject.bin"))) {
    return { ok: false, message: HAS_MACROS };
  }
  if (!lower.includes("word/document.xml")) return { ok: false, message: NOT_A_DOCX };
  return { ok: true };
}

/** Checks an uploaded object of the given kind by reading only what it needs. `size` must be greater than zero. */
export async function inspectUpload(
  kind: "pdf" | "docx",
  size: number,
  read: RangeReader,
): Promise<InspectionResult> {
  const header = await read(0, 8);
  return kind === "pdf" ? inspectPdf(header) : inspectDocx(header, size, read);
}
