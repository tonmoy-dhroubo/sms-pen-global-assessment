import { Money } from "@/components/format/money";
import { StatusBadge } from "@/components/shared/status-badge";
import type { FeeSummaryDto } from "@/lib/services/fee-summary";

// A student's fee state as a badge with the one figure that explains it: how much and how long overdue, what is
// outstanding, or the credit held. Used by the student list and the record header.

export function FeeStatus({ summary }: { summary: FeeSummaryDto }) {
  const { feeState } = summary;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <StatusBadge group="fees" value={feeState} />
      {feeState === "overdue" ? (
        <span className="text-xs text-muted-foreground">
          <Money value={summary.overdueAmount} />
          {summary.oldestOverdueDays !== null
            ? ` · ${summary.oldestOverdueDays} ${summary.oldestOverdueDays === 1 ? "day" : "days"}`
            : null}
        </span>
      ) : feeState === "outstanding" ? (
        <span className="text-xs text-muted-foreground">
          <Money value={summary.balance} />
        </span>
      ) : feeState === "credit" ? (
        <span className="text-xs text-muted-foreground">
          <Money value={summary.credit} />
        </span>
      ) : null}
    </span>
  );
}
