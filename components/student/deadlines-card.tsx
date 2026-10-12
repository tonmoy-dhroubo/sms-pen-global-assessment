import { CalendarClockIcon } from "lucide-react";
import Link from "next/link";
import { Countdown } from "@/components/format/countdown";
import { DateTime } from "@/components/format/date-time";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MyAssessment } from "@/lib/services/submissions";

// The deadlines card on the student's overview (pages.md `/student`): the next open assessments with a countdown and
// the state of the student's own submission. Each links to the assessment; the full list is on Assessments.

export function DeadlinesCard({
  deadlines,
  now,
}: {
  deadlines: MyAssessment[];
  /** The server's "now" (ISO), so the countdowns match between server and browser. */
  now: string;
}) {
  return (
    <Card data-slot="deadlines-card" className="h-full">
      <CardHeader>
        <CardTitle className="text-base">Next deadlines</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        {deadlines.length === 0 ? (
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <CalendarClockIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>No open deadlines right now.</p>
          </div>
        ) : (
          <ul className="space-y-3" aria-label="Next deadlines">
            {deadlines.map((assessment) => (
              <li key={assessment.id} className="space-y-1" data-slot="deadline">
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <Link
                    href={`/student/assessments/${assessment.id}`}
                    className="min-w-0 text-sm font-medium break-words underline-offset-4 hover:underline"
                  >
                    {assessment.title}
                  </Link>
                  <StatusBadge
                    group="submission"
                    value={assessment.status}
                    detail={assessment.lateBy}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  <span className="font-mono">{assessment.module.code}</span> &middot; due{" "}
                  <DateTime value={assessment.deadline} />
                </p>
                <p className="text-sm">
                  <Countdown deadline={assessment.deadline} serverNow={now} /> left
                </p>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-auto pt-1">
          <Button asChild variant="outline" size="sm">
            <Link href="/student/assessments">All assessments</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
