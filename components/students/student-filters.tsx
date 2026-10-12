"use client";

import { ChevronDownIcon, SearchIcon, XIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useListUrlState } from "@/components/data-table/data-table";
import { FilterSelect } from "@/components/shared/filter-select";
import { badgeDefinition } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import type { ProgrammeOption } from "@/lib/services/students";
import {
  DEFAULT_STATUS_FILTER,
  ENROLMENT_STATUSES,
  FEE_STATES,
  type EnrolmentStatusValue,
} from "@/lib/validation/students";

// Search box, filter controls and removable filter chips for the student list (pages.md `/staff/students`). Every
// control writes to the URL (`?q=...&status=...`), so the list can be bookmarked and shared; the server page reads
// the same params. Changing any of them sends the table back to page 1 (`useListUrlState`).

export const SEARCH_DEBOUNCE_MS = 300;

const FEE_STATE_LABEL: Record<(typeof FEE_STATES)[number], string> = {
  overdue: "Overdue",
  outstanding: "Outstanding (not yet due)",
  credit: "Credit",
  paid: "Paid",
};

const CLEAR_ALL = {
  q: null,
  programmeId: null,
  status: [],
  academicYear: null,
  yearOfStudy: null,
  feeState: null,
} as const;

function statusLabel(status: string): string {
  return badgeDefinition("enrolment", status)?.label ?? status;
}

/** The statuses in the URL, in the canonical order; empty means "the default" (enrolled and deferred). */
function statusesFrom(params: URLSearchParams): EnrolmentStatusValue[] {
  const wanted = new Set(params.getAll("status"));
  return ENROLMENT_STATUSES.filter((status) => wanted.has(status));
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}

export interface StudentFiltersProps {
  programmes: ProgrammeOption[];
  academicYears: string[];
  /** The longest programme, for the year-of-study options. */
  maxYearOfStudy: number;
}

interface Chip {
  key: string;
  label: string;
  onRemove: () => void;
}

export function StudentFilters({ programmes, academicYears, maxYearOfStudy }: StudentFiltersProps) {
  const searchParams = useSearchParams();
  const { update, isPending } = useListUrlState();

  const urlQuery = searchParams.get("q") ?? "";
  const programmeId = searchParams.get("programmeId");
  const academicYear = searchParams.get("academicYear");
  const yearOfStudy = searchParams.get("yearOfStudy");
  const feeState = searchParams.get("feeState");
  const statuses = statusesFrom(searchParams);
  const statusIsDefault = statuses.length === 0 || sameSet(statuses, DEFAULT_STATUS_FILTER);
  const shownStatuses: EnrolmentStatusValue[] = statusIsDefault
    ? [...DEFAULT_STATUS_FILTER]
    : statuses;

  // --- Search: typed text goes to the URL after a pause --------------------------------------------------------------
  const [text, setText] = useState(urlQuery);
  const lastSent = useRef(urlQuery);
  useEffect(() => {
    // The URL changed from outside (a chip, "Clear all", the back button): show it in the box.
    if (urlQuery !== lastSent.current) {
      lastSent.current = urlQuery;
      setText(urlQuery);
    }
  }, [urlQuery]);
  useEffect(() => {
    const next = text.trim();
    if (next === lastSent.current) return;
    const id = window.setTimeout(() => {
      lastSent.current = next;
      update({ q: next || null });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [text, update]);

  // --- Status ----------------------------------------------------------------------------------------------------------
  function setStatuses(next: readonly EnrolmentStatusValue[]) {
    const ordered = ENROLMENT_STATUSES.filter((status) => next.includes(status));
    // Nothing ticked, or the default pair ticked, both mean "the default": keep the URL clean.
    update({
      status: ordered.length === 0 || sameSet(ordered, DEFAULT_STATUS_FILTER) ? [] : ordered,
    });
  }
  function toggleStatus(status: EnrolmentStatusValue, on: boolean) {
    setStatuses(on ? [...shownStatuses, status] : shownStatuses.filter((s) => s !== status));
  }

  // --- Chips ----------------------------------------------------------------------------------------------------------
  const programmeCode = programmes.find((p) => p.id === programmeId)?.code ?? "Unknown programme";
  const chips: Chip[] = [];
  if (!statusIsDefault) {
    chips.push({
      key: "status",
      label: `Status: ${shownStatuses.map(statusLabel).join(", ")}`,
      onRemove: () => update({ status: [] }),
    });
  }
  if (programmeId) {
    chips.push({
      key: "programmeId",
      label: `Programme: ${programmeCode}`,
      onRemove: () => update({ programmeId: null }),
    });
  }
  if (academicYear) {
    chips.push({
      key: "academicYear",
      label: `Session: ${academicYear}`,
      onRemove: () => update({ academicYear: null }),
    });
  }
  if (yearOfStudy) {
    chips.push({
      key: "yearOfStudy",
      label: `Year: ${yearOfStudy}`,
      onRemove: () => update({ yearOfStudy: null }),
    });
  }
  if (feeState) {
    chips.push({
      key: "feeState",
      label: `Fees: ${FEE_STATE_LABEL[feeState as keyof typeof FEE_STATE_LABEL] ?? feeState}`,
      onRemove: () => update({ feeState: null }),
    });
  }

  const years = Array.from({ length: maxYearOfStudy }, (_, i) => String(i + 1));

  return (
    <section aria-label="Search and filters" className="@container space-y-3" aria-busy={isPending}>
      <Field>
        <FieldLabel htmlFor="student-search" className="sr-only">
          Search students
        </FieldLabel>
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            id="student-search"
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Search by name, Student ID (e.g. 0007) or email"
            autoComplete="off"
          />
        </InputGroup>
      </Field>

      <div className="grid grid-cols-1 gap-3 @sm:grid-cols-2 @xl:grid-cols-3 @3xl:grid-cols-5">
        <FilterSelect
          id="filter-programme"
          label="Programme"
          value={programmeId}
          onChange={(value) => update({ programmeId: value })}
          options={programmes.map((p) => ({ value: p.id, label: `${p.name} (${p.code})` }))}
        />
        <FilterSelect
          id="filter-session"
          label="Session"
          value={academicYear}
          onChange={(value) => update({ academicYear: value })}
          options={academicYears.map((year) => ({ value: year, label: year }))}
        />
        <FilterSelect
          id="filter-year"
          label="Year of study"
          value={yearOfStudy}
          onChange={(value) => update({ yearOfStudy: value })}
          options={years.map((year) => ({ value: year, label: `Year ${year}` }))}
        />
        <FilterSelect
          id="filter-fees"
          label="Fees"
          value={feeState}
          onChange={(value) => update({ feeState: value })}
          options={FEE_STATES.map((state) => ({ value: state, label: FEE_STATE_LABEL[state] }))}
        />
        <Field>
          <FieldLabel htmlFor="filter-status" className="text-xs text-muted-foreground">
            Status
          </FieldLabel>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                id="filter-status"
                aria-label={`Status: ${shownStatuses.map(statusLabel).join(", ")}`}
                variant="outline"
                className="w-full justify-between font-normal"
              >
                <span className="truncate">{shownStatuses.map(statusLabel).join(", ")}</span>
                <ChevronDownIcon className="text-muted-foreground" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>Show students who are</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {ENROLMENT_STATUSES.map((status) => (
                <DropdownMenuCheckboxItem
                  key={status}
                  checked={shownStatuses.includes(status)}
                  onCheckedChange={(on) => toggleStatus(status, on)}
                  // Keep the menu open so several statuses can be ticked in a row.
                  onSelect={(event) => event.preventDefault()}
                >
                  {statusLabel(status)}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {chips.length > 0 ? (
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
        ) : null}
        {chips.length > 0 || urlQuery ? (
          <Button variant="ghost" size="sm" onClick={() => update(CLEAR_ALL)}>
            Clear all
          </Button>
        ) : null}
        {statusIsDefault ? (
          <p className="text-muted-foreground">
            Withdrawn and completed students are hidden.{" "}
            <button
              type="button"
              className="underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              onClick={() => setStatuses(ENROLMENT_STATUSES)}
            >
              Show them
            </button>
          </p>
        ) : null}
      </div>
    </section>
  );
}
