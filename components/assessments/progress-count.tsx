import { cn } from "@/lib/utils";

// "9 of 14 marked" with a thin bar, for the marking and release progress columns. The text carries the meaning; the
// bar is decoration (hidden from assistive technology).

export interface ProgressCountProps {
  done: number;
  total: number;
  /** The word after the numbers: "marked", "published". */
  label: string;
  className?: string;
}

export function ProgressCount({ done, total, label, className }: ProgressCountProps) {
  if (total === 0) return <span className="text-muted-foreground">&mdash;</span>;
  const percent = Math.min(100, Math.round((done / total) * 100));
  return (
    <div className={cn("min-w-28 space-y-1", className)}>
      <div className="text-sm tabular-nums">
        {done} of {total} <span className="text-muted-foreground">{label}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-full rounded-full bg-[var(--brand)]" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
