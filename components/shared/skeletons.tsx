import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// Loading placeholders (pages.md: every list and panel has a skeleton). Each announces itself politely to
// assistive technology and hides the grey boxes from it.

function SkeletonRegion({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

/** A page title with a short subtitle, as shown by `PageHeader`. */
export function PageHeaderSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80 max-w-full" />
    </div>
  );
}

export function PageSkeleton({ label = "Loading page" }: { label?: string }) {
  return (
    <SkeletonRegion label={label} className="space-y-6">
      <PageHeaderSkeleton />
      <CardGridSkeletonBody count={3} />
      <TableSkeletonBody rows={5} columns={4} />
    </SkeletonRegion>
  );
}

function CardGridSkeletonBody({ count }: { count: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="space-y-3 rounded-xl border p-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-3 w-40" />
        </div>
      ))}
    </div>
  );
}

export function CardGridSkeleton({
  count = 3,
  label = "Loading",
}: {
  count?: number;
  label?: string;
}) {
  return (
    <SkeletonRegion label={label}>
      <CardGridSkeletonBody count={count} />
    </SkeletonRegion>
  );
}

function TableSkeletonBody({ rows, columns }: { rows: number; columns: number }) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="flex gap-4 border-b bg-muted/40 px-4 py-3">
        {Array.from({ length: columns }, (_, index) => (
          <Skeleton key={index} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex gap-4 border-b px-4 py-3 last:border-b-0">
          {Array.from({ length: columns }, (_, column) => (
            <Skeleton key={column} className={cn("h-4 flex-1", column === 0 && "max-w-40")} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({
  rows = 8,
  columns = 5,
  label = "Loading table",
}: {
  rows?: number;
  columns?: number;
  label?: string;
}) {
  return (
    <SkeletonRegion label={label}>
      <TableSkeletonBody rows={rows} columns={columns} />
    </SkeletonRegion>
  );
}
