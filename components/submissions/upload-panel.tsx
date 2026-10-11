"use client";

import { Loader2Icon, UploadIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Notice } from "@/components/shared/notice";
import { ReceiptCard } from "@/components/submissions/receipt-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiRequestError } from "@/lib/client/api";
import {
  StorageUploadError,
  confirmUploadRequest,
  requestUploadUrl,
  uploadToStorage,
} from "@/lib/client/submissions";
import type { Receipt } from "@/lib/client/submissions";
import type { MyCanUpload } from "@/lib/services/submissions";
import {
  UPLOAD_MIME_TYPES,
  checkUploadFile,
  cleanFileName,
  formatLimit,
  uploadExtensionOf,
} from "@/lib/validation/submissions";

// Upload, replace and the receipt (pages.md `/student/assessments/[id]`). Three steps, as the API describes (D-013):
// ask for an upload URL, PUT the file straight to storage with progress, then confirm. The checks done here (type, size)
// only save a round trip; the server repeats them and looks inside the file, so it stays the authority. When uploads are
// not allowed the button is disabled and the reason is written out beside it.

type Phase = "idle" | "preparing" | "uploading" | "confirming";

export interface UploadPanelProps {
  assessmentId: string;
  canUpload: MyCanUpload;
  /** The student already has a file, so this replaces it. */
  hasSubmission: boolean;
  /** `MAX_UPLOAD_MB` in bytes, from the server. */
  maxBytes: number;
}

const ACCEPT = `.pdf,.docx,${UPLOAD_MIME_TYPES.pdf},${UPLOAD_MIME_TYPES.docx}`;

/** The first thing worth showing from a failed call: a field message if the server sent one, else its message. */
function messageFor(error: unknown): string {
  if (error instanceof ApiRequestError) {
    const first = Object.values(error.fieldErrors)[0]?.[0] ?? error.formErrors[0];
    return first ?? error.message;
  }
  if (error instanceof StorageUploadError) return error.message;
  return "Something went wrong. Try again.";
}

export function UploadPanel({
  assessmentId,
  canUpload,
  hasSubmission,
  maxBytes,
}: UploadPanelProps) {
  const router = useRouter();
  const inputId = useId();
  const hintId = useId();
  const reasonId = useId();
  const errorId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const busy = phase !== "idle";
  const allowed = canUpload.allowed;
  const actionLabel = hasSubmission ? "Upload replacement" : "Upload";

  function choose(chosen: File | null) {
    setReceipt(null);
    setError(null);
    setFile(chosen);
    setProblem(chosen ? checkUploadFile(chosen, maxBytes) : null);
  }

  async function confirmWithRetry(pendingUploadId: string): Promise<Receipt> {
    // Confirm is idempotent, so a dropped connection is simply retried.
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await confirmUploadRequest(assessmentId, pendingUploadId);
      } catch (caught) {
        const dropped = caught instanceof ApiRequestError && caught.code === "NETWORK_ERROR";
        if (!dropped || attempt >= 3) throw caught;
      }
    }
  }

  async function upload() {
    if (!file || problem || busy || !allowed) return;
    const controller = new AbortController();
    abort.current = controller;
    setError(null);
    setReceipt(null);
    setPercent(0);
    try {
      setPhase("preparing");
      const fileName = cleanFileName(file.name);
      const extension = uploadExtensionOf(fileName)!; // checked by `checkUploadFile`
      const issued = await requestUploadUrl(
        assessmentId,
        { fileName, contentType: UPLOAD_MIME_TYPES[extension], sizeBytes: file.size },
        controller.signal,
      );

      setPhase("uploading");
      await uploadToStorage({
        url: issued.uploadUrl,
        headers: issued.headers,
        file,
        onProgress: setPercent,
        signal: controller.signal,
      });

      setPhase("confirming");
      const confirmed = await confirmWithRetry(issued.pendingUploadId);

      setReceipt(confirmed);
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      toast.success(
        confirmed.late ? "File received. It is marked late." : "File received on time.",
      );
      router.refresh(); // the history and the page's status come from the server
    } catch (caught) {
      if (caught instanceof StorageUploadError && caught.kind === "aborted") {
        toast.info("Upload cancelled.");
      } else if (caught instanceof DOMException && caught.name === "AbortError") {
        toast.info("Upload cancelled.");
      } else {
        setError(messageFor(caught));
        // A rule changed under the student (closed, locked): show the page's new state and reason.
        if (caught instanceof ApiRequestError && caught.code === "BUSINESS_RULE") router.refresh();
      }
    } finally {
      abort.current = null;
      setPhase("idle");
    }
  }

  const status =
    phase === "preparing"
      ? "Getting ready..."
      : phase === "uploading"
        ? `Uploading... ${percent}%`
        : phase === "confirming"
          ? "Checking your file..."
          : null;

  return (
    <div className="space-y-4" data-slot="upload-panel">
      {!allowed ? (
        <div className="space-y-3">
          <Button type="button" disabled aria-describedby={reasonId}>
            <UploadIcon data-icon="inline-start" aria-hidden="true" />
            {actionLabel}
          </Button>
          <p
            id={reasonId}
            className="text-sm text-foreground"
            data-slot="upload-blocked-reason"
            data-reason={canUpload.reason ?? undefined}
          >
            {canUpload.message}
          </p>
        </div>
      ) : (
        <>
          {canUpload.late ? (
            <Notice>
              The deadline has passed. A file uploaded now is accepted but marked late.
            </Notice>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor={inputId}>
              {hasSubmission ? "Choose a replacement file" : "Choose your file"}
            </Label>
            <Input
              ref={fileInput}
              id={inputId}
              type="file"
              accept={ACCEPT}
              disabled={busy}
              aria-describedby={`${hintId}${problem ? ` ${errorId}` : ""}`}
              aria-invalid={problem ? true : undefined}
              onChange={(event) => choose(event.currentTarget.files?.[0] ?? null)}
            />
            <p id={hintId} className="text-xs text-muted-foreground">
              PDF or Word (.docx), up to {formatLimit(maxBytes)}. Macro-enabled files are not
              accepted.
            </p>
            {problem ? (
              <p id={errorId} role="alert" className="text-sm text-destructive">
                {problem}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={upload} disabled={!file || problem !== null || busy}>
              {busy ? (
                <Loader2Icon className="animate-spin" aria-hidden="true" />
              ) : (
                <UploadIcon data-icon="inline-start" aria-hidden="true" />
              )}
              {actionLabel}
            </Button>
            {phase === "preparing" || phase === "uploading" ? (
              <Button type="button" variant="ghost" onClick={() => abort.current?.abort()}>
                <XIcon data-icon="inline-start" aria-hidden="true" />
                Cancel
              </Button>
            ) : null}
          </div>

          <p className="text-sm text-muted-foreground">
            Submission time is when your upload finishes, not when you start it.
          </p>
        </>
      )}

      {busy ? (
        <div className="space-y-1.5" aria-live="polite">
          <div
            role="progressbar"
            aria-label="Upload progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={phase === "uploading" ? percent : phase === "confirming" ? 100 : 0}
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full bg-primary transition-[width]"
              style={{
                width: `${phase === "uploading" ? percent : phase === "confirming" ? 100 : 0}%`,
              }}
            />
          </div>
          <p className="text-sm text-muted-foreground">{status}</p>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive" data-slot="upload-error">
          {error}
        </p>
      ) : null}

      {receipt ? (
        <ReceiptCard
          receipt={receipt}
          title="Upload received"
          celebrate
          className="border-tone-green-foreground/30"
        />
      ) : null}
    </div>
  );
}
