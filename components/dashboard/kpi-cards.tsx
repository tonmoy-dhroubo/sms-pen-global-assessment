import type { ReactNode } from "react";
import Link from "next/link";
import { Money } from "@/components/format/money";
import { Card } from "@/components/ui/card";
import type { Dashboard } from "@/lib/services/dashboard";

// The dashboard's key figures (pages.md `/staff`): enrolled students (with the other statuses), total outstanding,
// overdue students, recent late submissions, and results awaiting publication. Each is a term and a value so a
// screen reader hears "Overdue students, 8"; the cards that have a place to go link to it.

function Kpi({
  label,
  value,
  detail,
  href,
  linkLabel,
}: {
  label: string;
  value: ReactNode;
  detail: ReactNode;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <Card size="sm" className="min-w-0">
      <dl className="flex h-full flex-col gap-1 px-(--card-spacing)">
        <dt className="text-sm text-muted-foreground">{label}</dt>
        <dd className="text-2xl font-semibold tracking-tight tabular-nums xl:text-xl">{value}</dd>
        <dd className="text-xs text-muted-foreground">{detail}</dd>
        {href ? (
          <dd className="mt-auto pt-1 text-xs">
            <Link href={href} className="underline underline-offset-4 hover:text-foreground">
              {linkLabel}
            </Link>
          </dd>
        ) : null}
      </dl>
    </Card>
  );
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function KpiCards({ kpis }: { kpis: Dashboard["kpis"] }) {
  const { students, outstanding, overdue, lateSubmissions, resultsAwaitingPublication } = kpis;
  const awaiting = resultsAwaitingPublication;

  return (
    <section aria-label="Key figures">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi
          label="Enrolled students"
          value={students.enrolled}
          detail={`${students.deferred} deferred · ${students.withdrawn} withdrawn · ${students.completed} completed`}
          href="/staff/students"
          linkLabel="View students"
        />
        <Kpi
          label="Total outstanding"
          value={<Money value={outstanding.amount} />}
          detail={`Owed by ${plural(outstanding.students, "student")}, overdue or not yet due`}
          href="/staff/fees"
          linkLabel="View fees"
        />
        <Kpi
          label="Overdue students"
          value={overdue.students}
          detail={
            overdue.students === 0 ? (
              "Nobody is behind on fees"
            ) : (
              <>
                <Money value={overdue.amount} /> past due
              </>
            )
          }
          href="/staff/fees?feeState=overdue"
          linkLabel="View overdue"
        />
        <Kpi
          label="Late submissions"
          value={lateSubmissions.count}
          detail={`In the last ${lateSubmissions.windowDays} days`}
        />
        <Kpi
          label="Results to publish"
          value={awaiting.draftMarks}
          detail={`${plural(awaiting.draftMarks, "draft mark")} in ${plural(awaiting.assessments, "assessment")} · ${awaiting.withheldMarks} withheld`}
          href="/staff/assessments"
          linkLabel="View assessments"
        />
      </div>
    </section>
  );
}
