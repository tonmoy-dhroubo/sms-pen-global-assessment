"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
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
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { handleApiError } from "@/lib/client/api-errors";
import { addChargeRequest } from "@/lib/client/fees";
import { formatBdt } from "@/lib/services/rules/money";
import { todayIn } from "@/lib/services/rules/time";
import {
  CHARGE_KINDS,
  createChargeSchema,
  DESCRIPTION_MAX_LENGTH,
  type ChargeKindValue,
  type CreateChargeInput,
} from "@/lib/validation/fees";

// "Add adjustment or waiver" on the student record (pages.md `/staff/students/[id]`). An adjustment adds to what the
// student owes (for example the fee difference after a programme change, which is never recalculated silently); a
// waiver reduces it (a scholarship). Both are typed as a positive amount; the server stores a waiver as negative.

type FormInput = z.input<typeof createChargeSchema>;

const KIND_COPY: Record<ChargeKindValue, { label: string; hint: string }> = {
  ADJUSTMENT: {
    label: "Adjustment",
    hint: "Adds to what the student owes, for example a fee difference after a change of programme.",
  },
  WAIVER: {
    label: "Waiver",
    hint: "Reduces what the student owes, for example a scholarship or a hardship concession.",
  },
};

export interface ChargeDialogProps {
  studentId: string;
  studentName: string;
}

export function ChargeDialog({ studentId, studentName }: ChargeDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const form = useForm<FormInput, unknown, CreateChargeInput>({
    resolver: zodResolver(createChargeSchema),
    defaultValues: { description: "", amount: "", dueDate: "" },
  });
  const { errors, isSubmitting } = form.formState;
  const kind = useWatch({ control: form.control, name: "kind" });

  function changeOpen(next: boolean) {
    if (isSubmitting) return;
    if (next) {
      form.reset({ kind: undefined, description: "", amount: "", dueDate: todayIn(new Date()) });
    }
    setOpen(next);
  }

  const submit = form.handleSubmit(async (values) => {
    try {
      const { charge, summary } = await addChargeRequest(studentId, values);
      toast.success(
        `${KIND_COPY[values.kind].label} of ${formatBdt(charge.amount.replace("-", ""))} added.`,
        { description: `${studentName}'s balance is now ${formatBdt(summary.balance)}.` },
      );
      setOpen(false);
      router.refresh();
    } catch (error) {
      handleApiError(error, {
        setError: form.setError,
        fields: ["kind", "description", "amount", "dueDate"],
      });
    }
  });

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          Add adjustment or waiver
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={false}>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add adjustment or waiver</DialogTitle>
            <DialogDescription>
              Changes {studentName}&apos;s account. Existing charges are never edited; this adds a
              new line.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="gap-4">
            <Controller
              name="kind"
              control={form.control}
              render={({ field, fieldState }) => (
                <FieldSet data-invalid={fieldState.invalid || undefined} className="gap-2">
                  <FieldLegend variant="label" className="mb-1">
                    Type
                  </FieldLegend>
                  {CHARGE_KINDS.map((option) => {
                    const id = `charge-kind-${option}`;
                    return (
                      <label
                        key={option}
                        htmlFor={id}
                        className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
                      >
                        <input
                          id={id}
                          type="radio"
                          name={field.name}
                          value={option}
                          checked={field.value === option}
                          onChange={() => field.onChange(option)}
                          onBlur={field.onBlur}
                          ref={field.ref}
                          disabled={isSubmitting}
                          className="mt-0.5 size-4 accent-[var(--brand)]"
                        />
                        <span className="grid gap-0.5 text-sm">
                          <span className="font-medium">{KIND_COPY[option].label}</span>
                          <span className="text-muted-foreground">{KIND_COPY[option].hint}</span>
                        </span>
                      </label>
                    );
                  })}
                  {fieldState.invalid ? <FieldError errors={[errors.kind]} /> : null}
                </FieldSet>
              )}
            />

            <Controller
              name="description"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor="charge-description">Description</FieldLabel>
                  <Input
                    {...field}
                    id="charge-description"
                    autoComplete="off"
                    maxLength={DESCRIPTION_MAX_LENGTH + 20}
                    placeholder={
                      kind === "WAIVER"
                        ? "e.g. Merit scholarship 2026-27"
                        : "e.g. Fee difference after programme change"
                    }
                    aria-invalid={fieldState.invalid}
                    aria-required="true"
                    disabled={isSubmitting}
                  />
                  {fieldState.invalid ? <FieldError errors={[errors.description]} /> : null}
                </Field>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Controller
                name="amount"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid || undefined}>
                    <FieldLabel htmlFor="charge-amount">Amount (BDT)</FieldLabel>
                    <Input
                      {...field}
                      id="charge-amount"
                      inputMode="decimal"
                      autoComplete="off"
                      aria-invalid={fieldState.invalid}
                      aria-required="true"
                      aria-describedby="charge-amount-hint"
                      disabled={isSubmitting}
                    />
                    <FieldDescription id="charge-amount-hint">
                      {kind === "WAIVER"
                        ? "Enter a positive figure; it reduces the balance."
                        : "Enter a positive figure; it increases the balance."}
                    </FieldDescription>
                    {fieldState.invalid ? <FieldError errors={[errors.amount]} /> : null}
                  </Field>
                )}
              />

              <Controller
                name="dueDate"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid || undefined}>
                    <FieldLabel htmlFor="charge-due-date">Due date</FieldLabel>
                    <Input
                      {...field}
                      id="charge-due-date"
                      type="date"
                      aria-invalid={fieldState.invalid}
                      aria-required="true"
                      disabled={isSubmitting}
                    />
                    {fieldState.invalid ? <FieldError errors={[errors.dueDate]} /> : null}
                  </Field>
                )}
              />
            </div>
          </FieldGroup>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => changeOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
              Add {kind ? KIND_COPY[kind].label.toLowerCase() : "charge"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
