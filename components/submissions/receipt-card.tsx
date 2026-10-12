import { CheckCircle2Icon } from "lucide-react";
import type { ReactNode } from "react";
import { DateTime } from "@/components/format/date-time";
import { formatFileSize } from "@/components/format/file-size";
import { StatusBadge } from "@/components/shared/status-badge";
import { APP_TIME_ZONE } from "@/lib/services/rules/time";
import { cn } from "@/lib/utils";

// A submission receipt (edge-cases.md, the "S" item): what was handed in and when, with the SHA-256 fingerprint that
// settles "I submitted on time" disputes. The same card shows the receipt right after an upload and each version in the
// history, so the facts always read the same.

export interface ReceiptFacts {
  fileName: string;
  sizeBytes: number;
  sha256: string;
  /** When the file arrived in storage (ISO): the submission time. */
  uploadedAt: string;
  late: boolean;
  lateBy: string | null;
}

export interface ReceiptCardProps {
  receipt: ReceiptFacts;
  /** Heading above the facts. */
  title?: ReactNode;
  /** "Version 2" and the like, shown beside the title. */
  label?: ReactNode;
  /** A button (such as Download) at the end of the header. */
  action?: ReactNode;
  /** Shows a success tick beside the title, for the receipt that follows an upload. */
  celebrate?: boolean;
  className?: string;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm break-words">{children}</dd>
    </div>
  );
}

export function ReceiptCard({
  receipt,
  title = "Submission receipt",
  label,
  action,
  celebrate = false,
  className,
}: ReceiptCardProps) {
  return (
    <section
      data-slot="receipt"
      aria-label={typeof title === "string" ? title : "Submission receipt"}
      className={cn("space-y-3 rounded-xl border bg-card p-4 text-card-foreground", className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {celebrate ? (
            <CheckCircle2Icon className="size-4 text-tone-green-foreground" aria-hidden="true" />
          ) : null}
          <h3 className="text-sm font-medium">{title}</h3>
          {label ? <span className="text-xs text-muted-foreground">{label}</span> : null}
          <StatusBadge
            group="submission"
            value={receipt.late ? "LATE" : "ON_TIME"}
            detail={receipt.late ? receipt.lateBy : null}
          />
        </div>
        {action}
      </div>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <Fact label="File">{receipt.fileName}</Fact>
        <Fact label="Size">{formatFileSize(receipt.sizeBytes)}</Fact>
        <Fact label={`Received (${APP_TIME_ZONE})`}>
          <DateTime value={receipt.uploadedAt} />
        </Fact>
        <div className="min-w-0 sm:col-span-2">
          <dt className="text-xs text-muted-foreground">SHA-256 fingerprint</dt>
          <dd className="mt-0.5 font-mono text-xs break-all" data-slot="sha256">
            {receipt.sha256}
          </dd>
        </div>
      </dl>
    </section>
  );
}
