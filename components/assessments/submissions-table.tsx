"use client";

import { ChevronDownIcon, ChevronRightIcon, InboxIcon } from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";
import { DownloadButton } from "@/components/assessments/download-button";
import { DateTime } from "@/components/format/date-time";
import { formatFileSize } from "@/components/format/file-size";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  AssessmentSubmissions,
  SubmissionFileDto,
  SubmissionRow,
} from "@/lib/services/assessments";

// The Submissions tab of an assessment (pages.md `/staff/assessments/[id]`): every eligible student with a status badge
// (on time, late and by how much, not submitted), the file they submitted and its versions, and a Download button.
// A student who submitted but is no longer eligible (withdrawn, deferred, programme changed) stays on the list and is
// labelled. Versions open under their row; each shows its name, size, arrival time and SHA-256 fingerprint.

function VersionList({ row }: { row: SubmissionRow }) {
  return (
    <ol className="space-y-3" aria-label={`Versions submitted by ${row.student.fullName}`}>
      {row.versions.map((file) => (
        <li
          key={file.id}
          className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
        >
          <div className="min-w-0 space-y-0.5 text-sm">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium">Version {file.version}</span>
              {file.id === row.currentFile?.id ? (
                <span className="rounded-4xl border px-2 py-0.5 text-xs">Current</span>
              ) : null}
              <span className="break-words">{file.fileName}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {formatFileSize(file.sizeBytes)} &middot; arrived <DateTime value={file.uploadedAt} />
            </div>
            <div className="text-xs text-muted-foreground">
              SHA-256 <span className="font-mono break-all">{file.sha256}</span>
            </div>
          </div>
          <DownloadButton fileId={file.id} fileName={file.fileName} />
        </li>
      ))}
    </ol>
  );
}

function StudentCell({ row }: { row: SubmissionRow }) {
  const { student } = row;
  return (
    <div className="min-w-40">
      <Link
        href={`/staff/students/${student.id}`}
        className="font-medium underline-offset-4 hover:underline"
      >
        {student.fullName}
      </Link>
      <div className="text-xs text-muted-foreground">
        <span className="font-mono">{student.studentNumber}</span>
        <span title={student.programme.name}> &middot; {student.programme.code}</span>
      </div>
      {/* Below the widest layout the status, times and file fold in here, so nothing scrolls out of view. */}
      <div className="mt-1.5 space-y-1 text-xs whitespace-normal xl:hidden">
        <StatusBadge
          group="submission"
          value={row.status}
          detail={row.status === "LATE" ? row.lateBy : null}
        />
        <div className="text-muted-foreground">
          Deadline <DateTime value={row.deadline} />
          {row.extension ? " (extended)" : null}
        </div>
        {row.submission && row.currentFile ? (
          <div className="text-muted-foreground">
            Submitted <DateTime value={row.submission.lastSubmittedAt} />
            <span className="block break-words">
              {row.currentFile.fileName} &middot; {formatFileSize(row.currentFile.sizeBytes)}
            </span>
          </div>
        ) : null}
      </div>
      {!row.eligible ? (
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <StatusBadge group="enrolment" value={student.status} />
          <span>No longer eligible; submitted earlier</span>
        </div>
      ) : null}
    </div>
  );
}

function FileCell({ file }: { file: SubmissionFileDto | null }) {
  if (!file) return <span className="text-muted-foreground">&mdash;</span>;
  return (
    <div className="max-w-56 min-w-32">
      <span className="block truncate" title={file.fileName}>
        {file.fileName}
      </span>
      <span className="text-xs text-muted-foreground">{formatFileSize(file.sizeBytes)}</span>
    </div>
  );
}

export interface SubmissionsTableProps {
  submissions: AssessmentSubmissions;
}

export function SubmissionsTable({ submissions }: SubmissionsTableProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  function toggle(studentId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  }

  if (submissions.total === 0) {
    return (
      <EmptyState
        icon={InboxIcon}
        title="No eligible students yet"
        description="Students appear here when they are Enrolled in a programme that includes this module, or once they have submitted."
      />
    );
  }

  const { summary } = submissions;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground" data-slot="submissions-summary">
        {submissions.total} {submissions.total === 1 ? "student" : "students"}:{" "}
        <strong className="font-medium text-foreground">{summary.onTime}</strong> on time,{" "}
        <strong className="font-medium text-foreground">{summary.late}</strong> late,{" "}
        <strong className="font-medium text-foreground">{summary.notSubmitted}</strong> not
        submitted.
      </p>

      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <caption className="sr-only">Submissions for this assessment</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Student</TableHead>
              <TableHead scope="col" className="max-xl:hidden">
                Status
              </TableHead>
              <TableHead scope="col" className="max-xl:hidden">
                Submitted
              </TableHead>
              <TableHead scope="col" className="max-xl:hidden">
                Current file
              </TableHead>
              <TableHead scope="col" className="max-xl:hidden">
                Deadline
              </TableHead>
              <TableHead scope="col">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {submissions.items.map((row) => {
              const open = expanded.has(row.student.id);
              const panelId = `versions-${row.student.id}`;
              return (
                <Fragment key={row.student.id}>
                  <TableRow data-state={open ? "expanded" : undefined}>
                    <TableCell>
                      <StudentCell row={row} />
                    </TableCell>
                    <TableCell className="max-xl:hidden">
                      <StatusBadge
                        group="submission"
                        value={row.status}
                        detail={row.status === "LATE" ? row.lateBy : null}
                      />
                    </TableCell>
                    <TableCell className="max-xl:hidden">
                      {row.submission ? (
                        <div className="min-w-32">
                          <DateTime value={row.submission.lastSubmittedAt} />
                          {row.versions.length > 1 ? (
                            <span className="block text-xs text-muted-foreground">
                              first <DateTime value={row.submission.firstSubmittedAt} />
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">&mdash;</span>
                      )}
                    </TableCell>
                    <TableCell className="max-xl:hidden">
                      <FileCell file={row.currentFile} />
                    </TableCell>
                    <TableCell className="max-xl:hidden">
                      <div className="min-w-32">
                        <DateTime value={row.deadline} />
                        {row.extension ? (
                          <span
                            className="block text-xs text-muted-foreground"
                            title={row.extension.reason}
                          >
                            Extended &middot; {row.extension.reason}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      {row.currentFile ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <DownloadButton
                            fileId={row.currentFile.id}
                            fileName={row.currentFile.fileName}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-expanded={open}
                            aria-controls={open ? panelId : undefined}
                            aria-label={`${open ? "Hide" : "Show"} versions for ${row.student.fullName}`}
                            onClick={() => toggle(row.student.id)}
                          >
                            {open ? (
                              <ChevronDownIcon data-icon="inline-start" aria-hidden="true" />
                            ) : (
                              <ChevronRightIcon data-icon="inline-start" aria-hidden="true" />
                            )}
                            {row.versions.length === 1
                              ? "1 version"
                              : `${row.versions.length} versions`}
                          </Button>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                  {open ? (
                    <TableRow id={panelId} className="bg-muted/40 hover:bg-muted/40">
                      <TableCell colSpan={6}>
                        <VersionList row={row} />
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
