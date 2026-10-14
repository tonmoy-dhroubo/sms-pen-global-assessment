import { UploadIcon } from "lucide-react";
import Link from "next/link";
import { Countdown } from "@/components/format/countdown";
import { DateTime } from "@/components/format/date-time";
import { formatFileSize } from "@/components/format/file-size";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { APP_TIME_ZONE } from "@/lib/services/rules/time";
import type { MyAssessment } from "@/lib/services/submissions";

// One assessment in the student's list (pages.md `/student/assessments`): the deadline in Asia/Dhaka with a countdown,
// the status badge, the current file with a receipt summary, and an Upload / Replace button that is disabled, with the
// reason in plain words beside it, when uploading is not allowed. The upload itself happens on the detail page.

export interface MyAssessmentCardProps {
  assessment: MyAssessment;
  /** The server's "now" (ISO), so the countdown is the same on the server and in the browser. */
  serverNow: string;
}

export function MyAssessmentCard({ assessment, serverNow }: MyAssessmentCardProps) {
  const { canUpload, submission } = assessment;
  const href = `/student/assessments/${assessment.id}`;
  const file = submission?.currentFile ?? null;
  const reasonId = `reason-${assessment.id}`;
  const label = submission ? "Replace file" : "Upload";

  return (
    <li
      className="space-y-4 rounded-xl border bg-card p-4 text-card-foreground"
      data-slot="my-assessment"
      data-state={assessment.state}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h2 className="text-base font-medium break-words">
            <Link href={href} className="underline-offset-4 hover:underline">
              {assessment.title}
            </Link>
          </h2>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">{assessment.module.code}</span> &middot;{" "}
            {assessment.module.title}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge group="assessment" value={assessment.state} />
          {assessment.status === "CLOSED" ? null : (
            <StatusBadge group="submission" value={assessment.status} detail={assessment.lateBy} />
          )}
        </div>
      </div>

      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Deadline ({APP_TIME_ZONE})</dt>
          <dd className="mt-0.5 text-sm">
            <DateTime value={assessment.deadline} />
            {assessment.extended ? (
              <span className="text-muted-foreground"> &middot; extended for you</span>
            ) : null}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">
            {assessment.state === "open" ? "Time left" : "Status"}
          </dt>
          <dd className="mt-0.5 text-sm">
            {assessment.state === "closed" ? (
              "Closed: no uploads"
            ) : (
              <Countdown deadline={assessment.deadline} serverNow={serverNow} />
            )}
          </dd>
        </div>
        <div className="min-w-0 sm:col-span-2">
          <dt className="text-xs text-muted-foreground">Your file</dt>
          <dd className="mt-0.5 text-sm break-words">
            {file ? (
              <>
                <span className="font-medium">{file.fileName}</span>
                <span className="text-muted-foreground">
                  {" "}
                  &middot; {formatFileSize(file.sizeBytes)} &middot; received{" "}
                  <DateTime value={file.uploadedAt} />
                </span>
                <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
                  SHA-256 {file.sha256.slice(0, 16)}&hellip;
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">Nothing uploaded yet.</span>
            )}
          </dd>
        </div>
      </dl>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {canUpload.allowed ? (
            <Button asChild>
              <Link href={href}>
                <UploadIcon data-icon="inline-start" aria-hidden="true" />
                {label}
              </Link>
            </Button>
          ) : (
            <Button type="button" disabled aria-describedby={reasonId}>
              <UploadIcon data-icon="inline-start" aria-hidden="true" />
              {label}
            </Button>
          )}
          <Button asChild variant="ghost">
            <Link href={href}>{submission ? "Receipts and history" : "Details"}</Link>
          </Button>
        </div>
        {canUpload.allowed ? null : (
          <p id={reasonId} className="text-sm text-foreground" data-slot="upload-blocked-reason">
            {canUpload.message}
          </p>
        )}
      </div>
    </li>
  );
}
