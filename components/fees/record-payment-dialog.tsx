"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon, PlusIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { Money } from "@/components/format/money";
import { Notice } from "@/components/shared/notice";
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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
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
import { existingPaymentFrom, recordPaymentRequest } from "@/lib/client/fees";
import type { ExistingPayment } from "@/lib/client/fees";
import { Decimal, formatBdt, parseMoneyInput } from "@/lib/services/rules/money";
import { formatDate, todayIn } from "@/lib/services/rules/time";
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  recordPaymentSchema,
  REFERENCE_MAX_LENGTH,
  type RecordPaymentInput,
} from "@/lib/validation/fees";

// "Record payment" (pages.md: the student record, `/staff/fees`, later the dashboard). Posts to
// `/api/students/{id}/payments`, then refreshes the page so every balance on it updates without a reload.
//
//   - The date defaults to today in Dhaka; a future date is refused (by the form and again by the server).
//   - Typing an amount larger than the balance shows a heads-up before saving (the server also answers with an
//     OVERPAYMENT warning, shown as a toast, because it is the one that knows the balance at the moment of saving).
//   - A reference that is already in use is explained inline with a link to the payment that has it.
//   - The submit button is disabled while the request runs, so a double click cannot send it twice.

type FormInput = z.input<typeof recordPaymentSchema>;

export interface RecordPaymentDialogProps {
  studentId: string;
  studentName: string;
  /** The student's balance from the fee summary (API money string; negative when in credit). */
  balance: string;
  triggerLabel?: string;
  triggerVariant?: "default" | "outline" | "ghost" | "secondary";
  triggerSize?: "default" | "sm";
  /** Called after a payment is saved, before the page refreshes. */
  onRecorded?: () => void;
}

/** How much a typed amount exceeds the balance, or `null` when it does not (or is not a usable amount yet). */
function excessOverBalance(amountText: string | undefined, balance: string): Decimal | null {
  const parsed = parseMoneyInput(amountText ?? "");
  if (!parsed.ok || !parsed.value.greaterThan(0)) return null;
  const excess = parsed.value.minus(new Decimal(balance));
  return excess.greaterThan(0) ? excess : null;
}

export function RecordPaymentDialog({
  studentId,
  studentName,
  balance,
  triggerLabel = "Record payment",
  triggerVariant = "default",
  triggerSize = "default",
  onRecorded,
}: RecordPaymentDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [clash, setClash] = useState<ExistingPayment | null>(null);

  const form = useForm<FormInput, unknown, RecordPaymentInput>({
    resolver: zodResolver(recordPaymentSchema),
    defaultValues: { amount: "", paidAt: "", reference: "" },
  });
  const { errors, isSubmitting } = form.formState;
  const amount = useWatch({ control: form.control, name: "amount" });
  const method = useWatch({ control: form.control, name: "method" });
  const isCash = method === "CASH";
  const excess = excessOverBalance(amount, balance);
  const owes = new Decimal(balance).greaterThan(0);

  // A fresh form every time the dialog opens, dated today in Dhaka (computed now, not when the page loaded).
  function changeOpen(next: boolean) {
    if (isSubmitting) return;
    if (next) {
      form.reset({ amount: "", paidAt: todayIn(new Date()), reference: "" });
      setClash(null);
    }
    setOpen(next);
  }

  const submit = form.handleSubmit(async (values) => {
    try {
      const result = await recordPaymentRequest(studentId, values);
      toast.success(`Recorded ${formatBdt(result.payment.amount)} from ${studentName}.`, {
        description: `Reference ${result.payment.reference}`,
      });
      for (const warning of result.warnings ?? []) {
        toast.warning(warning.message, { duration: 12_000 });
      }
      setOpen(false);
      onRecorded?.();
      router.refresh();
    } catch (error) {
      const existing =
        error instanceof ApiRequestError && error.code === "CONFLICT"
          ? existingPaymentFrom(error.details)
          : null;
      if (existing) {
        setClash(existing);
        form.setError("reference", {
          type: "server",
          message: "This reference is already in use.",
        });
        form.setFocus("reference");
        return;
      }
      handleApiError(error, {
        setError: form.setError,
        fields: ["amount", "method", "paidAt", "reference"],
      });
    }
  });

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant={triggerVariant} size={triggerSize}>
          {triggerVariant === "default" ? (
            <PlusIcon data-icon="inline-start" aria-hidden="true" />
          ) : null}
          {triggerLabel}
          <span className="sr-only"> for {studentName}</span>
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={false}>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Record payment</DialogTitle>
            <DialogDescription>
              {studentName} currently{" "}
              {new Decimal(balance).lessThan(0) ? (
                <>
                  has a credit of{" "}
                  <Money value={new Decimal(balance).negated()} className="font-medium" />
                </>
              ) : (
                <>
                  owes <Money value={balance} className="font-medium" />
                </>
              )}
              . A recorded payment is never edited; if it was a mistake, void it with a reason.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="gap-4">
            <Controller
              name="amount"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor="payment-amount">Amount (BDT)</FieldLabel>
                  <Input
                    {...field}
                    id="payment-amount"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="e.g. 25,000.00"
                    aria-invalid={fieldState.invalid}
                    aria-required="true"
                    aria-describedby={excess ? "payment-overpayment" : undefined}
                    disabled={isSubmitting}
                  />
                  {fieldState.invalid ? <FieldError errors={[errors.amount]} /> : null}
                </Field>
              )}
            />

            {excess ? (
              <Notice>
                <p id="payment-overpayment">
                  {owes ? (
                    <>
                      This is{" "}
                      <strong>
                        <Money value={excess} />
                      </strong>{" "}
                      more than the balance of <Money value={balance} />. You can still save it; the
                      difference will show as credit.
                    </>
                  ) : (
                    <>
                      {studentName} owes nothing at the moment. You can still save this payment; it
                      will show as credit.
                    </>
                  )}
                </p>
              </Notice>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <Controller
                name="method"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid || undefined}>
                    <FieldLabel htmlFor="payment-method">Method</FieldLabel>
                    <Select
                      value={field.value ?? ""}
                      onValueChange={field.onChange}
                      disabled={isSubmitting}
                    >
                      <SelectTrigger
                        id="payment-method"
                        className="w-full"
                        aria-invalid={fieldState.invalid}
                        aria-required="true"
                        onBlur={field.onBlur}
                      >
                        <SelectValue placeholder="Choose a method" />
                      </SelectTrigger>
                      <SelectContent>
                        {PAYMENT_METHODS.map((method) => (
                          <SelectItem key={method} value={method}>
                            {PAYMENT_METHOD_LABEL[method]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {fieldState.invalid ? <FieldError errors={[errors.method]} /> : null}
                  </Field>
                )}
              />

              <Controller
                name="paidAt"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid || undefined}>
                    <FieldLabel htmlFor="payment-date">Payment date</FieldLabel>
                    <Input
                      {...field}
                      id="payment-date"
                      type="date"
                      max={todayIn(new Date())}
                      aria-invalid={fieldState.invalid}
                      aria-required="true"
                      disabled={isSubmitting}
                    />
                    {fieldState.invalid ? <FieldError errors={[errors.paidAt]} /> : null}
                  </Field>
                )}
              />
            </div>

            <Controller
              name="reference"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor="payment-reference">
                    {isCash ? "Receipt number" : "Reference"}
                  </FieldLabel>
                  <Input
                    {...field}
                    onChange={(event) => {
                      field.onChange(event);
                      // The "already in use" explanation was about the previous text.
                      setClash(null);
                    }}
                    id="payment-reference"
                    autoComplete="off"
                    maxLength={REFERENCE_MAX_LENGTH + 20}
                    aria-invalid={fieldState.invalid}
                    aria-required="true"
                    aria-describedby="payment-reference-hint"
                    disabled={isSubmitting}
                  />
                  <FieldDescription id="payment-reference-hint">
                    {isCash
                      ? "The number on the receipt given for the cash, for example CASH-RCPT-0012. Each number can be used once; capitals and spacing are ignored."
                      : "Bank, bKash or Nagad transaction ID. Each reference can be used once; capitals and spacing are ignored."}
                  </FieldDescription>
                  {fieldState.invalid ? <FieldError errors={[errors.reference]} /> : null}
                </Field>
              )}
            />
          </FieldGroup>

          {clash ? (
            <Alert variant="destructive">
              <TriangleAlertIcon aria-hidden="true" />
              <AlertTitle>That reference is already in use</AlertTitle>
              <AlertDescription>
                <p>
                  A payment of <Money value={clash.amount} /> dated {formatDate(clash.paidAt)} for{" "}
                  {clash.student.fullName} ({clash.student.studentNumber}) already has it. Check you
                  are not recording the same payment twice.
                </p>
                <Link
                  href={`/staff/students/${clash.student.id}#payment-${clash.id}`}
                  onClick={() => setOpen(false)}
                >
                  View the existing payment
                </Link>
              </AlertDescription>
            </Alert>
          ) : null}

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
              Record payment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
