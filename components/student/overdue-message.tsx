import { TriangleAlertIcon } from "lucide-react";
import { Money } from "@/components/format/money";
import type { MyFees } from "@/lib/services/fees";
import { cn } from "@/lib/utils";

// The overdue message on a student's overview and Fees page: how long, how much, and who to contact. The wording comes
// from the server (`overdueNotice`), so the page and the API agree. Icon and words as well as colour (D-017).

export function OverdueMessage({
  overdue,
  className,
}: {
  overdue: MyFees["overdue"];
  className?: string;
}) {
  if (!overdue) return null;
  return (
    <div
      role="status"
      data-slot="overdue-message"
      className={cn(
        "flex gap-2 rounded-lg bg-tone-red px-3 py-2 text-sm text-tone-red-foreground",
        className,
      )}
    >
      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-medium">{overdue.message}</p>
        <p>
          <Money value={overdue.amount} /> is overdue.
        </p>
      </div>
    </div>
  );
}
