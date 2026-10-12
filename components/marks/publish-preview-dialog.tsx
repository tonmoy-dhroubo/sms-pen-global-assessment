"use client";

import { Loader2Icon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Money } from "@/components/format/money";
import { ErrorState } from "@/components/shared/error-state";
import { Notice } from "@/components/shared/notice";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiRequestError } from "@/lib/client/api";
import { handleApiError } from "@/lib/client/api-errors";
import { publishMarksRequest, type PublishResponse, type PublishTarget } from "@/lib/client/marks";

// The publish preview (edge-cases.md "Bulk publish preview", DB-012; pages.md "publish (preview dialog)"). Opening it asks
// the server for a dry run of the same request, then shows what a real run would do: how many marks, which marks are
// missing, and which students owe overdue fees. Overdue fees are a warning, never a block: the staff member can still
// publish, or cancel and withhold those results instead. Confirming sends the real publish.

export interface PublishPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What to publish: an assessment, a student, or the marks picked. */
  target: PublishTarget;
  /** What the dialog is about, for its description ("Essay 1", "Ayesha Rahman"). */
  subject: string;
  /** Called after a real publish, with the server's answer. */
  onPublished?: (result: PublishResponse) => void;
}

type PreviewState =
  | { status: "loading" }
  | { status: "error"; error: ApiRequestError | null }
  | { status: "ready"; preview: PublishResponse };

/** Cap on how many names the lists show before "and N more", so a big assessment keeps the dialog readable. */
const LIST_LIMIT = 20;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function PublishPreviewDialog({
  open,
  onOpenChange,
  target,
  subject,
  onPublished,
}: PublishPreviewDialogProps) {
  // What the dry run answered for the request in `key`; anything else means "still asking".
  const [outcome, setOutcome] = useState<{ key: string; state: PreviewState } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [publishing, setPublishing] = useState(false);
  // The target is an object the parent builds on each render; its content decides when to ask again.
  const targetKey = JSON.stringify(target);
  const requestKey = `${targetKey}#${attempt}`;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    publishMarksRequest(JSON.parse(targetKey) as PublishTarget, { dryRun: true }, controller.signal)
      .then((preview) => setOutcome({ key: requestKey, state: { status: "ready", preview } }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setOutcome({
          key: requestKey,
          state: { status: "error", error: error instanceof ApiRequestError ? error : null },
        });
      });
    return () => controller.abort();
  }, [open, targetKey, requestKey]);

  const state: PreviewState =
    open && outcome?.key === requestKey ? outcome.state : { status: "loading" };

  /** Every way of closing goes through here, so the next opening starts with a fresh question. */
  function changeOpen(next: boolean) {
    if (!next) setOutcome(null);
    onOpenChange(next);
  }

  function retry() {
    setOutcome(null);
    setAttempt((count) => count + 1);
  }

  async function confirm() {
    setPublishing(true);
    try {
      const result = await publishMarksRequest(JSON.parse(targetKey) as PublishTarget, {
        dryRun: false,
      });
      toast.success(
        result.published === 0
          ? "Nothing was published: there were no draft or withheld marks."
          : `Published ${plural(result.published, "mark", "marks")}.`,
      );
      onPublished?.(result);
      changeOpen(false);
    } catch (error) {
      handleApiError(error);
    } finally {
      setPublishing(false);
    }
  }

  const preview = state.status === "ready" ? state.preview : null;

  return (
    <Dialog open={open} onOpenChange={(next) => (publishing ? undefined : changeOpen(next))}>
      <DialogContent className="sm:max-w-xl" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Publish results</DialogTitle>
          <DialogDescription>
            Check what will happen before the results for <strong>{subject}</strong> become visible
            to students.
          </DialogDescription>
        </DialogHeader>

        {state.status === "loading" ? (
          <div className="space-y-3" role="status" aria-label="Checking what would be published">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : null}

        {state.status === "error" ? (
          <ErrorState
            title="Could not check the marks"
            message={state.error?.message ?? "Something went wrong. Try again."}
            reference={state.error?.requestId}
            onRetry={retry}
          />
        ) : null}

        {preview ? (
          <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
            <p className="text-base font-medium" data-slot="publish-summary">
              {preview.summary}
            </p>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border px-3 py-2">
                <dt className="text-xs text-muted-foreground">To publish</dt>
                <dd className="text-lg font-medium tabular-nums">{preview.toPublish}</dd>
              </div>
              <div className="rounded-lg border px-3 py-2">
                <dt className="text-xs text-muted-foreground">Already published</dt>
                <dd className="text-lg font-medium tabular-nums">{preview.alreadyPublished}</dd>
              </div>
            </dl>

            {preview.overdueStudents.length > 0 ? (
              <section aria-labelledby="publish-overdue-heading" className="space-y-2">
                <Notice>
                  <h3 id="publish-overdue-heading" className="font-medium">
                    {plural(preview.overdueStudents.length, "student has", "students have")} overdue
                    fees (<Money value={preview.overdueTotal} /> in total)
                  </h3>
                  <p>
                    You can still publish. To hold a result back instead, cancel and use{" "}
                    <strong>Withhold</strong> with the reason &ldquo;Outstanding fees&rdquo;.
                  </p>
                </Notice>
                <ul className="divide-y rounded-lg border text-sm" data-slot="overdue-students">
                  {preview.overdueStudents.slice(0, LIST_LIMIT).map((entry) => (
                    <li
                      key={entry.student.id}
                      className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 bg-tone-amber/40 px-3 py-2"
                    >
                      <span className="min-w-0">
                        <Link
                          href={`/staff/students/${entry.student.id}`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {entry.student.fullName}
                        </Link>{" "}
                        <span className="font-mono text-xs text-muted-foreground">
                          {entry.student.studentNumber}
                        </span>
                      </span>
                      <span className="text-xs">
                        <Money value={entry.overdueAmount} className="font-medium" /> overdue
                        &middot; {plural(entry.marksToPublish, "mark", "marks")}
                      </span>
                    </li>
                  ))}
                </ul>
                {preview.overdueStudents.length > LIST_LIMIT ? (
                  <p className="text-xs text-muted-foreground">
                    and {preview.overdueStudents.length - LIST_LIMIT} more
                  </p>
                ) : null}
              </section>
            ) : null}

            {preview.missingMarks.length > 0 ? (
              <section aria-labelledby="publish-missing-heading" className="space-y-2">
                <h3 id="publish-missing-heading" className="text-sm font-medium">
                  {plural(preview.missingMarks.length, "mark is", "marks are")} missing
                </h3>
                <ul className="divide-y rounded-lg border text-sm" data-slot="missing-marks">
                  {preview.missingMarks.slice(0, LIST_LIMIT).map((entry) => (
                    <li
                      key={`${entry.student.id}-${entry.assessment.id}`}
                      className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 py-2"
                    >
                      <span>
                        {entry.student.fullName}{" "}
                        <span className="font-mono text-xs text-muted-foreground">
                          {entry.student.studentNumber}
                        </span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {entry.assessment.module.code} &middot; {entry.assessment.title}
                      </span>
                    </li>
                  ))}
                </ul>
                {preview.missingMarks.length > LIST_LIMIT ? (
                  <p className="text-xs text-muted-foreground">
                    and {preview.missingMarks.length - LIST_LIMIT} more
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Students without a mark are not affected by publishing.
                </p>
              </section>
            ) : null}

            {preview.toPublish === 0 ? (
              <p className="text-sm text-muted-foreground">
                There are no draft or withheld marks to publish.
              </p>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={publishing}
            onClick={() => changeOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!preview || preview.toPublish === 0 || publishing}
            onClick={confirm}
          >
            {publishing ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
            {preview && preview.toPublish > 0
              ? `Publish ${plural(preview.toPublish, "mark", "marks")}`
              : "Publish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
