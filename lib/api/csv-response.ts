import "server-only";
import { contentDisposition } from "@/lib/storage-core";
import type { CsvExport } from "@/lib/services/exports";

/** A CSV download: UTF-8, saved under `filename` (RFC 6266), never cached (it is a per-user, live view). */
export function csvResponse({ filename, csv }: CsvExport): Response {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDisposition(filename),
      "Cache-Control": "no-store",
    },
  });
}
