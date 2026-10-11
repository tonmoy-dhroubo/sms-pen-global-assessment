"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Controller, useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { handleApiError } from "@/lib/client/api-errors";
import { reasonFormSchema, type ReasonFormValues } from "@/lib/validation/reason";

// A dialog that asks "why?" before an action that needs a recorded reason (status changes, voiding, withholding,
// unpublishing, changing a published mark). The reason is required and trimmed; `onSubmit` receives it and performs
// the API call. If the API rejects it, field errors land on the textarea and other errors become toasts.

export interface ReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /** Label above the textarea. */
  reasonLabel?: string;
  /** Helper text under the textarea. */
  reasonHint?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onSubmit: (reason: string) => Promise<void> | void;
}

export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  reasonLabel = "Reason",
  reasonHint,
  confirmLabel = "Confirm",
  destructive = false,
  onSubmit,
}: ReasonDialogProps) {
  const form = useForm<ReasonFormValues>({
    resolver: zodResolver(reasonFormSchema),
    defaultValues: { reason: "" },
  });
  const { isSubmitting, errors } = form.formState;

  // A fresh, empty form every time the dialog opens.
  useEffect(() => {
    if (open) form.reset({ reason: "" });
  }, [open, form]);

  const submit = form.handleSubmit(async (values) => {
    try {
      await onSubmit(values.reason);
      onOpenChange(false);
    } catch (error) {
      handleApiError(error, { setError: form.setError, fields: ["reason"] });
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => (isSubmitting ? undefined : onOpenChange(next))}>
      <DialogContent showCloseButton={false}>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>

          <Controller
            name="reason"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid || undefined}>
                <FieldLabel htmlFor="reason-dialog-reason">{reasonLabel}</FieldLabel>
                <Textarea
                  {...field}
                  id="reason-dialog-reason"
                  rows={3}
                  aria-invalid={fieldState.invalid}
                  aria-describedby={reasonHint ? "reason-dialog-hint" : undefined}
                  disabled={isSubmitting}
                />
                {reasonHint ? (
                  <FieldDescription id="reason-dialog-hint">{reasonHint}</FieldDescription>
                ) : null}
                {fieldState.invalid ? <FieldError errors={[errors.reason]} /> : null}
              </Field>
            )}
          />

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant={destructive ? "destructive" : "default"}
              disabled={isSubmitting}
            >
              {isSubmitting ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
