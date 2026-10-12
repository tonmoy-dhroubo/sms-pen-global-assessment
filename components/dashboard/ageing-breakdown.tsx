import { CircleCheckIcon } from "lucide-react";
import Link from "next/link";
import { Money } from "@/components/format/money";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Dashboard } from "@/lib/services/dashboard";
import type { AgeingBucket } from "@/lib/services/rules/fees";
import { Decimal } from "@/lib/services/rules/money";
import { cn } from "@/lib/utils";

// Debt ageing (edge-cases.md Fees "S"): overdue students and money split into 1-30, 31-60 and 60+ days. A segmented bar
// rather than a Recharts chart: three numbers do not need a charting library, a bar is plain markup that renders the
// same on the server and in print, and the legend beside it carries every figure as text, so the colour is only a cue.
// Segment width follows the overdue amount.

const BUCKET_STYLE: Record<AgeingBucket, { label: string; swatch: string }> = {
  "1-30": { label: "1–30 days", swatch: "bg-ageing-1" },
  "31-60": { label: "31–60 days", swatch: "bg-ageing-2" },
  "60+": { label: "Over 60 days", swatch: "bg-ageing-3" },
};

export function AgeingBreakdown({ ageing }: { ageing: Dashboard["ageing"] }) {
  const totalStudents = ageing.reduce((sum, bucket) => sum + bucket.students, 0);
  const totalAmount = ageing.reduce((sum, bucket) => sum.plus(bucket.amount), new Decimal(0));
  const summary = ageing
    .map((bucket) => `${BUCKET_STYLE[bucket.bucket].label}: ${bucket.students}`)
    .join(", ");

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Overdue ageing</h2>
        </CardTitle>
        <CardDescription>
          How long overdue balances have been unpaid, counted from the oldest unpaid charge.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {totalStudents === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CircleCheckIcon className="size-4 shrink-0" aria-hidden="true" />
            No overdue balances. Every charge that has fallen due is covered.
          </p>
        ) : (
          <>
            <div
              role="img"
              aria-label={`Overdue students by age: ${summary}`}
              className="flex h-4 w-full gap-0.5 overflow-hidden rounded-full"
            >
              {ageing.map((bucket) => {
                const share = totalAmount.isZero()
                  ? 0
                  : new Decimal(bucket.amount).div(totalAmount).times(100).toNumber();
                return bucket.students === 0 ? null : (
                  <div
                    key={bucket.bucket}
                    className={cn("h-full", BUCKET_STYLE[bucket.bucket].swatch)}
                    // A very small bucket is still visible.
                    style={{ width: `${Math.max(share, 3)}%` }}
                  />
                );
              })}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {ageing.map((bucket) => (
                <div key={bucket.bucket} className="flex items-start gap-2">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-1 size-3 shrink-0 rounded-full",
                      BUCKET_STYLE[bucket.bucket].swatch,
                    )}
                  />
                  <dl>
                    <dt className="text-sm font-medium">{BUCKET_STYLE[bucket.bucket].label}</dt>
                    <dd className="text-sm tabular-nums">
                      {bucket.students} {bucket.students === 1 ? "student" : "students"}
                    </dd>
                    <dd className="text-sm text-muted-foreground">
                      <Money value={bucket.amount} />
                    </dd>
                  </dl>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              <Link href="/staff/fees?feeState=overdue" className="underline underline-offset-4">
                Open the fees overview
              </Link>{" "}
              and filter by ageing bucket to see who is in each one.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
