"use client";

import { XIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useListUrlState } from "@/components/data-table/data-table";
import { FilterSelect } from "@/components/shared/filter-select";
import { Button } from "@/components/ui/button";
import { AGEING_BUCKETS } from "@/lib/services/rules/fees";
import { BALANCE_FEE_STATES } from "@/lib/validation/fees";

// Filters and removable chips for the fees overview (pages.md `/staff/fees`): programme, fee state and ageing bucket.
// Every control writes to the URL, so a filtered view can be bookmarked and shared; the server page reads the same
// params. Changing a filter sends the table back to page 1 (`useListUrlState`).

const FEE_STATE_LABEL: Record<(typeof BALANCE_FEE_STATES)[number], string> = {
  overdue: "Overdue",
  outstanding: "Outstanding (not yet due)",
  credit: "Credit",
};

const AGEING_LABEL: Record<(typeof AGEING_BUCKETS)[number], string> = {
  "1-30": "1–30 days overdue",
  "31-60": "31–60 days overdue",
  "60+": "More than 60 days overdue",
};

export interface BalancesFiltersProps {
  programmes: { id: string; code: string; name: string }[];
}

export function BalancesFilters({ programmes }: BalancesFiltersProps) {
  const searchParams = useSearchParams();
  const { update, isPending } = useListUrlState();

  const programmeId = searchParams.get("programmeId");
  const feeState = searchParams.get("feeState");
  const rawBucket = searchParams.get("ageingBucket");
  // A hand-typed `60+` reaches the URL as "60 ": show it as the bucket it means.
  const ageingBucket = rawBucket?.trim() === "60" ? "60+" : rawBucket;

  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  if (feeState) {
    chips.push({
      key: "feeState",
      label: `Fees: ${FEE_STATE_LABEL[feeState as keyof typeof FEE_STATE_LABEL] ?? feeState}`,
      onRemove: () => update({ feeState: null }),
    });
  }
  if (ageingBucket) {
    chips.push({
      key: "ageingBucket",
      label: `Ageing: ${AGEING_LABEL[ageingBucket as keyof typeof AGEING_LABEL] ?? ageingBucket}`,
      onRemove: () => update({ ageingBucket: null }),
    });
  }
  if (programmeId) {
    chips.push({
      key: "programmeId",
      label: `Programme: ${programmes.find((p) => p.id === programmeId)?.code ?? "Unknown programme"}`,
      onRemove: () => update({ programmeId: null }),
    });
  }

  return (
    <section aria-label="Filters" className="space-y-3" aria-busy={isPending}>
      <div className="grid gap-3 sm:grid-cols-3">
        <FilterSelect
          id="filter-fee-state"
          label="Fee state"
          value={feeState}
          onChange={(value) => update({ feeState: value })}
          options={BALANCE_FEE_STATES.map((state) => ({
            value: state,
            label: FEE_STATE_LABEL[state],
          }))}
        />
        <FilterSelect
          id="filter-ageing"
          label="Ageing"
          value={ageingBucket}
          onChange={(value) => update({ ageingBucket: value })}
          options={AGEING_BUCKETS.map((bucket) => ({ value: bucket, label: AGEING_LABEL[bucket] }))}
        />
        <FilterSelect
          id="filter-programme"
          label="Programme"
          value={programmeId}
          onChange={(value) => update({ programmeId: value })}
          options={programmes.map((p) => ({ value: p.id, label: `${p.name} (${p.code})` }))}
        />
      </div>

      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <ul className="flex flex-wrap items-center gap-2" aria-label="Active filters">
            {chips.map((chip) => (
              <li key={chip.key}>
                <button
                  type="button"
                  onClick={chip.onRemove}
                  aria-label={`Remove filter ${chip.label}`}
                  className="inline-flex items-center gap-1.5 rounded-4xl border bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {chip.label}
                  <XIcon className="size-3" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => update({ feeState: null, ageingBucket: null, programmeId: null })}
          >
            Clear all
          </Button>
        </div>
      ) : null}
    </section>
  );
}
