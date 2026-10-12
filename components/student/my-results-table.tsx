import { GraduationCapIcon } from "lucide-react";
import { DateTime } from "@/components/format/date-time";
import { ClassificationBadge } from "@/components/marks/classification-badge";
import { EmptyState } from "@/components/shared/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { MyResultItem } from "@/lib/services/marks";

// The student's results (pages.md `/student/results`): a published result shows its mark and classification (a
// non-submission reads "NS"); every other row says "Not yet available" and nothing else. The row is built from the
// status alone, so a draft or withheld mark, its classification or a withheld reason can never be rendered here even if
// the data carried them (DB-010, D-036).

export const NOT_AVAILABLE_TEXT = "Not yet available";

export function MyResultsTable({ items }: { items: MyResultItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={GraduationCapIcon}
        title="No assessments yet"
        description="Results for your programme's assessments appear here as soon as the Registry publishes them."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <caption className="sr-only">Your results</caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Assessment</TableHead>
            <TableHead scope="col">Mark</TableHead>
            <TableHead scope="col">Result</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.assessment.id} data-status={item.status}>
              <TableCell className="min-w-40 whitespace-normal">
                <span className="block font-medium break-words">{item.assessment.title}</span>
                <span className="block text-xs text-muted-foreground">
                  <span className="font-mono">{item.assessment.module.code}</span> &middot;{" "}
                  {item.assessment.module.title}
                </span>
              </TableCell>
              {item.status === "PUBLISHED" ? (
                <>
                  <TableCell className="font-semibold tabular-nums">
                    {item.mark ?? "NS"}
                    <span className="block text-xs font-normal text-muted-foreground">
                      <DateTime value={item.publishedAt} dateOnly />
                    </span>
                  </TableCell>
                  <TableCell>
                    <ClassificationBadge
                      classification={item.classification}
                      isNonSubmission={item.isNonSubmission}
                    />
                  </TableCell>
                </>
              ) : (
                <TableCell colSpan={2} className="text-muted-foreground">
                  {NOT_AVAILABLE_TEXT}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
