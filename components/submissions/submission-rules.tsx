import { InfoIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// The submission rules in plain words (pages.md `/student/assessments`), shown above the list and on each assessment.
// The last line is the one that settles disputes about uploads that straddle a deadline (D-023).

export function SubmissionRules({ className }: { className?: string }) {
  return (
    <section
      aria-label="How submitting works"
      className={cn(
        "flex gap-3 rounded-xl border bg-card p-4 text-sm text-card-foreground",
        className,
      )}
    >
      <InfoIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 space-y-1">
        <p className="font-medium">How submitting works</p>
        <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
          <li>You can replace your file until the deadline.</li>
          <li>Uploads after the deadline are accepted but marked late.</li>
          <li>
            Submission time is when your upload finishes. Only the server&apos;s clock counts, not
            yours.
          </li>
        </ul>
      </div>
    </section>
  );
}
