"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon, PencilIcon, PlusIcon, TrashIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { Notice } from "@/components/shared/notice";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiRequestError } from "@/lib/client/api";
import { handleApiError } from "@/lib/client/api-errors";
import { replaceFeeScheduleRequest } from "@/lib/client/programmes";
import type { FeeSchedule } from "@/lib/client/programmes";
import { formatBdt, sum } from "@/lib/services/rules/money";
import { feeScheduleFormSchema, MAX_INSTALMENTS } from "@/lib/validation/programmes";
import { academicYearSchema } from "@/lib/validation/students";

// Add or edit the fee schedule for one programme and session (pages.md `/staff/programmes`). The dialog says plainly
// what saving does: only students enrolled afterwards are billed from the new figures; charges that already exist
// never change. Instalments are numbered by their position (1, 2, ...), as the API requires.

const formSchema = feeScheduleFormSchema.extend({ academicYear: academicYearSchema });
type FormInput = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

export type FeeScheduleDialogProps = {
  programmeId: string;
  programmeName: string;
} & (
  | { mode: "edit"; schedule: FeeSchedule }
  | {
      mode: "add";
      /** Sessions that can still be given a schedule. */
      sessions: string[];
    }
);

export function FeeScheduleDialog(props: FeeScheduleDialogProps) {
  const { programmeId, programmeName } = props;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);

  const initial: FormInput =
    props.mode === "edit"
      ? {
          academicYear: props.schedule.academicYear,
          instalments: props.schedule.instalments.map(({ amount, dueDate }) => ({
            amount,
            dueDate,
          })),
        }
      : { academicYear: "", instalments: [{ amount: "", dueDate: "" }] };

  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: initial,
  });
  const { errors, isSubmitting } = form.formState;
  const rows = useFieldArray({ control: form.control, name: "instalments" });
  const billed = props.mode === "edit" ? props.schedule.billedStudents : 0;
  const editing = props.mode === "edit";

  function changeOpen(next: boolean) {
    if (isSubmitting) return;
    if (next) {
      form.reset(initial);
      setRejected(null);
    }
    setOpen(next);
  }

  const submit = form.handleSubmit(async (values) => {
    setRejected(null);
    try {
      const saved = await replaceFeeScheduleRequest(programmeId, values.academicYear, {
        instalments: values.instalments.map((row, index) => ({
          instalment: index + 1,
          amount: row.amount,
          dueDate: row.dueDate,
        })),
      });
      toast.success(`Saved the ${saved.academicYear} fee schedule for ${programmeName}.`, {
        description: `${formatBdt(saved.total)} in ${saved.instalments.length} ${saved.instalments.length === 1 ? "instalment" : "instalments"}.`,
      });
      for (const warning of saved.warnings ?? []) {
        toast.warning(warning.message, { duration: 12_000 });
      }
      setOpen(false);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "BUSINESS_RULE") {
        setRejected(error.message);
        return;
      }
      handleApiError(error, { setError: form.setError, fields: ["academicYear", "instalments"] });
    }
  });

  const typed = useWatch({ control: form.control, name: "instalments" });
  const total = sum(
    (typed ?? []).map((row) => {
      const text = (row?.amount ?? "").replace(/[^0-9.]/g, "");
      return /^\d+(\.\d+)?$/.test(text) ? text : "0";
    }),
  );

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant={editing ? "outline" : "default"} size="sm">
          {editing ? (
            <PencilIcon data-icon="inline-start" aria-hidden="true" />
          ) : (
            <PlusIcon data-icon="inline-start" aria-hidden="true" />
          )}
          {editing ? "Edit schedule" : "Add a session schedule"}
          {editing ? (
            <span className="sr-only">
              {" "}
              for {props.schedule.academicYear}, {programmeName}
            </span>
          ) : null}
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={false} className="sm:max-w-xl">
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? `Edit the ${props.schedule.academicYear} schedule`
                : "Add a session schedule"}
            </DialogTitle>
            <DialogDescription>
              The instalments a {programmeName} student is billed when they are enrolled into the
              session.
            </DialogDescription>
          </DialogHeader>

          <Notice>
            <p>
              <strong>Existing charges will not change.</strong> New amounts and dates apply only to
              students enrolled after you save.
              {billed > 0
                ? ` ${billed} ${billed === 1 ? "student has" : "students have"} already been billed from this schedule and keep what they were charged.`
                : null}
            </p>
          </Notice>

          {rejected ? (
            <Alert variant="destructive">
              <AlertDescription>{rejected}</AlertDescription>
            </Alert>
          ) : null}

          <FieldGroup className="gap-4">
            {props.mode === "add" ? (
              <Controller
                name="academicYear"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid || undefined}>
                    <FieldLabel htmlFor="schedule-session">Session</FieldLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={isSubmitting}
                    >
                      <SelectTrigger
                        id="schedule-session"
                        className="w-full sm:w-48"
                        aria-invalid={fieldState.invalid}
                        aria-required="true"
                      >
                        <SelectValue placeholder="Choose a session" />
                      </SelectTrigger>
                      <SelectContent>
                        {props.sessions.map((session) => (
                          <SelectItem key={session} value={session}>
                            {session}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {fieldState.invalid ? <FieldError errors={[errors.academicYear]} /> : null}
                  </Field>
                )}
              />
            ) : null}

            <fieldset className="grid gap-3">
              <legend className="mb-1 text-sm font-medium">Instalments</legend>
              {rows.fields.map((row, index) => (
                <div
                  key={row.id}
                  className="grid grid-cols-[1fr_auto] items-start gap-x-2 gap-y-2 rounded-lg border p-3 sm:grid-cols-[5.5rem_1fr_1fr_auto]"
                >
                  <span className="col-span-2 pt-2 text-sm font-medium sm:col-span-1">
                    Instalment {index + 1}
                  </span>
                  <Controller
                    name={`instalments.${index}.amount`}
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid || undefined} className="gap-1">
                        <FieldLabel htmlFor={`schedule-amount-${index}`} className="sr-only">
                          Amount for instalment {index + 1}
                        </FieldLabel>
                        <Input
                          {...field}
                          id={`schedule-amount-${index}`}
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder="Amount (BDT)"
                          aria-invalid={fieldState.invalid}
                          disabled={isSubmitting}
                        />
                        {fieldState.invalid ? (
                          <FieldError errors={[errors.instalments?.[index]?.amount]} />
                        ) : null}
                      </Field>
                    )}
                  />
                  <Controller
                    name={`instalments.${index}.dueDate`}
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid || undefined} className="gap-1">
                        <FieldLabel htmlFor={`schedule-due-${index}`} className="sr-only">
                          Due date for instalment {index + 1}
                        </FieldLabel>
                        <Input
                          {...field}
                          id={`schedule-due-${index}`}
                          type="date"
                          aria-invalid={fieldState.invalid}
                          disabled={isSubmitting}
                        />
                        {fieldState.invalid ? (
                          <FieldError errors={[errors.instalments?.[index]?.dueDate]} />
                        ) : null}
                      </Field>
                    )}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={isSubmitting || rows.fields.length === 1}
                    onClick={() => rows.remove(index)}
                  >
                    <TrashIcon aria-hidden="true" />
                    <span className="sr-only">Remove instalment {index + 1}</span>
                  </Button>
                </div>
              ))}
              {errors.instalments?.message || errors.instalments?.root?.message ? (
                <FieldError
                  errors={[errors.instalments?.root ?? { message: errors.instalments?.message }]}
                />
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isSubmitting || rows.fields.length >= MAX_INSTALMENTS}
                  onClick={() => rows.append({ amount: "", dueDate: "" })}
                >
                  <PlusIcon data-icon="inline-start" aria-hidden="true" />
                  Add instalment
                </Button>
                <p className="text-sm text-muted-foreground">
                  Total{" "}
                  <span className="font-medium text-foreground tabular-nums">
                    {formatBdt(total)}
                  </span>
                </p>
              </div>
            </fieldset>
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
              Save schedule
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
