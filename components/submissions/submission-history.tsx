import { DownloadButton } from "@/components/assessments/download-button";
import { ReceiptCard } from "@/components/submissions/receipt-card";
import type { MyFileVersion } from "@/lib/services/submissions";

// Every version the student has uploaded, newest first, each with its receipt and a Download button (pages.md
// `/student/assessments/[id]`). Nothing is ever overwritten (DB-005), so the earlier receipts stay as proof.

export function SubmissionHistory({ versions }: { versions: readonly MyFileVersion[] }) {
  return (
    <ol className="space-y-3" aria-label="Your uploaded versions">
      {versions.map((file, index) => (
        <li key={file.id}>
          <ReceiptCard
            receipt={file}
            title={`Version ${file.version}`}
            label={index === 0 ? "Current" : undefined}
            action={<DownloadButton fileId={file.id} fileName={file.fileName} />}
          />
        </li>
      ))}
    </ol>
  );
}
