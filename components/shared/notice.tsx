import { TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// An inline, non-blocking heads-up ("this is more than the balance") in the amber tone. Unlike an `Alert` it is a
// polite status message, not an assertive error, and it carries an icon as well as colour (D-017).

export function Notice({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      role="status"
      data-slot="notice"
      className={cn(
        "flex gap-2 rounded-lg bg-tone-amber px-3 py-2 text-sm text-tone-amber-foreground",
        className,
      )}
    >
      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
