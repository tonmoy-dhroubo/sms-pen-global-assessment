"use client";

import { LockIcon, LockOpenIcon, PencilIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { AssessmentForm, type ModuleOption } from "@/components/assessments/assessment-form";
import { ConfirmDialog } from "@/components/dialogs/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiRequestError } from "@/lib/client/api";
import { closeAssessmentRequest, reopenAssessmentRequest } from "@/lib/client/assessments";
import type { AssessmentDetail } from "@/lib/services/assessments";
import { toDeadlineFields } from "@/lib/validation/assessments";

// Edit, Close and Reopen on the assessment detail page (pages.md `/staff/assessments/[id]`). Close and Reopen ask for
// confirmation first, because closing stops every upload, late ones included. If another member of staff already did
// the same thing the page just refreshes to the real state instead of showing an error.

export interface AssessmentActionsProps {
  assessment: Pick<
    AssessmentDetail,
    "id" | "title" | "module" | "deadline" | "closedAt" | "version" | "counts"
  >;
  modules: ModuleOption[];
  /** The server's "now" (ISO), for the deadline notices in the edit form. */
  now: string;
}

export function AssessmentActions({ assessment, modules, now }: AssessmentActionsProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState<"close" | "reopen" | null>(null);
  const closed = assessment.closedAt !== null;

  /** Runs the request; "already in that state" is not an error to show, just a reason to refresh. */
  async function change(action: "close" | "reopen") {
    try {
      if (action === "close") {
        await closeAssessmentRequest(assessment.id);
        toast.success(`${assessment.title} is closed. Students can no longer upload.`);
      } else {
        await reopenAssessmentRequest(assessment.id);
        toast.success(`${assessment.title} is open again. Students can upload.`);
      }
    } catch (error) {
      const alreadyThere =
        error instanceof ApiRequestError &&
        error.code === "BUSINESS_RULE" &&
        error.details?.rule === (action === "close" ? "ALREADY_CLOSED" : "NOT_CLOSED");
      if (!alreadyThere) throw error;
      toast.info(
        action === "close"
          ? "Someone else already closed this assessment."
          : "Someone else already reopened this assessment.",
      );
    }
    router.refresh();
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setEditing(true)}>
        <PencilIcon data-icon="inline-start" aria-hidden="true" />
        Edit
      </Button>
      {closed ? (
        <Button type="button" variant="outline" onClick={() => setConfirming("reopen")}>
          <LockOpenIcon data-icon="inline-start" aria-hidden="true" />
          Reopen
        </Button>
      ) : (
        <Button type="button" variant="outline" onClick={() => setConfirming("close")}>
          <LockIcon data-icon="inline-start" aria-hidden="true" />
          Close
        </Button>
      )}

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-xl" showCloseButton>
          <DialogHeader>
            <DialogTitle>Edit assessment</DialogTitle>
            <DialogDescription>
              Change the title or the deadline of {assessment.module.code} &middot;{" "}
              {assessment.title}.
            </DialogDescription>
          </DialogHeader>
          {/* Keyed by version, so a reload after a conflict starts the form again from what is stored. */}
          <AssessmentForm
            key={assessment.version}
            mode={{
              kind: "edit",
              id: assessment.id,
              version: assessment.version,
              submitted: assessment.counts.submitted,
              marked: assessment.counts.marked,
            }}
            modules={modules}
            now={now}
            initialValues={{
              moduleId: assessment.module.id,
              title: assessment.title,
              ...toDeadlineFields(assessment.deadline),
            }}
            onSaved={() => {
              setEditing(false);
              router.refresh();
            }}
            onCancel={() => setEditing(false)}
            onReload={() => {
              setEditing(false);
              router.refresh();
            }}
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirming === "close"}
        onOpenChange={(open) => setConfirming(open ? "close" : null)}
        title="Close this assessment?"
        description={
          <>
            Students will no longer be able to upload or replace files for{" "}
            <strong>{assessment.title}</strong>, not even late ones. Files already submitted are
            kept. You can reopen it at any time.
          </>
        }
        confirmLabel="Close assessment"
        destructive
        onConfirm={() => change("close")}
      />
      <ConfirmDialog
        open={confirming === "reopen"}
        onOpenChange={(open) => setConfirming(open ? "reopen" : null)}
        title="Reopen this assessment?"
        description={
          <>
            Students will be able to upload again for <strong>{assessment.title}</strong>. Uploads
            after the deadline are accepted and marked late.
          </>
        }
        confirmLabel="Reopen assessment"
        onConfirm={() => change("reopen")}
      />
    </>
  );
}
