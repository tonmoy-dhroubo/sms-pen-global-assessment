import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildDocx, buildPdf } from "./fixture-builders";

// Writes db/seed/fixtures/sample.pdf and sample.docx (see fixture-builders.ts). Run from the repo root.
const dir = path.resolve("db/seed/fixtures");
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, "sample.pdf"), buildPdf());
writeFileSync(path.join(dir, "sample.docx"), buildDocx());
console.log(`Wrote sample.pdf and sample.docx to ${dir}`);
