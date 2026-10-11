import { ChargeDialog } from "@/components/fees/charge-dialog";
import { ChargesTable } from "@/components/fees/charges-table";
import { FeeSummaryStrip } from "@/components/fees/fee-summary-strip";
import { PaymentsTable } from "@/components/fees/payments-table";
import { RecordPaymentDialog } from "@/components/fees/record-payment-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { StudentFees } from "@/lib/services/fees";

// The Fees section of the student record (pages.md `/staff/students/[id]`): the summary, the charges, the payments
// (voided ones struck through) and the actions on them. It is rendered on the server from the current rows, and every
// action ends in `router.refresh()`, so the balance here and in the page header update without a full reload.

export interface StudentFeesCardProps {
  studentId: string;
  studentName: string;
  fees: StudentFees;
}

export function StudentFeesCard({ studentId, studentName, fees }: StudentFeesCardProps) {
  return (
    <section aria-labelledby="fees-heading">
      <Card>
        <CardHeader>
          <CardTitle id="fees-heading" className="text-base">
            Fees
          </CardTitle>
          <CardDescription>
            Calculated from the charges and payments below. Payments settle the oldest charge first.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <FeeSummaryStrip summary={fees.summary} />

          <div className="flex flex-wrap gap-2">
            <RecordPaymentDialog
              studentId={studentId}
              studentName={studentName}
              balance={fees.summary.balance}
            />
            <ChargeDialog studentId={studentId} studentName={studentName} />
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium">Charges</h3>
            <ChargesTable charges={fees.charges} />
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium">Payments</h3>
            <PaymentsTable payments={fees.payments} />
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
