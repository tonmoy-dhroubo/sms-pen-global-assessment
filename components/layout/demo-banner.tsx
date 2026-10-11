import { FlaskConicalIcon } from "lucide-react";

// The hosted demo's warning strip (D-014). `show` comes from the server's `DEMO_MODE` (lib/env is server-only, so the
// layout reads it and passes the boolean down).

export function DemoBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div
      role="region"
      aria-label="Demo environment"
      className="flex items-center justify-center gap-2 bg-tone-amber px-4 py-1.5 text-center text-xs font-medium text-tone-amber-foreground"
    >
      <FlaskConicalIcon className="size-3.5 shrink-0" aria-hidden="true" />
      <span>
        Demo environment: anyone with the link can switch roles, and the data can be reset at any
        time.
      </span>
    </div>
  );
}
