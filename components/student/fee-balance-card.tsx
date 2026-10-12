import Link from "next/link";
import { Money } from "@/components/format/money";
import { NextDue } from "@/components/student/next-due";
import { OverdueMessage } from "@/components/student/overdue-message";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MyFees } from "@/lib/services/fees";

// The fee card on the student's overview (pages.md `/student`): the balance, or the credit shown as a credit and never
// as a negative number, the overdue message when something is overdue, and the next due date.

const EXPLANATION = {
  paid: "Nothing owed.",
  outstanding: "Nothing is due yet.",
  overdue: "",
  credit: "You have paid more than has been charged.",
} as const;

export function FeeBalanceCard({ fees }: { fees: MyFees }) {
  const { summary, overdue, now } = fees;
  const inCredit = summary.feeState === "credit";

  return (
    <Card data-slot="fee-balance-card" className="h-full">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Fee balance</CardTitle>
        <StatusBadge group="fees" value={summary.feeState} />
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <div>
          <p className="text-xs text-muted-foreground">{inCredit ? "Credit" : "You owe"}</p>
          <p className="text-2xl font-semibold" data-slot="fee-figure">
            <Money value={inCredit ? summary.credit : summary.balance} />
          </p>
          {EXPLANATION[summary.feeState] ? (
            <p className="text-sm text-muted-foreground">{EXPLANATION[summary.feeState]}</p>
          ) : null}
        </div>

        <OverdueMessage overdue={overdue} />

        {summary.nextDueDate ? (
          <p className="text-sm">
            <span className="text-muted-foreground">Next due: </span>
            <NextDue date={summary.nextDueDate} now={now} />
          </p>
        ) : null}

        <div className="mt-auto pt-1">
          <Button asChild variant="outline" size="sm">
            <Link href="/student/fees">View fee details</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
