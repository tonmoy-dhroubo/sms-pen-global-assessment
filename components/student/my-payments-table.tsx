import { DateTime } from "@/components/format/date-time";
import { Money } from "@/components/format/money";
import { EmptyState } from "@/components/shared/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { MyPaymentDto } from "@/lib/services/fees";
import { PAYMENT_METHOD_LABEL } from "@/lib/validation/fees";

// The student's payments, newest first. Only payments that count are ever sent: a payment the Registry corrected
// (voided) is not shown, and neither is who recorded anything.

export function MyPaymentsTable({ payments }: { payments: MyPaymentDto[] }) {
  if (payments.length === 0) {
    return (
      <EmptyState
        title="No payments yet"
        description="Payments appear here once the Registry has recorded them. Keep your bank or bKash reference until they do."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <caption className="sr-only">Your payments</caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Paid on</TableHead>
            <TableHead scope="col" className="text-right">
              Amount
            </TableHead>
            <TableHead scope="col">Method</TableHead>
            <TableHead scope="col">Reference</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {payments.map((payment) => (
            <TableRow key={payment.id}>
              <TableCell>
                <DateTime value={payment.paidAt} />
              </TableCell>
              <TableCell className="text-right">
                <Money value={payment.amount} />
              </TableCell>
              <TableCell>{PAYMENT_METHOD_LABEL[payment.method]}</TableCell>
              <TableCell className="font-mono text-xs">{payment.reference}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
