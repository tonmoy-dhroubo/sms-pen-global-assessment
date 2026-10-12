import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { MyChargesTable } from "@/components/student/my-charges-table";
import { MyFeeSummary } from "@/components/student/my-fee-summary";
import { MyPaymentsTable } from "@/components/student/my-payments-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireStudentPage } from "@/lib/page-guards";
import { getMyFees } from "@/lib/services/fees";

export const metadata: Metadata = { title: "Fees" };

// The student's fees (pages.md `/student/fees`): the balance or credit, the next due date, the overdue message, every
// charge (waivers included) and the payments that count. Voided payments are never read, and nothing in the URL
// selects whose fees are shown.
export default async function FeesPage() {
  const identity = await requireStudentPage();
  const fees = await getMyFees(identity.student.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fees"
        description="Your charges, waivers and payments. Payments settle the oldest charge first."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <MyFeeSummary fees={fees} />
        </CardContent>
      </Card>

      <section className="space-y-2" aria-labelledby="charges-heading">
        <h2 id="charges-heading" className="text-lg font-semibold tracking-tight">
          Charges and waivers
        </h2>
        <MyChargesTable charges={fees.charges} />
      </section>

      <section className="space-y-2" aria-labelledby="payments-heading">
        <h2 id="payments-heading" className="text-lg font-semibold tracking-tight">
          Payments
        </h2>
        <MyPaymentsTable payments={fees.payments} />
      </section>
    </div>
  );
}
