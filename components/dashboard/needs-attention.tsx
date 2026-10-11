import { CircleCheckIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { RelativeTime } from "@/components/format/date-time";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Dashboard, DashboardAttentionList } from "@/lib/services/dashboard";

// "Needs attention" (pages.md `/staff`): recent late submissions, withheld results and assessments with marks waiting
// to be published. Every row links to the student or the assessment it is about. Each list has its own empty line, and
// says how many more there are when it is cut short.

const link = "font-medium underline-offset-4 hover:underline";

function Section<T>({
  title,
  list,
  empty,
  moreNoun,
  children,
}: {
  title: string;
  list: DashboardAttentionList<T>;
  empty: string;
  /** What the hidden rows are called: "late submissions". */
  moreNoun: string;
  children: (item: T) => ReactNode;
}) {
  const hidden = list.total - list.items.length;
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">
        {title}
        {list.total > 0 ? (
          <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">
            ({list.total})
          </span>
        ) : null}
      </h3>
      {list.items.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CircleCheckIcon className="size-4 shrink-0" aria-hidden="true" />
          {empty}
        </p>
      ) : (
        <>
          <ul className="divide-y rounded-lg border">
            {list.items.map((item, index) => (
              <li key={index} className="px-3 py-2 text-sm">
                {children(item)}
              </li>
            ))}
          </ul>
          {hidden > 0 ? (
            <p className="text-xs text-muted-foreground">
              and {hidden} more {moreNoun}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

export function NeedsAttention({
  needsAttention,
  now,
}: {
  needsAttention: Dashboard["needsAttention"];
  now: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Needs attention</h2>
        </CardTitle>
        <CardDescription>
          Late work, held-back results and marks waiting to be published.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-3">
        <Section
          title="Recent late submissions"
          list={needsAttention.lateSubmissions}
          empty="No late submissions in the last 14 days."
          moreNoun="late submissions"
        >
          {(item) => (
            <div className="space-y-1">
              <div>
                <Link href={`/staff/students/${item.student.id}`} className={link}>
                  {item.student.fullName}
                </Link>{" "}
                <span className="text-muted-foreground">on</span>{" "}
                <Link href={item.href} className={link}>
                  {item.assessment.title}
                </Link>{" "}
                <span className="text-muted-foreground">({item.assessment.module.code})</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <StatusBadge group="submission" value="LATE" detail={item.lateBy} />
                <span className="text-xs text-muted-foreground">
                  submitted <RelativeTime value={item.submittedAt} now={now} />
                </span>
              </div>
            </div>
          )}
        </Section>

        <Section
          title="Withheld results"
          list={needsAttention.withheldResults}
          empty="No results are being withheld."
          moreNoun="withheld results"
        >
          {(item) => (
            <div className="space-y-1">
              <div>
                <Link href={item.href} className={link}>
                  {item.student.fullName}
                </Link>{" "}
                <span className="text-muted-foreground">
                  &middot; {item.assessment.title} ({item.assessment.module.code})
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <StatusBadge group="result" value="WITHHELD" />
                <span className="text-xs text-muted-foreground">
                  {item.reason ?? "No reason recorded"}
                </span>
              </div>
            </div>
          )}
        </Section>

        <Section
          title="Marks waiting to be published"
          list={needsAttention.draftAssessments}
          empty="Every entered mark has been published or withheld."
          moreNoun="assessments"
        >
          {(item) => (
            <div className="space-y-1">
              <div>
                <Link href={item.href} className={link}>
                  {item.assessment.title}
                </Link>{" "}
                <span className="text-muted-foreground">({item.assessment.module.code})</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <StatusBadge group="result" value="DRAFT" />
                <span className="text-xs text-muted-foreground tabular-nums">
                  {item.draftMarks} {item.draftMarks === 1 ? "mark" : "marks"} not yet published
                </span>
              </div>
            </div>
          )}
        </Section>
      </CardContent>
    </Card>
  );
}
