"use client";

import { ErrorState } from "@/components/shared/error-state";

// Last-resort boundary for anything that throws while rendering a page. `reset` re-renders the segment.
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main-content" className="mx-auto w-full max-w-2xl flex-1 p-4 md:p-6">
      <ErrorState onRetry={reset} reference={error.digest} />
    </main>
  );
}
