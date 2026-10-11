import { z } from "zod";
import { parseSort } from "@/lib/list-params";
import { AGEING_BUCKETS } from "@/lib/services/rules/fees";
import { parseMoneyInput, toApiString } from "@/lib/services/rules/money";
import type { ParseMoneyError } from "@/lib/services/rules/money";
import { todayIn } from "@/lib/services/rules/time";
import { calendarDateProblem, calendarDateSchema } from "@/lib/validation/dates";
import { reasonFormSchema } from "@/lib/validation/reason";

// Request schemas for fees and payments (api.md "Fees and payments"). Shared by the payment, adjustment and void
// dialogs and the Route Handlers, so the browser and the server say the same thing about the same input.

export const PAYMENT_METHODS = ["BANK_TRANSFER", "CASH", "BKASH", "NAGAD", "CARD"] as const;
export type PaymentMethodValue = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethodValue, string> = {
  BANK_TRANSFER: "Bank transfer",
  CASH: "Cash",
  BKASH: "bKash",
  NAGAD: "Nagad",
  CARD: "Card",
};

export const CHARGE_KINDS = ["ADJUSTMENT", "WAIVER"] as const;
export type ChargeKindValue = (typeof CHARGE_KINDS)[number];

export const REFERENCE_MAX_LENGTH = 64;
export const DESCRIPTION_MAX_LENGTH = 200;

export const FUTURE_PAYMENT_MESSAGE = "A payment cannot be dated in the future.";

// --- Fields -----------------------------------------------------------------------------------------------------------

const AMOUNT_MESSAGES: Record<ParseMoneyError, string> = {
  EMPTY: "Enter the amount.",
  INVALID: "Enter an amount such as 5000 or 5,000.50.",
  NEGATIVE: "The amount must be more than zero.",
  TOO_MANY_DECIMALS: "Use at most two decimal places.",
  TOO_LARGE: "That amount is too large.",
};

/**
 * What a person types into an amount field (`5000`, `1,25,000.50`, `৳5,000`) or what the API receives (`"5000.00"`),
 * checked to be more than zero with at most two decimals, and normalised to the API form `"125000.50"` (DB-002).
 */
export const positiveAmountSchema = z
  .string({
    required_error: "Enter the amount.",
    invalid_type_error: 'Send the amount as a string such as "5000.00".',
  })
  .transform((value, ctx) => {
    const parsed = parseMoneyInput(value);
    if (!parsed.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: AMOUNT_MESSAGES[parsed.code] });
      return z.NEVER;
    }
    if (!parsed.value.greaterThan(0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: AMOUNT_MESSAGES.NEGATIVE });
      return z.NEVER;
    }
    return toApiString(parsed.value);
  });

/** A payment date: a real day, today or earlier in Dhaka. Backdating is allowed; the future is not. */
export const paidAtSchema = z
  .string({ required_error: "Enter the payment date." })
  .superRefine((value, ctx) => {
    const message =
      calendarDateProblem(value, "Enter the payment date.") ??
      (value > todayIn(new Date()) ? FUTURE_PAYMENT_MESSAGE : null);
    if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  });

/**
 * How a payment reference is stored: surrounding spaces removed, runs of spaces collapsed, upper-cased. References
 * are unique across all payments, so `trx-9f3` and `TRX-9F3` are the same reference and clash.
 */
export function normalisePaymentReference(reference: string): string {
  return reference.trim().replace(/\s+/g, " ").toUpperCase();
}

export const paymentReferenceSchema = z
  .string({ required_error: "Enter the payment reference." })
  .trim()
  .min(1, "Enter the payment reference.")
  .max(REFERENCE_MAX_LENGTH, `Keep the reference under ${REFERENCE_MAX_LENGTH} characters.`)
  .transform(normalisePaymentReference);

// --- Request bodies -------------------------------------------------------------------------------------------------

export const recordPaymentSchema = z.object({
  amount: positiveAmountSchema,
  method: z.enum(PAYMENT_METHODS, {
    errorMap: () => ({ message: "Choose how the payment was made." }),
  }),
  paidAt: paidAtSchema,
  reference: paymentReferenceSchema,
});
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

export const createChargeSchema = z.object({
  kind: z.enum(CHARGE_KINDS, {
    errorMap: () => ({ message: "Choose adjustment or waiver." }),
  }),
  description: z
    .string({ required_error: "Enter a description." })
    .trim()
    .min(1, "Enter a description.")
    .max(
      DESCRIPTION_MAX_LENGTH,
      `Keep the description under ${DESCRIPTION_MAX_LENGTH} characters.`,
    ),
  /** Always entered positive; a waiver is stored negative (DB-022). */
  amount: positiveAmountSchema,
  dueDate: calendarDateSchema("Enter the due date."),
});
export type CreateChargeInput = z.infer<typeof createChargeSchema>;

export const voidPaymentSchema = reasonFormSchema;
export type VoidPaymentInput = z.infer<typeof voidPaymentSchema>;

// --- Balances list ----------------------------------------------------------------------------------------------------

/** States the balances list can be filtered to; a student who is fully paid has no balance and is never listed. */
export const BALANCE_FEE_STATES = ["overdue", "outstanding", "credit"] as const;

export const BALANCE_SORT_FIELDS = ["overdueAmount", "oldestOverdueDays", "fullName"] as const;
export type BalanceSortField = (typeof BALANCE_SORT_FIELDS)[number];

const balanceSortSchema = z
  .string()
  .refine(
    (value) => {
      const spec = parseSort(value);
      return spec !== null && (BALANCE_SORT_FIELDS as readonly string[]).includes(spec.field);
    },
    `Sort by one of: ${BALANCE_SORT_FIELDS.join(", ")} (prefix with - for descending).`,
  )
  .transform((value) => parseSort(value)!);

export const balancesQuerySchema = z.object({
  feeState: z
    .enum(BALANCE_FEE_STATES, {
      errorMap: () => ({
        message: `feeState must be one of: ${BALANCE_FEE_STATES.join(", ")}.`,
      }),
    })
    .optional(),
  ageingBucket: z.preprocess(
    // A hand-typed `?ageingBucket=60+` arrives as "60 " because `+` means a space in a query string.
    (value) => (typeof value === "string" && value.trim() === "60" ? "60+" : value),
    z
      .enum(AGEING_BUCKETS, {
        errorMap: () => ({
          message: `ageingBucket must be one of: ${AGEING_BUCKETS.join(", ")}.`,
        }),
      })
      .optional(),
  ),
  programmeId: z.string().uuid("programmeId must be a programme id.").optional(),
  page: z.coerce
    .number({ invalid_type_error: "page must be a number." })
    .int("page must be a whole number.")
    .min(1, "page must be at least 1.")
    .default(1),
  pageSize: z.coerce
    .number({ invalid_type_error: "pageSize must be a number." })
    .int("pageSize must be a whole number.")
    .min(1, "pageSize must be at least 1.")
    .max(100, "pageSize can be at most 100.")
    .default(25),
  sort: balanceSortSchema.optional(),
});
export type BalancesQuery = z.infer<typeof balancesQuerySchema>;
