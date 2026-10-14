import { ArrowLeftIcon, HistoryIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Countdown } from "@/components/format/countdown";
import { DateTime, RelativeTime } from "@/components/format/date-time";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { SubmissionHistory } from "@/components/submissions/submission-history";
import { SubmissionRules } from "@/components/submissions/submission-rules";
import { UploadPanel } from "@/components/submissions/upload-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NotFoundError } from "@/lib/api/errors";
import { requireStudentPage } from "@/lib/page-guards";
import { APP_TIME_ZONE } from "@/lib/services/rules/time";
import { getMyAssessment, maxUploadBytes } from "@/lib/services/submissions";

export const metadata: Metadata = { title: "Assessment" };

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm break-words">{children}</dd>
    </div>
  );
}

// One assessment for the student (pages.md `/student/assessments/[id]`): the deadline and countdown, the rules in plain
// words, the upload panel (or the reason it is disabled), and the history of uploaded versions with their receipts.
// Another student's data never appears: the service only reads this student's submission, and an assessment that is
// neither in their programme nor already submitted to is a 404.
export default async function MyAssessmentPage({ params }: { params: Promise<{ id: string }> }) {
  const identity = await requireStudentPage();
  const { id } = await params;

  const { now, assessment } = await getMyAssessment(identity.student.id, id).catch(
    (error: unknown) => {
      if (error instanceof NotFoundError) notFound();
      throw error;
    },
  );
  const { submission, canUpload } = assessment;

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2.5">
          <Link href="/student/assessments">
            <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
            Assessments
          </Link>
        </Button>
      </div>

      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {assessment.title}
            <StatusBadge group="assessment" value={assessment.state} />
            {assessment.status === "CLOSED" ? null : (
              <StatusBadge
                group="submission"
                value={assessment.status}
                detail={assessment.lateBy}
              />
            )}
          </span>
        }
        description={
          <>
            <span className="font-mono">{assessment.module.code}</span> &middot;{" "}
            {assessment.module.title}
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Deadline</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <Detail label={`Deadline (${APP_TIME_ZONE})`}>
              <DateTime value={assessment.deadline} />
              {assessment.extended ? (
                <span className="text-muted-foreground"> &middot; extended for you</span>
              ) : null}
            </Detail>
            <Detail
              label={
                assessment.closedAt
                  ? "Closed"
                  : assessment.state === "open"
                    ? "Time left"
                    : "Status"
              }
            >
              {assessment.closedAt ? (
                <>
                  <RelativeTime value={assessment.closedAt} now={now} /> (
                  <DateTime value={assessment.closedAt} />)
                </>
              ) : (
                <Countdown deadline={assessment.deadline} serverNow={now} />
              )}
            </Detail>
          </dl>
        </CardContent>
      </Card>

      <SubmissionRules />

      <Card>
        <CardHeader>
          <CardTitle>{submission ? "Replace your file" : "Upload your work"}</CardTitle>
        </CardHeader>
        <CardContent>
          <UploadPanel
            assessmentId={assessment.id}
            canUpload={canUpload}
            hasSubmission={submission !== null}
            maxBytes={maxUploadBytes()}
          />
        </CardContent>
      </Card>

      <section className="space-y-3" aria-labelledby="history-heading">
        <h2 id="history-heading" className="text-lg font-semibold tracking-tight">
          Your submission
        </h2>
        {submission ? (
          <>
            <p className="text-sm text-muted-foreground">
              First submitted <DateTime value={submission.firstSubmittedAt} />
              {submission.versions.length > 1 ? (
                <>
                  , last updated <DateTime value={submission.lastSubmittedAt} />
                </>
              ) : null}
              . Every version is kept, with its own receipt.
            </p>
            <SubmissionHistory versions={submission.versions} />
          </>
        ) : (
          <EmptyState
            icon={HistoryIcon}
            title="Nothing submitted yet"
            description="When you upload a file, its receipt appears here: the time it arrived, its size and its SHA-256 fingerprint."
          />
        )}
      </section>
    </div>
  );
}
