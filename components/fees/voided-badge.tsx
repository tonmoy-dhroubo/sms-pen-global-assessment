"use client";

import { DateTime } from "@/components/format/date-time";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// "Voided" marker on a payment row. The reason is in a tooltip (hover, or focus with the keyboard) and also in the
// accessible name, so it does not depend on hovering. The date it was voided is shown beneath.

export function VoidedBadge({ voidedAt, reason }: { voidedAt: string; reason: string | null }) {
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            data-slot="voided-badge"
            aria-label={`Voided${reason ? `. Reason: ${reason}` : ""}`}
            className="inline-flex h-5 cursor-help items-center rounded-4xl border border-transparent bg-tone-grey px-2 py-0.5 text-xs font-medium whitespace-nowrap text-tone-grey-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Voided
          </span>
        </TooltipTrigger>
        <TooltipContent>{reason ?? "No reason recorded"}</TooltipContent>
      </Tooltip>
      <span className="text-xs text-muted-foreground">
        <DateTime value={voidedAt} dateOnly />
      </span>
    </span>
  );
}
