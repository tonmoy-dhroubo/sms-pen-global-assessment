"use client";

import {
  ChevronDownIcon,
  ChevronRightIcon,
  EyeOffIcon,
  GraduationCapIcon,
  SendIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";
import { toast } from "sonner";
import { DateTime } from "@/components/format/date-time";
import { ClassificationBadge } from "@/components/marks/classification-badge";
import { MarkHistory, markText } from "@/components/marks/mark-history";
import { PublishPreviewDialog } from "@/components/marks/publish-preview-dialog";
import { ReasonDialog } from "@/components/dialogs/reason-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { withholdMarksRequest } from "@/lib/client/marks";
import type { StudentResults } from "@/lib/services/marks";

// The Results section of the student record (pages.md `/staff/students/[id]`): every mark across assessments with its
// classification and release status (the withheld reason is shown here, for staff only), and an expandable history of
// every change and release. "Publish all for this student" opens the same preview dialog as the marksheet;
// "Withhold this student's results" asks for a reason and holds back every draft and published mark at once, through
// the same endpoint as the marksheet's Withhold.

export interface StudentResultsCardProps {
  studentId: string;
  studentName: string;
  results: StudentResults;
}

export function StudentResultsCard({ studentId, studentName, results }: StudentResultsCardProps) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [publishing, setPublishing] = useState(false);
  const [withholding, setWithholding] = useState(false);
  const { summary, items } = results;

  // Withholding applies to draft and published marks; ones already withheld keep their own reason.
  const withholdable = items.filter((item) => item.releaseStatus !== "WITHHELD");
  const withholdablePublished = withholdable.filter((item) => item.releaseStatus === "PUBLISHED");

  async function withholdAll(reason: string) {
    const result = await withholdMarksRequest(
      withholdable.map((item) => item.markId),
      reason,
    );
    toast.success(
      `Withheld ${result.changed} ${result.changed === 1 ? "mark" : "marks"} for ${studentName}.` +
        (result.skipped > 0
          ? ` ${result.skipped} ${result.skipped === 1 ? "was" : "were"} left as ${result.skipped === 1 ? "it was" : "they were"}.`
          : ""),
    );
    router.refresh();
  }

  function toggle(markId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(markId)) next.delete(markId);
      else next.add(markId);
      return next;
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <CardTitle>Results</CardTitle>
          <CardDescription>
            {summary.total === 0
              ? "Grades, classification, release status and history."
              : `${summary.total} ${summary.total === 1 ? "mark" : "marks"}: ${summary.published} published, ${summary.draft} draft, ${summary.withheld} withheld.`}
          </CardDescription>
        </div>
        {summary.total > 0 ? (
          <div className="flex flex-col gap-2 sm:items-end">
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => setPublishing(true)}>
                <SendIcon data-icon="inline-start" aria-hidden="true" />
                Publish all for this student…
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={withholdable.length === 0}
                aria-describedby={withholdable.length === 0 ? "withhold-none" : undefined}
                onClick={() => setWithholding(true)}
              >
                <EyeOffIcon data-icon="inline-start" aria-hidden="true" />
                Withhold this student&apos;s results…
              </Button>
            </div>
            {withholdable.length === 0 ? (
              <p id="withhold-none" className="text-xs text-muted-foreground">
                Every mark is already withheld.
              </p>
            ) : null}
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <EmptyState
            icon={GraduationCapIcon}
            title="No marks yet"
            description="Marks appear here once they are entered on an assessment's Marksheet tab."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <Table className="min-w-[640px]">
              <caption className="sr-only">Results for {studentName}</caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Assessment</TableHead>
                  <TableHead scope="col">Mark</TableHead>
                  <TableHead scope="col">Result</TableHead>
                  <TableHead scope="col">Release</TableHead>
                  <TableHead scope="col">
                    <span className="sr-only">History</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const open = expanded.has(item.markId);
                  const panelId = `history-${item.markId}`;
                  return (
                    <Fragment key={item.markId}>
                      <TableRow data-state={open ? "expanded" : undefined}>
                        <TableCell>
                          <div className="min-w-40">
                            <Link
                              href={`/staff/assessments/${item.assessment.id}`}
                              className="font-medium underline-offset-4 hover:underline"
                            >
                              {item.assessment.title}
                            </Link>
                            <div className="text-xs text-muted-foreground">
                              <span className="font-mono">{item.assessment.module.code}</span>{" "}
                              &middot; {item.assessment.module.title}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="tabular-nums">{markText(item.mark)}</TableCell>
                        <TableCell>
                          <ClassificationBadge
                            classification={item.classification}
                            isNonSubmission={item.isNonSubmission}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="min-w-28 space-y-1">
                            <StatusBadge group="result" value={item.releaseStatus} />
                            {item.releaseStatus === "WITHHELD" ? (
                              <div className="max-w-56 text-xs text-muted-foreground">
                                <span className="font-medium">Reason:</span>{" "}
                                {item.withheldReason ?? "none recorded"}
                              </div>
                            ) : null}
                            {item.releaseStatus === "PUBLISHED" && item.publishedAt ? (
                              <div className="text-xs text-muted-foreground">
                                <DateTime value={item.publishedAt} />
                              </div>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-expanded={open}
                            aria-controls={open ? panelId : undefined}
                            aria-label={`${open ? "Hide" : "Show"} history for ${item.assessment.title}`}
                            onClick={() => toggle(item.markId)}
                          >
                            {open ? (
                              <ChevronDownIcon data-icon="inline-start" aria-hidden="true" />
                            ) : (
                              <ChevronRightIcon data-icon="inline-start" aria-hidden="true" />
                            )}
                            History ({item.history.length})
                          </Button>
                        </TableCell>
                      </TableRow>
                      {open ? (
                        <TableRow id={panelId} className="bg-muted/40 hover:bg-muted/40">
                          <TableCell colSpan={5}>
                            <MarkHistory
                              history={item.history}
                              enteredBy={item.enteredBy.fullName}
                              label={`History of ${item.assessment.title}`}
                            />
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <PublishPreviewDialog
        open={publishing}
        onOpenChange={setPublishing}
        target={{ studentId }}
        subject={studentName}
        onPublished={() => router.refresh()}
      />
      <ReasonDialog
        open={withholding}
        onOpenChange={setWithholding}
        title={`Withhold ${studentName}'s results`}
        description={
          <>
            {withholdable.length} {withholdable.length === 1 ? "mark" : "marks"}
            {withholdablePublished.length > 0
              ? ` (${withholdablePublished.length} published, ${withholdable.length - withholdablePublished.length} draft)`
              : ""}{" "}
            will be hidden from the student (shown as &ldquo;Not yet available&rdquo;).
            {summary.withheld > 0
              ? ` ${summary.withheld} already withheld ${summary.withheld === 1 ? "mark keeps" : "marks keep"} its own reason.`
              : ""}{" "}
            The reason is kept for staff.
          </>
        }
        reasonHint="For example: Outstanding fees, or Academic misconduct inquiry."
        confirmLabel={`Withhold ${withholdable.length} ${withholdable.length === 1 ? "mark" : "marks"}`}
        destructive
        onSubmit={withholdAll}
      />
    </Card>
  );
}
