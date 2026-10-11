import { apiRequest } from "@/lib/client/api";
import type { ChargeResult, PaymentResult, VoidResult } from "@/lib/services/fees";
import type {
  CreateChargeInput,
  RecordPaymentInput,
  VoidPaymentInput,
} from "@/lib/validation/fees";

// Browser calls behind the payment, adjustment and void dialogs (api.md "Fees and payments"). Type-only imports
// above: nothing server-side is bundled.

export type { ChargeResult, PaymentResult, VoidResult };

type Warned<T> = Omit<T, "warnings"> & { warnings?: { code: string; message: string }[] };

export function recordPaymentRequest(
  studentId: string,
  body: RecordPaymentInput,
): Promise<Warned<PaymentResult>> {
  return apiRequest(`/api/students/${studentId}/payments`, { method: "POST", body });
}

export function addChargeRequest(
  studentId: string,
  body: CreateChargeInput,
): Promise<ChargeResult> {
  return apiRequest(`/api/students/${studentId}/charges`, { method: "POST", body });
}

export function voidPaymentRequest(paymentId: string, body: VoidPaymentInput): Promise<VoidResult> {
  return apiRequest(`/api/payments/${paymentId}/void`, { method: "POST", body });
}

/** The payment a `CONFLICT` on the reference points at (`details.existing`), defensively read. */
export interface ExistingPayment {
  id: string;
  reference: string;
  student: { id: string; studentNumber: string; fullName: string };
  amount: string;
  paidAt: string;
  voided: boolean;
}

export function existingPaymentFrom(
  details: Record<string, unknown> | undefined,
): ExistingPayment | null {
  const existing = details?.existing;
  if (!existing || typeof existing !== "object") return null;
  const value = existing as Partial<ExistingPayment>;
  if (typeof value.id !== "string" || !value.student || typeof value.student.id !== "string") {
    return null;
  }
  return value as ExistingPayment;
}
