import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SubmissionExtension } from "@/lib/storage-core";

// The committed sample files (db/seed/fixtures/, built by make-fixtures.ts) that every seeded submission uploads.

export interface Fixture {
  extension: SubmissionExtension;
  mimeType: string;
  body: Buffer;
  sha256: string;
}

const MIME_TYPES: Record<SubmissionExtension, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** Reads the fixtures from `db/seed/fixtures` (relative to the repo root, where the npm scripts run). */
export function loadFixtures(
  directory: string = path.resolve("db/seed/fixtures"),
): Record<SubmissionExtension, Fixture> {
  const load = (extension: SubmissionExtension): Fixture => {
    const body = readFileSync(path.join(directory, `sample.${extension}`));
    return {
      extension,
      mimeType: MIME_TYPES[extension],
      body,
      sha256: createHash("sha256").update(body).digest("hex"),
    };
  };
  return { pdf: load("pdf"), docx: load("docx") };
}
