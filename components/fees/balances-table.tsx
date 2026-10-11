"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { WalletIcon } from "lucide-react";
import Link from "next/link";
import { DataTable, useListUrlState } from "@/components/data-table/data-table";
import { DateTime } from "@/components/format/date-time";
import { Money } from "@/components/format/money";
import { RecordPaymentDialog } from "@/components/fees/record-payment-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import type { BalanceItem } from "@/lib/services/fees";

// The fees overview table (pages.md `/staff/fees`): every student with a balance, whatever their enrolment status (a
// withdrawn student who still owes money stays on it), with overdue amount, how long, the last payment, and Record
// payment. Sorting and paging are on the server through DataTable; sortable columns use the API's sort field names.

function days(count: number): string {
  return `${count} ${count === 1 ? "day" : "days"}`;
}

const COLUMNS: ColumnDef<BalanceItem, unknown>[] = [
  {
    id: "fullName",
    header: "Student",
    enableSorting: true,
    cell: ({ row }) => (
      <div className="min-w-40">
        <Link
          href={`/staff/students/${row.original.id}`}
          className="font-medium underline-offset-4 hover:underline"
        >
          {row.original.fullName}
        </Link>
        <div className="text-xs text-muted-foreground">
          <span className="font-mono">{row.original.studentNumber}</span>
          <span title={row.original.programme.name}> &middot; {row.original.programme.code}</span>
        </div>
      </div>
    ),
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge group="enrolment" value={row.original.status} />,
  },
  {
    id: "fees",
    header: "Fees",
    cell: ({ row }) => <StatusBadge group="fees" value={row.original.feeSummary.feeState} />,
  },
  {
    id: "balance",
    header: () => <span className="block text-right">Balance</span>,
    cell: ({ row }) => {
      const { feeState, balance, credit } = row.original.feeSummary;
      return (
        <div className="text-right">
          {feeState === "credit" ? (
            <>
              <Money value={credit} />
              <span className="block text-xs text-muted-foreground">credit</span>
            </>
          ) : (
            <Money value={balance} />
          )}
        </div>
      );
    },
  },
  {
    id: "overdueAmount",
    header: () => <span className="block text-right">Overdue</span>,
    enableSorting: true,
    cell: ({ row }) => (
      <div className="text-right">
        {row.original.feeSummary.feeState === "overdue" ? (
          <Money value={row.original.feeSummary.overdueAmount} />
        ) : (
          <span className="text-muted-foreground">&mdash;</span>
        )}
      </div>
    ),
  },
  {
    id: "oldestOverdueDays",
    header: "Overdue for",
    enableSorting: true,
    cell: ({ row }) => {
      const { oldestOverdueDays, ageingBucket } = row.original.feeSummary;
      return oldestOverdueDays === null ? (
        <span className="text-muted-foreground">&mdash;</span>
      ) : (
        <>
          <span className="tabular-nums">{days(oldestOverdueDays)}</span>
          {ageingBucket ? (
            <span className="block text-xs text-muted-foreground">{ageingBucket} days</span>
          ) : null}
        </>
      );
    },
  },
  {
    id: "lastPayment",
    header: "Last payment",
    cell: ({ row }) =>
      row.original.lastPayment ? (
        <>
          <DateTime value={row.original.lastPayment.paidAt} />
          <span className="block text-xs text-muted-foreground">
            <Money value={row.original.lastPayment.amount} />
          </span>
        </>
      ) : (
        <span className="text-muted-foreground">None yet</span>
      ),
  },
  {
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => (
      <RecordPaymentDialog
        studentId={row.original.id}
        studentName={row.original.fullName}
        balance={row.original.feeSummary.balance}
        triggerVariant="outline"
        triggerSize="sm"
      />
    ),
  },
];

export interface BalancesTableProps {
  items: BalanceItem[];
  total: number;
  page: number;
  pageSize: number;
  sort: string;
  /** Any filter is applied (so an empty result means "no match", not "nobody owes anything"). */
  filtered: boolean;
}

export function BalancesTable({
  items,
  total,
  page,
  pageSize,
  sort,
  filtered,
}: BalancesTableProps) {
  const { update } = useListUrlState();
  const emptyState = filtered ? (
    <EmptyState
      icon={WalletIcon}
      title="No students match"
      description="Try a different fee state or ageing bucket, or clear the filters."
      action={
        <Button
          variant="outline"
          onClick={() => update({ feeState: null, ageingBucket: null, programmeId: null })}
        >
          Clear filters
        </Button>
      }
    />
  ) : (
    <EmptyState
      icon={WalletIcon}
      title="Nobody has a balance"
      description="Every student is paid up. Students appear here when they owe money or hold a credit."
    />
  );

  return (
    <DataTable
      caption="Students with a balance"
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
