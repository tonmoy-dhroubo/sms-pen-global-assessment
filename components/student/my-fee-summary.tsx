import type { ReactNode } from "react";
import { Money } from "@/components/format/money";
import { NextDue } from "@/components/student/next-due";
import { OverdueMessage } from "@/components/student/overdue-message";
import { StatusBadge } from "@/components/shared/status-badge";
import type { MyFees } from "@/lib/services/fees";

// The figures at the top of the student's Fees page (pages.md `/student/fees`): charged, waived, paid, balance or
// credit, and the next due date, with the overdue message when something is overdue. A credit is shown as a credit,
// never as a negative balance.

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold">{children}</dd>
    </div>
  );
}

export function MyFeeSummary({ fees }: { fees: MyFees }) {
  const { summary, overdue, now } = fees;
  const inCredit = summary.feeState === "credit";

  return (
    <div className="space-y-4" data-slot="my-fee-summary">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-5">
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
        <Figure label="Next due">
          {summary.nextDueDate ? (
            <span className="block text-base font-medium">
              <NextDue date={summary.nextDueDate} now={now} />
            </span>
          ) : (
            <span className="text-base font-normal text-muted-foreground">Nothing due</span>
          )}
        </Figure>
      </dl>

      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <StatusBadge group="fees" value={summary.feeState} />
        <span className="text-muted-foreground">
          {summary.feeState === "outstanding" ? (
            <>
              <Money value={summary.balance} /> is outstanding, but nothing is due yet.
            </>
          ) : summary.feeState === "credit" ? (
            <>
              You have paid <Money value={summary.credit} /> more than has been charged.
            </>
          ) : summary.feeState === "paid" ? (
            "Nothing owed."
          ) : null}
        </span>
      </p>

      <OverdueMessage overdue={overdue} />
    </div>
  );
}
