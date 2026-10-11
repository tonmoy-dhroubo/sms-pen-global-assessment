"use client";

import { XIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useListUrlState } from "@/components/data-table/data-table";
import { FilterSelect } from "@/components/shared/filter-select";
import { Button } from "@/components/ui/button";
import { ASSESSMENT_STATES, type AssessmentStateFilter } from "@/lib/validation/assessments";

// Filters and removable chips for the assessment list (pages.md `/staff/assessments`): module and state. Every
// control writes to the URL, so a filtered view can be bookmarked; the server page reads the same params. Changing a
// filter sends the table back to page 1 (`useListUrlState`).

const STATE_LABEL: Record<AssessmentStateFilter, string> = {
  open: "Open",
  "past-deadline": "Past deadline",
  closed: "Closed",
};

const STATE_OPTION_LABEL: Record<AssessmentStateFilter, string> = {
  open: "Open",
  "past-deadline": "Past deadline (still accepting late work)",
  closed: "Closed",
};

export interface AssessmentFiltersProps {
  modules: { id: string; code: string; title: string }[];
}

export function AssessmentFilters({ modules }: AssessmentFiltersProps) {
  const searchParams = useSearchParams();
  const { update, isPending } = useListUrlState();

  const moduleId = searchParams.get("moduleId");
  const state = searchParams.get("state");

  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  if (moduleId) {
    chips.push({
      key: "moduleId",
      label: `Module: ${modules.find((m) => m.id === moduleId)?.code ?? "Unknown module"}`,
      onRemove: () => update({ moduleId: null }),
    });
  }
  if (state) {
    chips.push({
      key: "state",
      label: `State: ${STATE_LABEL[state as AssessmentStateFilter] ?? state}`,
      onRemove: () => update({ state: null }),
    });
  }

  return (
    <section aria-label="Filters" className="space-y-3" aria-busy={isPending}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FilterSelect
          id="filter-module"
          label="Module"
          value={moduleId}
          onChange={(value) => update({ moduleId: value })}
          options={modules.map((m) => ({ value: m.id, label: `${m.code} · ${m.title}` }))}
        />
        <FilterSelect
          id="filter-state"
          label="State"
          value={state}
          onChange={(value) => update({ state: value })}
          options={ASSESSMENT_STATES.map((s) => ({ value: s, label: STATE_OPTION_LABEL[s] }))}
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
          <Button variant="ghost" size="sm" onClick={() => update({ moduleId: null, state: null })}>
            Clear all
          </Button>
        </div>
      ) : null}
    </section>
  );
}
