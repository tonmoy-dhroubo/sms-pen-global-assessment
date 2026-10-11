"use client";

import { RotateCcwIcon, TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// A failed load, with a retry (pages.md: every list and panel has an error state with retry).

export interface ErrorStateProps {
  title?: string;
  message?: ReactNode;
  /** Shown as a "Try again" button when given. */
  onRetry?: () => void;
  /** Quote this when reporting a problem (the request id of a failed API call, or Next's error digest). */
  reference?: string | null;
  className?: string;
}

export function ErrorState({
  title = "Something went wrong",
  message = "We could not load this. Try again in a moment.",
  onRetry,
  reference,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      data-slot="error-state"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-destructive/30 px-6 py-12 text-center",
        className,
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <TriangleAlertIcon className="size-5" aria-hidden="true" />
      </div>
      <div className="max-w-md space-y-1">
        <h2 className="text-base font-medium">{title}</h2>
        <p className="text-sm text-muted-foreground">{message}</p>
        {reference ? (
          <p className="font-mono text-xs text-muted-foreground">Reference: {reference}</p>
        ) : null}
      </div>
      {onRetry ? (
        <Button variant="outline" onClick={onRetry}>
          <RotateCcwIcon data-icon="inline-start" aria-hidden="true" />
          Try again
        </Button>
      ) : null}
    </div>
  );
}
