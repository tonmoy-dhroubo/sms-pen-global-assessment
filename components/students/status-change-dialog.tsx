"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { StatusBadge } from "@/components/shared/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { ApiRequestError } from "@/lib/client/api";
import { handleApiError } from "@/lib/client/api-errors";
import { changeStatusRequest } from "@/lib/client/students";
import { allowedTransitions, transitionRule } from "@/lib/services/rules/status";
import type { EnrolmentStatus } from "@/lib/services/rules/types";
import { REASON_MAX_LENGTH } from "@/lib/validation/reason";

// "Change status" on the student record (pages.md `/staff/students/[id]`). The dialog offers only the transitions the
// matrix allows from the current status (api.md "Status transitions"), asks for a reason where one is required, and
// posts to `/api/students/{id}/status` with the version it was opened at. A completed record is final: the button is
// disabled and says why.

const LABEL: Record<EnrolmentStatus, string> = {
  ENROLLED: "Enrolled",
  DEFERRED: "Deferred",
  WITHDRAWN: "Withdrawn",
  COMPLETED: "Completed",
};

const HINT: Partial<Record<`${EnrolmentStatus}>${EnrolmentStatus}`, string>> = {
  "DEFERRED>ENROLLED": "The student returns from deferral.",
  "WITHDRAWN>ENROLLED": "Re-admission of a withdrawn student.",
  "ENROLLED>COMPLETED": "The student has finished the programme. This cannot be undone.",
};

interface FormValues {
  /** An `EnrolmentStatus` once chosen; empty until then. */
  toStatus: string;
  reason: string;
}

function schemaFor(from: EnrolmentStatus) {
  const targets = allowedTransitions(from).map((transition) => transition.to);
  return z
    .object({
      toStatus: z
        .string()
        .refine((value) => (targets as string[]).includes(value), "Choose the new status."),
      reason: z
        .string()
        .trim()
        .max(REASON_MAX_LENGTH, `Keep the reason under ${REASON_MAX_LENGTH} characters.`),
    })
    .superRefine((value, ctx) => {
      if (!(targets as string[]).includes(value.toStatus)) return;
      const rule = transitionRule(from, value.toStatus as EnrolmentStatus);
      if (rule.allowed && rule.reasonRequired && value.reason === "") {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "Enter a reason." });
      }
    });
}

export interface StatusChangeDialogProps {
  studentId: string;
  studentName: string;
  status: EnrolmentStatus;
  /** The record's version when the page was loaded; a stale one is refused by the server. */
  version: number;
}

export function StatusChangeDialog({
  studentId,
  studentName,
  status,
  version,
}: StatusChangeDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [stale, setStale] = useState(false);
  const options = allowedTransitions(status);
  const schema = useMemo(() => schemaFor(status), [status]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { toStatus: "", reason: "" },
  });
  const { errors, isSubmitting } = form.formState;
  const toStatus = useWatch({ control: form.control, name: "toStatus" });
  const rule = toStatus ? transitionRule(status, toStatus as EnrolmentStatus) : null;
  const reasonRequired = rule?.allowed ? rule.reasonRequired : false;

  // A fresh, empty form every time the dialog opens.
  function changeOpen(next: boolean) {
    if (isSubmitting) return;
    if (next) {
      form.reset({ toStatus: "", reason: "" });
      setStale(false);
    }
    setOpen(next);
  }

  const submit = form.handleSubmit(async (values) => {
    try {
      const updated = await changeStatusRequest(studentId, {
        toStatus: values.toStatus as EnrolmentStatus,
        reason: values.reason || undefined,
        version,
      });
      toast.success(`${studentName} is now ${LABEL[updated.status]}.`);
      setOpen(false);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "VERSION_CONFLICT") {
        setStale(true);
        return;
      }
      handleApiError(error, { setError: form.setError, fields: ["toStatus", "reason"] });
    }
  });

  if (options.length === 0) {
    return (
      <span className="inline-flex flex-col items-start gap-1">
        <Button type="button" variant="outline" disabled aria-describedby="status-final-note">
          Change status
        </Button>
        <span id="status-final-note" className="text-xs text-muted-foreground">
          Completed records are final.
        </span>
      </span>
    );
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          Change status
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={false}>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Change status</DialogTitle>
            <DialogDescription>
              {studentName} is currently <strong>{LABEL[status]}</strong>. Every change is recorded
              in the student&apos;s history.
            </DialogDescription>
          </DialogHeader>

          {stale ? (
            <Alert variant="destructive">
              <TriangleAlertIcon aria-hidden="true" />
              <AlertTitle>This record changed since you opened it</AlertTitle>
              <AlertDescription>
                <p>Reload to see the latest status, then try again.</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => {
                    setOpen(false);
                    router.refresh();
                  }}
                >
                  Reload
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          <Controller
            name="toStatus"
            control={form.control}
            render={({ field, fieldState }) => (
              <FieldSet data-invalid={fieldState.invalid || undefined} className="gap-2">
                <FieldLegend variant="label" className="mb-1">
                  Change to
                </FieldLegend>
                {options.map((option) => {
                  const id = `status-option-${option.to}`;
                  const hint = HINT[`${status}>${option.to}`];
                  return (
                    <label
                      key={option.to}
                      htmlFor={id}
                      className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
                    >
                      <input
                        id={id}
                        type="radio"
                        name={field.name}
                        value={option.to}
                        checked={field.value === option.to}
                        onChange={() => field.onChange(option.to)}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        disabled={isSubmitting}
                        className="mt-0.5 size-4 accent-[var(--brand)]"
                      />
                      <span className="grid gap-0.5 text-sm">
                        <span className="flex flex-wrap items-center gap-2">
                          <StatusBadge group="enrolment" value={option.to} />
                          {option.reasonRequired ? (
                            <span className="text-xs text-muted-foreground">Reason required</span>
                          ) : null}
                        </span>
                        {hint ? <span className="text-muted-foreground">{hint}</span> : null}
                      </span>
                    </label>
                  );
                })}
                {fieldState.invalid ? <FieldError errors={[errors.toStatus]} /> : null}
              </FieldSet>
            )}
          />

          {toStatus ? (
            <Controller
              name="reason"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor="status-reason">
                    {reasonRequired ? "Reason" : "Reason (optional)"}
                  </FieldLabel>
                  <Textarea
                    {...field}
                    id="status-reason"
                    rows={3}
                    aria-invalid={fieldState.invalid}
                    aria-required={reasonRequired}
                    disabled={isSubmitting}
                  />
                  <FieldDescription>
                    {reasonRequired
                      ? "Required. Shown in the student's history."
                      : "Shown in the student's history."}
                  </FieldDescription>
                  {fieldState.invalid ? <FieldError errors={[errors.reason]} /> : null}
                </Field>
              )}
            />
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
              Change status
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
