import { crc32 } from "node:zlib";

// A tiny ZIP writer for tests (stored entries, no compression): enough to build DOCX-shaped archives, including a
// "macro-enabled" one that carries word/vbaProject.bin, without a dependency.

export interface ZipEntry {
  name: string;
  data?: Buffer | string;
}

export function buildZip(entries: ZipEntry[], options: { comment?: string } = {}): Buffer {
  const parts: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.data ?? "");
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const directoryBytes = Buffer.concat(directory);
  const comment = Buffer.from(options.comment ?? "", "utf8");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(comment.length, 20);

  return Buffer.concat([...parts, directoryBytes, end, comment]);
}

/** A minimal but structurally valid DOCX: [Content_Types].xml and word/document.xml. */
export function buildDocx(extra: ZipEntry[] = []): Buffer {
  return buildZip([
    { name: "[Content_Types].xml", data: "<Types/>" },
    { name: "word/document.xml", data: "<w:document/>" },
    ...extra,
  ]);
}

/** The same archive with a macro project, as Word writes for a macro-enabled document (even if renamed .docx). */
export function buildMacroDocx(): Buffer {
  return buildDocx([{ name: "word/vbaProject.bin", data: Buffer.from([0xd0, 0xcf, 0x11, 0xe0]) }]);
}

/** A reader over an in-memory buffer, shaped like `RangeReader`. */
export function readerOf(buffer: Buffer) {
  return async (offset: number, length: number) => buffer.subarray(offset, offset + length);
}
