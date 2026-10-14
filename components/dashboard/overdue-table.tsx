import { WalletIcon } from "lucide-react";
import Link from "next/link";
import { RecordPaymentDialog } from "@/components/fees/record-payment-dialog";
import { Money } from "@/components/format/money";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Dashboard } from "@/lib/services/dashboard";

// The longest-overdue students (pages.md `/staff`), with Record payment. Saving a payment refreshes the page, so the
// row, the KPI cards and the ageing bar all update without a reload. A withdrawn student who still owes stays here.

function days(count: number): string {
  return `${count} ${count === 1 ? "day" : "days"}`;
}

export function OverdueTable({ overdue }: { overdue: Dashboard["overdue"] }) {
  const more = overdue.total - overdue.items.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Overdue balances</CardTitle>
        <CardDescription>Longest overdue first.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {overdue.items.length === 0 ? (
          <EmptyState
            icon={WalletIcon}
            title="No overdue balances"
            description="Every charge that has fallen due is covered by payments."
          />
        ) : (
          <>
            {/* Phone width: a table would hide the amount and the action off-screen, so each student is a small card. */}
            <ul className="divide-y rounded-lg border sm:hidden">
              {overdue.items.map((item) => (
                <li key={item.id} className="space-y-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        href={`/staff/students/${item.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {item.fullName}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        <span className="font-mono">{item.studentNumber}</span>
                        <span title={item.programme.name}> &middot; {item.programme.code}</span>
                      </div>
                    </div>
                    <StatusBadge group="enrolment" value={item.status} />
                  </div>
                  <div className="flex items-end justify-between gap-2">
                    <div className="text-sm">
                      <Money value={item.overdueAmount} className="font-medium" />
                      <span className="block text-xs text-muted-foreground">
                        {days(item.oldestOverdueDays)} overdue &middot; {item.ageingBucket} days
                      </span>
                    </div>
                    <RecordPaymentDialog
                      studentId={item.id}
                      studentName={item.fullName}
                      balance={item.balance}
                      triggerVariant="outline"
                      triggerSize="sm"
                    />
                  </div>
                </li>
              ))}
            </ul>
            <Table className="max-sm:hidden">
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Overdue</TableHead>
                  <TableHead>Overdue for</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overdue.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="min-w-36">
                        <Link
                          href={`/staff/students/${item.id}`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {item.fullName}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          <span className="font-mono">{item.studentNumber}</span>
                          <span title={item.programme.name}> &middot; {item.programme.code}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge group="enrolment" value={item.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Money value={item.overdueAmount} />
                    </TableCell>
                    <TableCell>
                      <span className="tabular-nums">{days(item.oldestOverdueDays)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {item.ageingBucket} days
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <RecordPaymentDialog
                        studentId={item.id}
                        studentName={item.fullName}
                        balance={item.balance}
                        triggerVariant="outline"
                        triggerSize="sm"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-sm text-muted-foreground">
              {more > 0
                ? `Showing the ${overdue.items.length} longest overdue of ${overdue.total}. `
                : null}
              <Link
                href="/staff/fees?feeState=overdue"
                className="underline underline-offset-4 hover:text-foreground"
              >
                {more > 0 ? `See all ${overdue.total} overdue students` : "Open the fees overview"}
              </Link>
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
