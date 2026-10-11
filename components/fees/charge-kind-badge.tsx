import { cn } from "@/lib/utils";
import type { FeeChargeKind } from "@/lib/services/rules/types";

// The kind of a fee charge, as a labelled badge (pages.md: charges table with kind badges). Same tone tokens as the
// status badges; the text label always carries the meaning.

const KINDS: Record<FeeChargeKind, { label: string; classes: string }> = {
  PROGRAMME_FEE: { label: "Programme fee", classes: "bg-tone-grey text-tone-grey-foreground" },
  ADJUSTMENT: { label: "Adjustment", classes: "bg-tone-amber text-tone-amber-foreground" },
  WAIVER: { label: "Waiver", classes: "bg-tone-blue text-tone-blue-foreground" },
};

export function ChargeKindBadge({ kind, className }: { kind: FeeChargeKind; className?: string }) {
  const { label, classes } = KINDS[kind];
  return (
    <span
      data-slot="charge-kind-badge"
      data-kind={kind}
      className={cn(
        "inline-flex h-5 w-fit shrink-0 items-center rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        classes,
        className,
      )}
    >
      {label}
    </span>
  );
}
