"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { PlusIcon, UsersIcon } from "lucide-react";
import Link from "next/link";
import { DataTable, useListUrlState } from "@/components/data-table/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { FeeStatus } from "@/components/students/fee-status";
import { Button } from "@/components/ui/button";
import type { StudentListItem } from "@/lib/services/students";

// The student list table (pages.md `/staff/students`): server-side paging and sorting through DataTable, a link to the
// record on the Student ID and the name, and each student's enrolment and fee badges. Below the xl breakpoint the
// Session, Year, Status and Fees columns are replaced by the badges under the name, so nothing scrolls out of view.

const COLUMNS: ColumnDef<StudentListItem, unknown>[] = [
  {
    id: "studentNumber",
    header: "Student ID",
    enableSorting: true,
    cell: ({ row }) => (
      <Link
        href={`/staff/students/${row.original.id}`}
        className="font-mono text-sm underline-offset-4 hover:underline"
      >
        {row.original.studentNumber}
      </Link>
    ),
  },
  {
    id: "fullName",
    header: "Name",
    enableSorting: true,
    cell: ({ row }) => (
      <div className="min-w-40">
        <Link
          href={`/staff/students/${row.original.id}`}
          className="font-medium underline-offset-4 hover:underline"
        >
          {row.original.fullName}
        </Link>
        <div className="truncate text-xs text-muted-foreground">{row.original.email}</div>
        {/* Below the widest layout the Status and Fees columns are folded in here, so the fee badge never scrolls out of view. */}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 xl:hidden">
          <span className="text-xs text-muted-foreground sm:hidden">
            {row.original.programme.code}
          </span>
          <StatusBadge group="enrolment" value={row.original.status} />
          <FeeStatus summary={row.original.feeSummary} />
        </div>
      </div>
    ),
  },
  {
    id: "programme",
    header: "Programme",
    enableSorting: true,
    meta: { className: "max-sm:hidden" },
    cell: ({ row }) => (
      <span title={row.original.programme.name}>{row.original.programme.code}</span>
    ),
  },
  {
    id: "academicYear",
    header: "Session",
    enableSorting: true,
    meta: { className: "max-xl:hidden" },
    cell: ({ row }) => <span className="tabular-nums">{row.original.academicYear}</span>,
  },
  {
    id: "yearOfStudy",
    header: "Year",
    enableSorting: true,
    meta: { className: "max-xl:hidden" },
    cell: ({ row }) => <span className="tabular-nums">{row.original.yearOfStudy}</span>,
  },
  {
    id: "status",
    header: "Status",
    enableSorting: true,
    meta: { className: "max-xl:hidden" },
    cell: ({ row }) => <StatusBadge group="enrolment" value={row.original.status} />,
  },
  {
    id: "fees",
    header: "Fees",
    meta: { className: "max-xl:hidden" },
    cell: ({ row }) => <FeeStatus summary={row.original.feeSummary} />,
  },
];

export interface StudentsTableProps {
  items: StudentListItem[];
  total: number;
  page: number;
  pageSize: number;
  sort: string;
  /** Any search or filter is applied (so an empty result means "no match", not "no students"). */
  filtered: boolean;
}

export function StudentsTable({
  items,
  total,
  page,
  pageSize,
  sort,
  filtered,
}: StudentsTableProps) {
  const { update } = useListUrlState();
  const emptyState = filtered ? (
    <EmptyState
      icon={UsersIcon}
      title="No students match"
      description="Try a different search, or remove a filter. Withdrawn and completed students are hidden unless you include them."
      action={
        <Button
          variant="outline"
          onClick={() =>
            update({
              q: null,
              programmeId: null,
              status: [],
              academicYear: null,
              yearOfStudy: null,
              feeState: null,
            })
          }
        >
          Clear search and filters
        </Button>
      }
    />
  ) : (
    <EmptyState
      icon={UsersIcon}
      title="No enrolled students yet"
      description="Enrol a student to start the register. Withdrawn and completed students are hidden by default."
      action={
        <Button asChild>
          <Link href="/staff/students/new">
            <PlusIcon data-icon="inline-start" aria-hidden="true" />
            New student
          </Link>
        </Button>
      }
    />
  );

  return (
    <DataTable
      caption="Students"
      columns={COLUMNS}
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
