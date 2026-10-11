import { crc32 } from "node:zlib";

// Builds the two sample submission files used by the seed (db/seed/fixtures/sample.pdf and sample.docx). The outputs
// are committed (so a clone needs no build step) and so is this generator, so they can be reproduced byte for byte:
// `npx tsx db/seed/make-fixtures.ts` writes them. A unit test rebuilds them in memory and fails if the committed
// files differ. Everything is deterministic (no timestamps, no random ids).
//
// No dependency is needed: the PDF is written by hand and the DOCX is a hand-built ZIP of "stored" entries.

const TITLE = "Sample submission";
const LINES = [
  "Seed fixture for the PEN Global Student Management System demo.",
  "This file is not a real student's work; it stands in for an uploaded submission.",
];

// --- PDF ------------------------------------------------------------------------------------------------------------

/** A one-page PDF 1.4 with a title and two lines of Helvetica text. The cross-reference table is computed. */
export function buildPdf(): Buffer {
  const escape = (text: string) => text.replace(/[\\()]/g, (char) => `\\${char}`);
  const content = [
    "BT",
    "/F1 20 Tf",
    "72 740 Td",
    `(${escape(TITLE)}) Tj`,
    "/F1 11 Tf",
    ...LINES.flatMap((line) => ["0 -28 Td", `(${escape(line)}) Tj`]),
    "ET",
  ].join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R " +
      "/Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefAt = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

// --- DOCX (a ZIP of OOXML parts) --------------------------------------------------------------------------------------

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

function paragraph(text: string, bold = false): string {
  const run = bold ? "<w:rPr><w:b/></w:rPr>" : "";
  return `<w:p><w:r>${run}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

const DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${[
  paragraph(TITLE, true),
  ...LINES.map((line) => paragraph(line)),
].join("")}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`;

// Fixed MS-DOS timestamp (1 Jan 2026, 00:00:00) so the archive is reproducible.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

interface ZipEntry {
  name: string;
  data: Buffer;
}

/** A ZIP archive of uncompressed ("stored") entries: all the OOXML container format needs. */
function buildZip(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    parts.push(local, nameBytes, data);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); // central directory header signature
    entry.writeUInt16LE(20, 4); // version made by
    entry.writeUInt16LE(20, 6); // version needed
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(0, 10);
    entry.writeUInt16LE(DOS_TIME, 12);
    entry.writeUInt16LE(DOS_DATE, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    // extra, comment, disk number, internal and external attributes: all zero
    entry.writeUInt32LE(offset, 42); // offset of the local header
    central.push(entry, nameBytes);

    offset += local.length + nameBytes.length + data.length;
  }

  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  end.writeUInt16LE(entries.length, 8); // entries on this disk
  end.writeUInt16LE(entries.length, 10); // entries in total
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBytes, end]);
}

/** A minimal Word document (no macros): `[Content_Types].xml`, the package relationships and `word/document.xml`. */
export function buildDocx(): Buffer {
  return buildZip([
    { name: "[Content_Types].xml", data: Buffer.from(CONTENT_TYPES, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(ROOT_RELS, "utf8") },
    { name: "word/document.xml", data: Buffer.from(DOCUMENT, "utf8") },
  ]);
}
