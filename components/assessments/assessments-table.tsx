"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { ClipboardListIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { ProgressCount } from "@/components/assessments/progress-count";
import { DataTable, useListUrlState } from "@/components/data-table/data-table";
import { DateTime, RelativeTime } from "@/components/format/date-time";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import type { AssessmentSummary } from "@/lib/services/assessments";

// The assessment list (pages.md `/staff/assessments`): module, title, deadline with "in 2 days" / "3 days ago", open or
// closed, how many students submitted and how many were late, and marking and release progress. Sorting and paging are
// on the server through DataTable; sortable columns use the API's sort field names.

function makeColumns(now: string): ColumnDef<AssessmentSummary, unknown>[] {
  return [
    {
      id: "module",
      header: "Module",
      enableSorting: true,
      cell: ({ row }) => (
        <div className="min-w-32">
          <span className="font-mono text-xs">{row.original.module.code}</span>
          <span className="block text-xs text-muted-foreground">{row.original.module.title}</span>
        </div>
      ),
    },
    {
      id: "title",
      header: "Assessment",
      enableSorting: true,
      cell: ({ row }) => (
        <Link
          href={`/staff/assessments/${row.original.id}`}
          className="font-medium underline-offset-4 hover:underline"
        >
          {row.original.title}
        </Link>
      ),
    },
    {
      id: "deadline",
      header: "Deadline",
      enableSorting: true,
      cell: ({ row }) => (
        <div className="min-w-36">
          <DateTime value={row.original.deadline} />
          <RelativeTime
            value={row.original.deadline}
            now={now}
            className="block text-xs text-muted-foreground"
          />
        </div>
      ),
    },
    {
      id: "state",
      header: "State",
      cell: ({ row }) => <StatusBadge group="assessment" value={row.original.state} />,
    },
    {
      id: "submissions",
      header: "Submitted",
      cell: ({ row }) => {
        const { submitted, eligible, late } = row.original.counts;
        return (
          <div className="min-w-24 tabular-nums">
            {submitted} <span className="text-muted-foreground">of {eligible}</span>
            {late > 0 ? <span className="block text-xs">{late} late</span> : null}
          </div>
        );
      },
    },
    {
      id: "marking",
      header: "Marking",
      cell: ({ row }) => (
        <ProgressCount
          done={row.original.counts.marked}
          total={row.original.counts.eligible}
          label="marked"
        />
      ),
    },
    {
      id: "release",
      header: "Release",
      cell: ({ row }) => (
        <ProgressCount
          done={row.original.counts.published}
          total={row.original.counts.marked}
          label="published"
        />
      ),
    },
  ];
}

export interface AssessmentsTableProps {
  items: AssessmentSummary[];
  total: number;
  page: number;
  pageSize: number;
  sort: string;
  /** The server's "now" (ISO), so relative times read the same on the server and in the browser. */
  now: string;
  /** Any filter is applied (so an empty result means "no match", not "no assessments yet"). */
  filtered: boolean;
}

export function AssessmentsTable({
  items,
  total,
  page,
  pageSize,
  sort,
  now,
  filtered,
}: AssessmentsTableProps) {
  const { update } = useListUrlState();
  const columns = useMemo(() => makeColumns(now), [now]);
  const emptyState = filtered ? (
    <EmptyState
      icon={ClipboardListIcon}
      title="No assessments match"
      description="Try a different module or state, or clear the filters."
      action={
        <Button variant="outline" onClick={() => update({ moduleId: null, state: null })}>
          Clear filters
        </Button>
      }
    />
  ) : (
    <EmptyState
      icon={ClipboardListIcon}
      title="No assessments yet"
      description="Create the first assessment to set a deadline and start receiving submissions."
      action={
        <Button asChild>
          <Link href="/staff/assessments/new">
            <PlusIcon data-icon="inline-start" aria-hidden="true" />
            New assessment
          </Link>
        </Button>
      }
    />
  );

  return (
    <DataTable
      caption="Assessments"
      columns={columns}
      data={items}
      total={total}
      page={page}
      pageSize={pageSize}
      sort={sort}
      getRowId={(row) => row.id}
      emptyState={emptyState}
    />
  );
}
