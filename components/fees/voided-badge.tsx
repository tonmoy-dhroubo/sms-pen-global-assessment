"use client";

import { DateTime } from "@/components/format/date-time";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// "Voided" marker on a payment row. Who voided it and the reason are in a tooltip (hover, or focus with the keyboard) and also in the
// accessible name, so it does not depend on hovering. The date it was voided is shown beneath.

export function VoidedBadge({
  voidedAt,
  voidedBy,
  reason,
}: {
  voidedAt: string;
  voidedBy: { fullName: string } | null;
  reason: string | null;
}) {
  const by = voidedBy ? `Voided by ${voidedBy.fullName}` : "Voided";
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            data-slot="voided-badge"
            aria-label={`${by}${reason ? `. Reason: ${reason}` : ""}`}
            className="inline-flex h-5 cursor-help items-center rounded-4xl border border-transparent bg-tone-grey px-2 py-0.5 text-xs font-medium whitespace-nowrap text-tone-grey-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Voided
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <span className="grid gap-0.5">
            <span className="font-medium">{by}</span>
            <span>{reason ?? "No reason recorded"}</span>
          </span>
        </TooltipContent>
      </Tooltip>
      <span className="text-xs text-muted-foreground">
        <DateTime value={voidedAt} dateOnly />
      </span>
    </span>
  );
}
