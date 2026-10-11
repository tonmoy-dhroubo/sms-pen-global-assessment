import { DateTime } from "@/components/format/date-time";
import { Money } from "@/components/format/money";
import { VoidedBadge } from "@/components/fees/voided-badge";
import { VoidPaymentButton } from "@/components/fees/void-payment-button";
import { EmptyState } from "@/components/shared/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PaymentDto } from "@/lib/services/fees";
import { PAYMENT_METHOD_LABEL } from "@/lib/validation/fees";
import { cn } from "@/lib/utils";

// A student's payments, newest first. A voided payment is never removed: it stays, struck through, with a "Voided"
// marker whose tooltip gives the reason, and it counts toward nothing. Each row has an id (`payment-<id>`) so the
// "view the existing payment" link from a duplicate-reference error lands on it and highlights it.

export function PaymentsTable({ payments }: { payments: PaymentDto[] }) {
  if (payments.length === 0) {
    return (
      <EmptyState
        title="No payments recorded"
        description="Use Record payment when money arrives. Mistakes are voided with a reason, never deleted."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <caption className="sr-only">Payments</caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Paid on</TableHead>
            <TableHead scope="col" className="text-right">
              Amount
            </TableHead>
            <TableHead scope="col">Method</TableHead>
            <TableHead scope="col">Reference</TableHead>
            <TableHead scope="col">Recorded by</TableHead>
            <TableHead scope="col">Status</TableHead>
            <TableHead scope="col">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {payments.map((payment) => {
            const voided = payment.voidedAt !== null;
            const struck = cn(voided && "text-muted-foreground line-through");
            return (
              <TableRow
                key={payment.id}
                id={`payment-${payment.id}`}
                data-voided={voided || undefined}
                className="scroll-mt-24 target:bg-accent target:outline-2 target:-outline-offset-2 target:outline-ring"
              >
                <TableCell className={struck}>
                  <DateTime value={payment.paidAt} />
                </TableCell>
                <TableCell className={cn("text-right", struck)}>
                  <Money value={payment.amount} />
                </TableCell>
                <TableCell className={struck}>{PAYMENT_METHOD_LABEL[payment.method]}</TableCell>
                <TableCell className={cn("font-mono text-xs", struck)}>
                  {payment.reference}
                </TableCell>
                <TableCell>
                  <span className="block">{payment.recordedBy.fullName}</span>
                  <span className="block text-xs text-muted-foreground">
                    <DateTime value={payment.recordedAt} />
                  </span>
                </TableCell>
                <TableCell>
                  {voided ? (
                    <VoidedBadge voidedAt={payment.voidedAt!} reason={payment.voidReason} />
                  ) : (
                    <span className="text-sm text-muted-foreground">Recorded</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {voided ? null : (
                    <VoidPaymentButton
                      paymentId={payment.id}
                      amount={payment.amount}
                      reference={payment.reference}
                    />
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
