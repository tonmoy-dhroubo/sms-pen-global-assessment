import type { ReactNode } from "react";
import { DateTime } from "@/components/format/date-time";
import { Money } from "@/components/format/money";
import { StatusBadge } from "@/components/shared/status-badge";
import type { FeeSummaryDto } from "@/lib/services/fee-summary";
import { daysBetween, todayIn } from "@/lib/services/rules/time";

// The figures at the top of a student's Fees section (pages.md): charged, waived, paid, balance or credit, overdue
// amount and age, and what is next due, plus one sentence that says what the fee state means. A credit is shown as a
// credit, never as a negative balance; "outstanding but not yet due" reads differently from "overdue" (edge-cases.md).

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold">{children}</dd>
    </div>
  );
}

function days(count: number): string {
  return `${count} ${count === 1 ? "day" : "days"}`;
}

function dueIn(date: string, today: string): string {
  const away = daysBetween(today, date);
  return away === 0 ? "today" : away === 1 ? "tomorrow" : `in ${days(away)}`;
}

export function FeeSummaryStrip({
  summary,
  today = todayIn(new Date()),
}: {
  summary: FeeSummaryDto;
  today?: string;
}) {
  const { feeState } = summary;
  const inCredit = feeState === "credit";

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-3 xl:grid-cols-6">
        <Figure label="Charged">
          <Money value={summary.charged} />
        </Figure>
        <Figure label="Waived">
          <Money value={summary.waived} />
        </Figure>
        <Figure label="Paid">
          <Money value={summary.paid} />
        </Figure>
        <Figure label={inCredit ? "Credit" : "Balance"}>
          <Money value={inCredit ? summary.credit : summary.balance} />
        </Figure>
        <Figure label="Overdue">
          {feeState === "overdue" ? (
            <>
              <Money value={summary.overdueAmount} />
              {summary.oldestOverdueDays !== null ? (
                <>
                  <span className="block text-xs font-normal text-muted-foreground">
                    {days(summary.oldestOverdueDays)} overdue
                  </span>
                  {summary.ageingBucket ? (
                    <span className="block text-xs font-normal text-muted-foreground">
                      Ageing: {summary.ageingBucket} days
                    </span>
                  ) : null}
                </>
              ) : null}
            </>
          ) : (
            <span className="text-muted-foreground">None</span>
          )}
        </Figure>
        <Figure label="Next due">
          {summary.nextDueDate ? (
            <>
              <DateTime value={summary.nextDueDate} />
              <span className="block text-xs font-normal text-muted-foreground">
                {dueIn(summary.nextDueDate, today)}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">Nothing due</span>
          )}
        </Figure>
      </dl>

      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <StatusBadge group="fees" value={feeState} />
        <span className="text-muted-foreground">
          {feeState === "overdue" ? (
            <>
              Overdue: <Money value={summary.overdueAmount} /> was due and has not been paid.
              {summary.nextDueDate ? " More is due later." : null}
            </>
          ) : feeState === "outstanding" ? (
            <>
              <Money value={summary.balance} /> is outstanding, but nothing is due yet.
            </>
          ) : feeState === "credit" ? (
            <>
              Paid <Money value={summary.credit} /> more than has been charged.
            </>
          ) : (
            "Nothing owed."
          )}
        </span>
      </p>
    </div>
  );
}
