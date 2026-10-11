"use client";

import { Loader2Icon } from "lucide-react";
import { useState } from "react";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DateTime } from "@/components/format/date-time";
import type { DuplicateMatch } from "@/lib/client/students";

// The warning shown when a new student shares a name and date of birth with someone already on the register
// (edge-cases.md "Enrolment"; pages.md `/staff/students/new`). It lists who they might be so staff can check, and
// lets them create the record anyway: "Create anyway" resends the form with `confirmDuplicate: true`.

export interface DuplicateDialogProps {
  open: boolean;
  matches: DuplicateMatch[];
  /** Resends the create request with `confirmDuplicate`. A rejection leaves the dialog open. */
  onCreateAnyway: () => Promise<void>;
  onCancel: () => void;
}

export function DuplicateDialog({ open, matches, onCreateAnyway, onCancel }: DuplicateDialogProps) {
  const [pending, setPending] = useState(false);

  async function confirm() {
    setPending(true);
    try {
      await onCreateAnyway();
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (!next && !pending ? onCancel() : undefined)}>
      <DialogContent showCloseButton={false} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>This student may already be registered</DialogTitle>
          <DialogDescription>
            {matches.length === 1 ? "A student" : `${matches.length} students`} with the same name
            and date of birth {matches.length === 1 ? "is" : "are"} already on the register, under a
            different email address. Check before you create another record.
          </DialogDescription>
        </DialogHeader>

        <ul className="grid max-h-72 gap-2 overflow-y-auto" aria-label="Possible duplicates">
          {matches.map((match) => (
            <li key={match.id} className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <a
                  href={`/staff/students/${match.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {match.fullName}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
                <StatusBadge group="enrolment" value={match.status} />
              </div>
              <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 text-muted-foreground">
                <dt>Student ID</dt>
                <dd className="font-mono text-foreground">{match.studentNumber}</dd>
                <dt>Email</dt>
                <dd className="truncate text-foreground">{match.email}</dd>
                <dt>Date of birth</dt>
                <dd className="text-foreground">
                  <DateTime value={match.dateOfBirth} />
                </dd>
                <dt>Programme</dt>
                <dd className="text-foreground">{match.programme.name}</dd>
              </dl>
            </li>
          ))}
        </ul>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" disabled={pending} onClick={confirm}>
            {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
            Create anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
