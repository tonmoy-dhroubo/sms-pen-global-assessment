"use client";

import { InboxIcon, Loader2Icon, SendIcon, EyeOffIcon, UndoIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ClassificationBadge } from "@/components/marks/classification-badge";
import { PublishPreviewDialog } from "@/components/marks/publish-preview-dialog";
import { ExportCsvButton } from "@/components/shared/export-csv-button";
import { ReasonDialog } from "@/components/dialogs/reason-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiRequestError } from "@/lib/client/api";
import { handleApiError } from "@/lib/client/api-errors";
import {
  fetchMarksheet,
  putMarkRequest,
  unpublishMarksRequest,
  withholdMarksRequest,
  type MarkDto,
  type Marksheet,
  type PutMarkBody,
} from "@/lib/client/marks";
import type { MarksheetRow } from "@/lib/services/marks";
import { classify, validateMark } from "@/lib/services/rules/marks";
import type { Classification } from "@/lib/services/rules/types";
import { parseMarkText } from "@/lib/validation/marks";
import { cn } from "@/lib/utils";

// The Marksheet tab of an assessment (pages.md `/staff/assessments/[id]`): one row per student on the marksheet with
// their submission status (late is visible while marking, no automatic penalty), a mark box (0-100, one decimal; type
// NS or press the NS button for a non-submission), the classification as you type, the release status, and a save
// state for the row.
//
//   - Saving is per row: a changed mark is sent when the box loses focus or Enter is pressed. A published mark first
//     asks for a reason (it stays published, and the change is recorded). A row keeps the `version` it read, so a
//     colleague's edit shows up as "changed by someone else" instead of being overwritten.
//   - Keyboard: Enter saves and moves to the next row's box (Shift+Enter: the previous one), as do the arrow keys;
//     Escape puts back the saved value. Tab keeps its normal order (box, NS button, next row) so every control stays
//     reachable.
//   - Rows with a mark can be ticked for "Withhold selected" and "Unpublish selected"; "Publish..." works on the whole
//     assessment through the preview dialog.
//   - Leaving with unsaved changes (closing the tab, or following a link) asks first.

type SaveState = "idle" | "saving" | "saved" | "error";

interface RowState {
  server: MarksheetRow;
  /** What is typed in the box: "", a mark such as "67.5", or "NS". */
  input: string;
  save: SaveState;
  error: string | null;
  /** The last save lost to someone else's change: offer a reload. */
  conflict: boolean;
}

/** The text the box shows for a stored mark. */
function textFor(row: MarksheetRow): string {
  if (row.isNonSubmission) return "NS";
  return row.mark ?? "";
}

function toRowState(server: MarksheetRow): RowState {
  return { server, input: textFor(server), save: "idle", error: null, conflict: false };
}

/** Whether what is typed differs from what is stored (both normalised, so "67.50" equals "67.5"). */
function differsFromStored(row: RowState): boolean {
  const parsed = parseMarkText(row.input);
  switch (parsed.kind) {
    case "empty":
      return row.server.markId !== null;
    case "invalid":
      return true;
    case "ns":
      return !row.server.isNonSubmission;
    case "mark": {
      const stored = row.server.mark;
      return (
        row.server.isNonSubmission || stored === null || Number(stored) !== Number(parsed.value)
      );
    }
  }
}

/** The classification of what is typed, live; `null` while the box is empty or not a valid mark. */
function liveClassification(
  input: string,
): { classification: Classification; isNonSubmission: boolean } | null {
  const parsed = parseMarkText(input);
  if (parsed.kind === "ns") return { classification: "FAIL", isNonSubmission: true };
  if (parsed.kind !== "mark") return null;
  const checked = validateMark(parsed.value);
  if (!checked.ok) return null;
  return {
    classification: classify({ mark: checked.value, isNonSubmission: false }),
    isNonSubmission: false,
  };
}

function patchFromDto(server: MarksheetRow, dto: MarkDto): MarksheetRow {
  return {
    ...server,
    markId: dto.markId,
    mark: dto.mark,
    isNonSubmission: dto.isNonSubmission,
    classification: dto.classification,
    releaseStatus: dto.releaseStatus,
    withheldReason: dto.withheldReason,
    publishedAt: dto.publishedAt,
    version: dto.version,
    updatedAt: dto.updatedAt,
  };
}

function summarise(rows: readonly RowState[]) {
  const summary = { entered: 0, missing: 0, draft: 0, published: 0, withheld: 0 };
  for (const { server } of rows) {
    if (!server.releaseStatus) {
      summary.missing += 1;
      continue;
    }
    summary.entered += 1;
    if (server.releaseStatus === "DRAFT") summary.draft += 1;
    else if (server.releaseStatus === "PUBLISHED") summary.published += 1;
    else summary.withheld += 1;
  }
  return summary;
}

interface PendingReason {
  studentId: string;
  body: PutMarkBody;
  from: string | null;
  to: string;
}

export interface MarksheetGridProps {
  assessmentId: string;
  assessmentTitle: string;
  initial: Marksheet;
}

export function MarksheetGrid({ assessmentId, assessmentTitle, initial }: MarksheetGridProps) {
  const router = useRouter();
  const [rows, setRows] = useState<RowState[]>(() => initial.items.map(toRowState));
  const rowsRef = useRef(rows);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [dialog, setDialog] = useState<"publish" | "withhold" | "unpublish" | null>(null);
  const [pending, setPending] = useState<PendingReason | null>(null);
  const pendingRef = useRef<PendingReason | null>(null);

  const commitRef = useRef<(studentId: string) => Promise<void>>(async () => {});
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const inflight = useRef(new Set<string>());
  const queued = useRef(new Set<string>());
  const savedTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectAll = useRef<HTMLInputElement>(null);

  const apply = useCallback((update: (current: RowState[]) => RowState[]) => {
    const next = update(rowsRef.current);
    rowsRef.current = next;
    setRows(next);
  }, []);

  const patchRow = useCallback(
    (studentId: string, change: (row: RowState) => RowState) => {
      apply((current) =>
        current.map((row) => (row.server.student.id === studentId ? change(row) : row)),
      );
    },
    [apply],
  );

  // The page's header figures come from the server; ask for them again a moment after the last change.
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 800);
  }, [router]);

  useEffect(() => {
    const timers = savedTimers.current;
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, []);

  // --- Unsaved changes ------------------------------------------------------------------------------------------

  const unsaved = rows.some(
    (row) => row.save === "saving" || row.save === "error" || differsFromStored(row),
  );
  const unsavedRef = useRef(unsaved);
  useEffect(() => {
    unsavedRef.current = unsaved;
  }, [unsaved]);

  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      if (!unsavedRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    }
    // In-app links do not unload the page, so ask before following one.
    function onLinkClick(event: MouseEvent) {
      if (!unsavedRef.current || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!anchor || anchor.getAttribute("target") === "_blank") return;
      const href = anchor.getAttribute("href") ?? "";
      if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      if (!window.confirm("You have marks that are not saved. Leave this page anyway?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onLinkClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onLinkClick, true);
    };
  }, []);

  // --- Saving ---------------------------------------------------------------------------------------------------

  const send = useCallback(
    async (studentId: string, body: PutMarkBody, reason?: string): Promise<void> => {
      const row = rowsRef.current.find((r) => r.server.student.id === studentId);
      if (!row) return;
      inflight.current.add(studentId);
      patchRow(studentId, (r) => ({ ...r, save: "saving", error: null, conflict: false }));
      try {
        const dto = await putMarkRequest(assessmentId, studentId, {
          ...body,
          ...(row.server.version !== null ? { version: row.server.version } : {}),
          ...(reason ? { reason } : {}),
        });
        patchRow(studentId, (r) => {
          const server = patchFromDto(r.server, dto);
          // Keep what is typed if the person carried on typing while this was saving.
          const stillTyping = r.input !== textForBody(body) && differsFromStored({ ...r, server });
          return {
            ...r,
            server,
            input: stillTyping ? r.input : textFor(server),
            save: "saved",
            error: null,
          };
        });
        const timer = setTimeout(() => {
          patchRow(studentId, (r) => (r.save === "saved" ? { ...r, save: "idle" } : r));
        }, 2500);
        const old = savedTimers.current.get(studentId);
        if (old) clearTimeout(old);
        savedTimers.current.set(studentId, timer);
        scheduleRefresh();
      } catch (error) {
        const conflict = error instanceof ApiRequestError && error.code === "VERSION_CONFLICT";
        const message = errorMessage(error);
        patchRow(studentId, (r) => ({ ...r, save: "error", error: message, conflict }));
        throw error;
      } finally {
        inflight.current.delete(studentId);
        if (queued.current.delete(studentId)) void commitRef.current(studentId);
      }
    },
    [assessmentId, patchRow, scheduleRefresh],
  );

  /** Sends the row's typed mark if it changed (asking for a reason first when the mark is published). */
  const commit = useCallback(
    async (studentId: string) => {
      const row = rowsRef.current.find((r) => r.server.student.id === studentId);
      if (!row || pendingRef.current?.studentId === studentId) return;
      if (inflight.current.has(studentId)) {
        queued.current.add(studentId);
        return;
      }

      const parsed = parseMarkText(row.input);
      if (parsed.kind === "invalid") {
        patchRow(studentId, (r) => ({
          ...r,
          save: "error",
          error: parsed.message,
          conflict: false,
        }));
        return;
      }
      if (parsed.kind === "empty") {
        if (row.server.markId !== null) {
          // A saved mark is never removed (DB-005): put it back and say so.
          patchRow(studentId, (r) => ({
            ...r,
            input: textFor(r.server),
            save: "error",
            error: "A saved mark cannot be cleared. Enter a new mark, or NS.",
            conflict: false,
          }));
        }
        return;
      }
      if (!differsFromStored(row)) {
        if (row.save === "error" && !row.conflict) {
          patchRow(studentId, (r) => ({ ...r, save: "idle", error: null }));
        }
        return;
      }

      const body: PutMarkBody =
        parsed.kind === "ns" ? { isNonSubmission: true } : { mark: parsed.value };
      if (row.server.releaseStatus === "PUBLISHED") {
        const request: PendingReason = {
          studentId,
          body,
          from: row.server.isNonSubmission ? "NS" : row.server.mark,
          to: parsed.kind === "ns" ? "NS" : parsed.value,
        };
        pendingRef.current = request;
        setPending(request);
        return;
      }
      try {
        await send(studentId, body);
      } catch {
        // The row already shows the problem.
      }
    },
    [patchRow, send],
  );
  useEffect(() => {
    commitRef.current = commit;
  }, [commit]);

  function setInput(studentId: string, value: string) {
    patchRow(studentId, (row) => ({
      ...row,
      input: value,
      // Typing again clears an old error, but a lost-update stays until the row is reloaded.
      save: row.conflict ? row.save : row.save === "saving" ? "saving" : "idle",
      error: row.conflict ? row.error : null,
    }));
  }

  function revert(studentId: string) {
    patchRow(studentId, (row) => ({
      ...row,
      input: textFor(row.server),
      save: row.conflict ? row.save : "idle",
      error: row.conflict ? row.error : null,
    }));
  }

  function focusRow(studentId: string, offset: number) {
    const order = rowsRef.current.map((r) => r.server.student.id);
    const target = order[order.indexOf(studentId) + offset];
    if (target) {
      const element = inputs.current.get(target);
      element?.focus();
      element?.select();
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>, studentId: string) {
    if (event.nativeEvent.isComposing) return;
    switch (event.key) {
      case "Enter":
        event.preventDefault();
        void commit(studentId);
        focusRow(studentId, event.shiftKey ? -1 : 1);
        break;
      case "ArrowDown":
        event.preventDefault();
        focusRow(studentId, 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusRow(studentId, -1);
        break;
      case "Escape":
        revert(studentId);
        break;
    }
  }

  function toggleNs(studentId: string) {
    const row = rowsRef.current.find((r) => r.server.student.id === studentId);
    if (!row) return;
    const isNs = parseMarkText(row.input).kind === "ns";
    if (isNs) {
      // Back to a mark: show the stored mark (empty when the stored result is itself NS) and let the person type.
      setInput(studentId, row.server.isNonSubmission ? "" : (row.server.mark ?? ""));
      inputs.current.get(studentId)?.focus();
    } else {
      setInput(studentId, "NS");
      void commit(studentId); // the row ref already holds "NS"
    }
  }

  async function reload(studentId?: string) {
    try {
      const fresh = await fetchMarksheet(assessmentId);
      apply((current) => {
        const known = new Map(current.map((row) => [row.server.student.id, row]));
        return fresh.items.map((server) => {
          const row = known.get(server.student.id);
          if (!row) return toRowState(server);
          // A row being typed in keeps the text, but now knows the stored state, so saving it is a fresh choice.
          const keepTyping = differsFromStored(row) && row.save !== "saving";
          if (keepTyping && server.student.id !== studentId) return { ...row, server };
          if (keepTyping) return { ...row, server, save: "idle", error: null, conflict: false };
          return toRowState(server);
        });
      });
    } catch (error) {
      handleApiError(error);
    }
  }

  // --- Selection -------------------------------------------------------------------------------------------------

  const selectable = useMemo(
    () => rows.map((r) => r.server.markId).filter((id): id is string => id !== null),
    [rows],
  );
  const selectedIds = useMemo(
    () => selectable.filter((id) => selected.has(id)),
    [selectable, selected],
  );

  useEffect(() => {
    if (selectAll.current) {
      selectAll.current.indeterminate =
        selectedIds.length > 0 && selectedIds.length < selectable.length;
    }
  }, [selectedIds.length, selectable.length]);

  function toggleSelected(markId: string, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(markId);
      else next.delete(markId);
      return next;
    });
  }

  // --- Release actions -------------------------------------------------------------------------------------------

  async function releaseChange(kind: "withhold" | "unpublish", reason: string) {
    const ids = selectedIds;
    const result =
      kind === "withhold"
        ? await withholdMarksRequest(ids, reason)
        : await unpublishMarksRequest(ids, reason);
    const verb = kind === "withhold" ? "Withheld" : "Unpublished";
    const skipped =
      result.skipped > 0
        ? ` ${result.skipped} ${result.skipped === 1 ? "was" : "were"} left as ${result.skipped === 1 ? "it was" : "they were"}.`
        : "";
    toast.success(
      `${verb} ${result.changed} ${result.changed === 1 ? "mark" : "marks"}.${skipped}`,
    );
    setSelected(new Set());
    await reload();
    router.refresh();
  }

  // --- Render ----------------------------------------------------------------------------------------------------

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={InboxIcon}
        title="No students to mark yet"
        description="Students appear here when they are Enrolled in a programme that includes this module, or once they have submitted."
      />
    );
  }

  const summary = summarise(rows);
  const noneSelected = selectedIds.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" data-slot="marksheet-summary">
          {rows.length} {rows.length === 1 ? "student" : "students"}:{" "}
          <strong className="font-medium text-foreground">{summary.entered}</strong> marked (
          {summary.draft} draft, {summary.published} published, {summary.withheld} withheld),{" "}
          <strong className="font-medium text-foreground">{summary.missing}</strong> to mark.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <ExportCsvButton
            href={`/api/exports/marksheet/${assessmentId}.csv`}
            label="Export CSV: marksheet"
          />
          <Button type="button" onClick={() => setDialog("publish")}>
            <SendIcon data-icon="inline-start" aria-hidden="true" />
            Publish…
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={noneSelected}
            onClick={() => setDialog("withhold")}
          >
            <EyeOffIcon data-icon="inline-start" aria-hidden="true" />
            Withhold selected…
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={noneSelected}
            onClick={() => setDialog("unpublish")}
          >
            <UndoIcon data-icon="inline-start" aria-hidden="true" />
            Unpublish selected…
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Enter a mark from 0 to 100 (one decimal place), or NS for work that was never submitted.
        Press Enter to save and move to the next student. Late submissions are flagged but never
        lose marks automatically.
      </p>

      <div className="overflow-x-auto rounded-xl border">
        <Table className="min-w-[760px]">
          <caption className="sr-only">Marks for {assessmentTitle}</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className="w-10">
                <input
                  ref={selectAll}
                  type="checkbox"
                  className="size-4 accent-primary"
                  aria-label="Select all marks"
                  checked={selectable.length > 0 && selectedIds.length === selectable.length}
                  disabled={selectable.length === 0}
                  onChange={(event) =>
                    setSelected(event.target.checked ? new Set(selectable) : new Set())
                  }
                />
              </TableHead>
              <TableHead scope="col">Student</TableHead>
              <TableHead scope="col">Submission</TableHead>
              <TableHead scope="col">Mark</TableHead>
              <TableHead scope="col">Result</TableHead>
              <TableHead scope="col">Release</TableHead>
              <TableHead scope="col">Saved</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const { server } = row;
              const studentId = server.student.id;
              const live = liveClassification(row.input);
              const isNs = parseMarkText(row.input).kind === "ns";
              const messageId = `mark-status-${studentId}`;
              return (
                <TableRow key={studentId} data-student-id={studentId}>
                  <TableCell>
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      aria-label={`Select ${server.student.fullName}`}
                      disabled={server.markId === null}
                      checked={server.markId !== null && selected.has(server.markId)}
                      onChange={(event) =>
                        server.markId && toggleSelected(server.markId, event.target.checked)
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <div className="min-w-40">
                      <Link
                        href={`/staff/students/${studentId}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {server.student.fullName}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        <span className="font-mono">{server.student.studentNumber}</span>
                        <span title={server.student.programme.name}>
                          {" "}
                          &middot; {server.student.programme.code}
                        </span>
                      </div>
                      {!server.eligible ? (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <StatusBadge group="enrolment" value={server.student.status} />
                          <span>No longer eligible</span>
                        </div>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      group="submission"
                      value={server.submission.status}
                      detail={server.submission.status === "LATE" ? server.submission.lateBy : null}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Input
                        ref={(element) => {
                          if (element) inputs.current.set(studentId, element);
                          else inputs.current.delete(studentId);
                        }}
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        spellCheck={false}
                        className={cn("h-8 w-24 tabular-nums", isNs && "font-medium")}
                        aria-label={`Mark for ${server.student.fullName}`}
                        aria-invalid={row.save === "error" && !row.conflict ? true : undefined}
                        aria-describedby={row.error ? messageId : undefined}
                        placeholder="0–100"
                        value={row.input}
                        onChange={(event) => setInput(studentId, event.target.value)}
                        onBlur={() => void commit(studentId)}
                        onKeyDown={(event) => onKeyDown(event, studentId)}
                        onFocus={(event) => event.currentTarget.select()}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant={isNs ? "default" : "outline"}
                        aria-pressed={isNs}
                        aria-label={`Non-submission for ${server.student.fullName}`}
                        onClick={() => toggleNs(studentId)}
                      >
                        NS
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell>
                    {live ? (
                      <ClassificationBadge
                        classification={live.classification}
                        isNonSubmission={live.isNonSubmission}
                      />
                    ) : (
                      <span className="text-muted-foreground" aria-label="No classification yet">
                        &mdash;
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {server.releaseStatus ? (
                      <div className="min-w-24">
                        <StatusBadge group="result" value={server.releaseStatus} />
                        {server.releaseStatus === "WITHHELD" && server.withheldReason ? (
                          <span
                            className="mt-1 block max-w-40 truncate text-xs text-muted-foreground"
                            title={server.withheldReason}
                          >
                            {server.withheldReason}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">No mark yet</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div id={messageId} aria-live="polite" className="min-h-5 min-w-28 text-xs">
                      <SaveStatus row={row} onReload={() => void reload(studentId)} />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <PublishPreviewDialog
        open={dialog === "publish"}
        onOpenChange={(open) => setDialog(open ? "publish" : null)}
        target={{ assessmentId }}
        subject={assessmentTitle}
        onPublished={() => {
          void reload();
          router.refresh();
        }}
      />
      <ReasonDialog
        open={dialog === "withhold"}
        onOpenChange={(open) => setDialog(open ? "withhold" : null)}
        title="Withhold selected results"
        description={
          <>
            {selectedIds.length} {selectedIds.length === 1 ? "mark" : "marks"} will be hidden from
            students (shown to them as &ldquo;Not yet available&rdquo;), whether or not they were
            published. The reason is kept for staff.
          </>
        }
        reasonHint="For example: Outstanding fees."
        confirmLabel="Withhold"
        onSubmit={(reason) => releaseChange("withhold", reason)}
      />
      <ReasonDialog
        open={dialog === "unpublish"}
        onOpenChange={(open) => setDialog(open ? "unpublish" : null)}
        title="Unpublish selected results"
        description={
          <>
            Published results among the {selectedIds.length} selected go back to draft and students
            stop seeing them. Marks that are not published are left as they are.
          </>
        }
        confirmLabel="Unpublish"
        onSubmit={(reason) => releaseChange("unpublish", reason)}
      />
      <ReasonDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (open) return;
          // Closed without saving (cancel or Escape): put the box back. After a save, the row already holds the new value.
          const request = pendingRef.current;
          pendingRef.current = null;
          setPending(null);
          if (request) revert(request.studentId);
        }}
        title="Change a published mark"
        description={
          pending ? (
            <>
              This mark is published. Changing it from <strong>{pending.from ?? "—"}</strong> to{" "}
              <strong>{pending.to}</strong> is recorded in the history with your reason, and the
              mark stays published.
            </>
          ) : undefined
        }
        reasonLabel="Reason for the change"
        reasonHint="For example: Appeal upheld, or Marking error."
        confirmLabel="Save change"
        onSubmit={async (reason) => {
          const request = pendingRef.current;
          if (!request) return;
          await send(request.studentId, request.body, reason);
          pendingRef.current = null;
        }}
      />
    </div>
  );
}

/** What the box would hold after a save of `body`, to tell "still typing" from "done". */
function textForBody(body: PutMarkBody): string {
  if (body.isNonSubmission) return "NS";
  return body.mark ?? "";
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.code === "VERSION_CONFLICT") {
      return "Changed by someone else since you opened this page.";
    }
    const field = error.fieldErrors.mark?.[0] ?? error.fieldErrors.reason?.[0];
    return field ?? error.message;
  }
  return "Could not save. Try again.";
}

function SaveStatus({ row, onReload }: { row: RowState; onReload: () => void }) {
  if (row.save === "saving") {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
        Saving…
      </span>
    );
  }
  if (row.save === "error") {
    return (
      <span className="block text-destructive">
        <span className="font-medium">Not saved.</span> {row.error}
        {row.conflict ? (
          <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={onReload}>
            Reload this row
          </Button>
        ) : null}
      </span>
    );
  }
  if (row.save === "saved") return <span className="text-muted-foreground">Saved</span>;
  if (differsFromStored(row)) return <span className="text-muted-foreground">Unsaved</span>;
  return null;
}
