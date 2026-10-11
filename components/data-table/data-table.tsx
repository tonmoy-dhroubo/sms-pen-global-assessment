"use client";

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type Updater,
} from "@tanstack/react-table";
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition, type ReactNode } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  PAGE_SIZE_OPTIONS,
  formatSort,
  pageCount,
  parseSort,
  toQueryString,
  withParams,
  type ParamUpdates,
} from "@/lib/list-params";
import { cn } from "@/lib/utils";

// The base table for every list (D-016, tech-stack.md "Tables"): TanStack Table for the column model, with paging
// and sorting done by the server. The current page, page size and sort live in the URL (`?page=2&sort=-fullName`),
// so a list can be shared, bookmarked and reloaded; the page that renders the table reads the same params with
// `parseListParams` and fetches that slice. Filters on the same page keep their own params; changing any of them
// should go through `useListUrlState().update` so the page resets to 1.

export interface DataTableProps<TData> {
  /** Give a sortable column an `id` equal to the API's sort field and `enableSorting: true`. */
  columns: ColumnDef<TData, unknown>[];
  /** The rows of the current page. */
  data: TData[];
  /** Rows across all pages. */
  total: number;
  page: number;
  pageSize: number;
  /** The current sort in API form (`field` or `-field`). */
  sort?: string | null;
  /** Names the table for assistive technology. */
  caption: string;
  getRowId?: (row: TData, index: number) => string;
  /** Shown instead of the table when `total` is 0. */
  emptyState?: ReactNode;
  className?: string;
}

/** Reads and writes the list state in the URL. Updating anything but `page` sends the table back to page 1. */
export function useListUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function update(updates: ParamUpdates) {
    const resetsPage = !("page" in updates);
    const next = withParams(searchParams, resetsPage ? { ...updates, page: null } : updates);
    startTransition(() => {
      router.push(`${pathname}${toQueryString(next)}`, { scroll: false });
    });
  }

  return { update, isPending };
}

export function DataTable<TData>({
  columns,
  data,
  total,
  page,
  pageSize,
  sort,
  caption,
  getRowId,
  emptyState,
  className,
}: DataTableProps<TData>) {
  const { update, isPending } = useListUrlState();
  const sortSpec = parseSort(sort);
  const sorting: SortingState = sortSpec
    ? [{ id: sortSpec.field, desc: sortSpec.direction === "desc" }]
    : [];
  const pages = pageCount(total, pageSize);

  function onSortingChange(updater: Updater<SortingState>) {
    const next = typeof updater === "function" ? updater(sorting) : updater;
    const first = next[0];
    update({
      sort: first ? formatSort({ field: first.id, direction: first.desc ? "desc" : "asc" }) : null,
    });
  }

  // TanStack Table returns functions that React Compiler cannot memoise; this component does not rely on that.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    pageCount: pages,
    state: { sorting },
    onSortingChange,
    enableMultiSort: false,
    // Sorting is opt-in per column, because the server only sorts by fields it knows.
    defaultColumn: { enableSorting: false },
  });

  if (total === 0) {
    return (
      <div className={className}>
        {emptyState ?? (
          <EmptyState title="Nothing to show" description="There are no rows to display." />
        )}
      </div>
    );
  }

  // A page number beyond the last page (an old bookmark, or rows deleted meanwhile).
  if (data.length === 0) {
    return (
      <div className={className}>
        <EmptyState
          title="No rows on this page"
          description={`There are ${total} rows in total, but none on page ${page}.`}
          action={<Button onClick={() => update({ page: 1 })}>Go to the first page</Button>}
        />
      </div>
    );
  }

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div className={cn("space-y-3", className)} aria-busy={isPending}>
      <div
        className={cn(
          "overflow-x-auto rounded-xl border transition-opacity",
          isPending && "opacity-60",
        )}
      >
        <Table>
          <caption className="sr-only">{caption}</caption>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const column = header.column;
                  const direction = column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      scope="col"
                      aria-sort={
                        direction === "asc"
                          ? "ascending"
                          : direction === "desc"
                            ? "descending"
                            : undefined
                      }
                    >
                      {header.isPlaceholder ? null : column.getCanSort() ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="-ml-2.5 h-8"
                          onClick={column.getToggleSortingHandler()}
                        >
                          {flexRender(column.columnDef.header, header.getContext())}
                          {direction === "asc" ? (
                            <ArrowUpIcon aria-hidden="true" />
                          ) : direction === "desc" ? (
                            <ArrowDownIcon aria-hidden="true" />
                          ) : (
                            <ArrowUpDownIcon className="opacity-50" aria-hidden="true" />
                          )}
                          <span className="sr-only">
                            {direction === "asc"
                              ? ", sorted ascending. Activate to sort descending."
                              : direction === "desc"
                                ? ", sorted descending. Activate to clear sorting."
                                : ", not sorted. Activate to sort ascending."}
                          </span>
                        </Button>
                      ) : (
                        flexRender(column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <nav
        aria-label="Pagination"
        className="flex flex-col items-center justify-between gap-3 text-sm sm:flex-row"
      >
        <p className="text-muted-foreground" aria-live="polite">
          Showing {first}&ndash;{last} of {total}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <div className="flex items-center gap-2">
            <span id="rows-per-page-label" className="text-muted-foreground">
              Rows per page
            </span>
            <Select value={String(pageSize)} onValueChange={(value) => update({ pageSize: value })}>
              <SelectTrigger size="sm" aria-labelledby="rows-per-page-label" className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              aria-label="Previous page"
              onClick={() => update({ page: page - 1 })}
            >
              <ChevronLeftIcon data-icon="inline-start" aria-hidden="true" />
              <span className="max-sm:hidden">Previous</span>
            </Button>
            <span className="text-muted-foreground tabular-nums">
              Page {page} of {pages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pages}
              aria-label="Next page"
              onClick={() => update({ page: page + 1 })}
            >
              <span className="max-sm:hidden">Next</span>
              <ChevronRightIcon data-icon="inline-end" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </nav>
    </div>
  );
}
