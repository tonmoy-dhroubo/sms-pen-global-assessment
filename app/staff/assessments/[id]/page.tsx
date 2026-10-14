import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AssessmentActions } from "@/components/assessments/assessment-actions";
import { SubmissionsTable } from "@/components/assessments/submissions-table";
import { Countdown } from "@/components/format/countdown";
import { DateTime, RelativeTime } from "@/components/format/date-time";
import { MarksheetGrid } from "@/components/marks/marksheet-grid";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NotFoundError } from "@/lib/api/errors";
import { requireStaffPage } from "@/lib/page-guards";
import { getAssessment, listSubmissions } from "@/lib/services/assessments";
import { systemClock } from "@/lib/services/clock";
import { getMarksheet } from "@/lib/services/marks";
import { listModules } from "@/lib/services/programmes";
import { APP_TIME_ZONE } from "@/lib/services/rules/time";

export const metadata: Metadata = { title: "Assessment" };

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm break-words">{children}</dd>
    </div>
  );
}

// One assessment (pages.md `/staff/assessments/[id]`): the header with the deadline, countdown and state, the Edit /
// Close / Reopen actions, and two tabs. Submissions lists every eligible student with status, files and downloads;
// Marksheet is the grade entry grid (mark entry, classification, publish, withhold). The marksheet stays mounted when
// the tab is hidden, so a mark being typed is not lost by a click on Submissions.
export default async function AssessmentPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaffPage();
  const { id } = await params;

  const now = systemClock();
  const [assessment, submissions, marksheet, modules] = await Promise.all([
    getAssessment(id, () => now),
    listSubmissions(id),
    getMarksheet(id),
    listModules(),
  ]).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const serverNow = now.toISOString();
  const { counts } = assessment;

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2.5">
          <Link href="/staff/assessments">
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
          </span>
        }
        description={
          <>
            <span className="font-mono">{assessment.module.code}</span> &middot;{" "}
            {assessment.module.title}
          </>
        }
        actions={
          <AssessmentActions
            assessment={assessment}
            modules={modules.map(({ id: moduleId, code, title }) => ({
              id: moduleId,
              code,
              title,
            }))}
            now={serverNow}
          />
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Deadline and progress</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            <Detail label={`Deadline (${APP_TIME_ZONE})`}>
              <DateTime value={assessment.deadline} />
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
                  Closed <RelativeTime value={assessment.closedAt} now={serverNow} /> (
                  <DateTime value={assessment.closedAt} />)
                </>
              ) : (
                <Countdown deadline={assessment.deadline} serverNow={serverNow} />
              )}
            </Detail>
            <Detail label="Uploads">
              {assessment.state === "closed"
                ? "Closed: no uploads, not even late ones"
                : assessment.state === "past-deadline"
                  ? "Still accepted, marked late"
                  : "Open"}
            </Detail>
            <Detail label="Created by">{assessment.createdBy.fullName}</Detail>
            <Detail label="Submitted">
              <span className="tabular-nums">
                {counts.submitted} of {counts.eligible}
              </span>
              {counts.late > 0 ? (
                <span className="text-muted-foreground"> ({counts.late} late)</span>
              ) : null}
            </Detail>
            <Detail label="Marked">
              <span className="tabular-nums">
                {counts.marked} of {counts.eligible}
              </span>
            </Detail>
            <Detail label="Published">
              <span className="tabular-nums">
                {counts.published} of {counts.marked}
              </span>
            </Detail>
          </dl>
        </CardContent>
      </Card>

      <Tabs defaultValue="submissions">
        <TabsList aria-label="Assessment sections">
          <TabsTrigger value="submissions">Submissions</TabsTrigger>
          <TabsTrigger value="marksheet">Marksheet</TabsTrigger>
        </TabsList>
        <TabsContent value="submissions" className="pt-2">
          <SubmissionsTable submissions={submissions} />
        </TabsContent>
        <TabsContent value="marksheet" forceMount className="pt-2 data-[state=inactive]:hidden">
          <MarksheetGrid
            assessmentId={assessment.id}
            assessmentTitle={assessment.title}
            initial={marksheet}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
