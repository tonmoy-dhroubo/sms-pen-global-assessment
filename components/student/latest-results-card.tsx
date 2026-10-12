import { GraduationCapIcon } from "lucide-react";
import Link from "next/link";
import { DateTime } from "@/components/format/date-time";
import { ClassificationBadge } from "@/components/marks/classification-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PublishedResult } from "@/lib/services/me";

// The results card on the student's overview (pages.md `/student`): the latest published marks only. A result that is
// not published has no place here, not even as a hint that one exists.

export function LatestResultsCard({ results }: { results: PublishedResult[] }) {
  return (
    <Card data-slot="latest-results-card" className="h-full">
      <CardHeader>
        <CardTitle className="text-base">Latest results</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        {results.length === 0 ? (
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <GraduationCapIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>No results have been published yet.</p>
          </div>
        ) : (
          <ul className="space-y-3" aria-label="Latest published results">
            {results.map((result) => (
              <li key={result.assessment.id} className="space-y-1" data-slot="latest-result">
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <span className="min-w-0 text-sm font-medium break-words">
                    {result.assessment.title}
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums">
                      {result.mark ?? "NS"}
                    </span>
                    <ClassificationBadge
                      classification={result.classification}
                      isNonSubmission={result.isNonSubmission}
                    />
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  <span className="font-mono">{result.assessment.module.code}</span> &middot;
                  published <DateTime value={result.publishedAt} dateOnly />
                </p>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-auto pt-1">
          <Button asChild variant="outline" size="sm">
            <Link href="/student/results">All results</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
