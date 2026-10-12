import { FileTextIcon } from "lucide-react";
import Link from "next/link";
import { DownloadButton } from "@/components/assessments/download-button";
import { DateTime } from "@/components/format/date-time";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { ReceiptCard } from "@/components/submissions/receipt-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_TIME_ZONE } from "@/lib/services/rules/time";
import type { MyAssessment, MyFileVersion } from "@/lib/services/submissions";

// The Submissions section of the student record (pages.md `/staff/students/[id]`): for each assessment relevant to the
// student (their programme's modules, plus anything they submitted to) the deadline in Asia/Dhaka, the status badge
// with how late, and the file versions with receipt details (time, size, SHA-256) and a Download button. It shows the
// same data the student sees on their own assessments page (the M13 service), read for staff.

export interface StudentSubmissionsCardProps {
  studentName: string;
  assessments: readonly MyAssessment[];
}

function FileReceipt({ file, current }: { file: MyFileVersion; current: boolean }) {
  return (
    <ReceiptCard
      receipt={file}
      title={`Version ${file.version}`}
      label={current ? "Current" : undefined}
      action={<DownloadButton fileId={file.id} fileName={file.fileName} />}
    />
  );
}

function AssessmentItem({ assessment }: { assessment: MyAssessment }) {
  const { submission } = assessment;
  const [current, ...earlier] = submission?.versions ?? [];
  return (
    <li className="space-y-3 rounded-xl border p-4" data-slot="student-submission">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-0.5">
          <h3 className="text-sm font-medium break-words">
            <Link
              href={`/staff/assessments/${assessment.id}`}
              className="underline-offset-4 hover:underline"
            >
              {assessment.title}
            </Link>
          </h3>
          <p className="text-xs text-muted-foreground">
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

      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Deadline ({APP_TIME_ZONE})</dt>
          <dd className="mt-0.5 text-sm">
            <DateTime value={assessment.deadline} />
            {assessment.extended ? (
              <span className="text-muted-foreground"> &middot; extended for this student</span>
            ) : null}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Submitted</dt>
          <dd className="mt-0.5 text-sm">
            {submission ? (
              <DateTime value={submission.lastSubmittedAt} />
            ) : assessment.state === "closed" ? (
              <span className="text-muted-foreground">Nothing submitted; uploads are closed.</span>
            ) : (
              <span className="text-muted-foreground">Nothing submitted yet.</span>
            )}
          </dd>
        </div>
      </dl>

      {current ? <FileReceipt file={current} current /> : null}
      {earlier.length > 0 ? (
        <details className="rounded-xl border px-4 py-2">
          <summary className="cursor-pointer rounded-md py-1 text-sm font-medium focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
            {earlier.length === 1 ? "1 earlier version" : `${earlier.length} earlier versions`}
          </summary>
          <ol
            className="mt-2 space-y-3 pb-2"
            aria-label={`Earlier versions of ${assessment.title}`}
          >
            {earlier.map((file) => (
              <li key={file.id}>
                <FileReceipt file={file} current={false} />
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </li>
  );
}

export function StudentSubmissionsCard({ studentName, assessments }: StudentSubmissionsCardProps) {
  const submitted = assessments.filter((a) => a.submission).length;
  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle>Submissions</CardTitle>
        <CardDescription>
          {assessments.length === 0
            ? "Each assessment's deadline, status, file versions and receipt."
            : `${submitted} of ${assessments.length} ${assessments.length === 1 ? "assessment" : "assessments"} submitted. Each file's fingerprint is its proof of what arrived and when.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {assessments.length === 0 ? (
          <EmptyState
            icon={FileTextIcon}
            title="No assessments yet"
            description={`Assessments for ${studentName}'s programme modules appear here once staff create them.`}
          />
        ) : (
          <ul className="space-y-3" aria-label={`Submissions by ${studentName}`}>
            {assessments.map((assessment) => (
              <AssessmentItem key={assessment.id} assessment={assessment} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
