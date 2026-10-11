import type { Metadata } from "next";
import { AgeingBreakdown } from "@/components/dashboard/ageing-breakdown";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { NeedsAttention } from "@/components/dashboard/needs-attention";
import { OverdueTable } from "@/components/dashboard/overdue-table";
import { PageHeader } from "@/components/shared/page-header";
import { requireStaffPage } from "@/lib/page-guards";
import { getDashboard } from "@/lib/services/dashboard";
import { formatDateTime } from "@/lib/services/rules/time";

export const metadata: Metadata = { title: "Dashboard" };

// The Registry's morning view (pages.md `/staff`). Reads the same service as `GET /api/dashboard`, and is rendered fresh
// on every request; recording a payment from the overdue table refreshes it.
export default async function DashboardPage() {
  await requireStaffPage();
  const dashboard = await getDashboard();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={`Where the Registry stands as of ${formatDateTime(new Date(dashboard.generatedAt))} (Asia/Dhaka).`}
      />

      <KpiCards kpis={dashboard.kpis} />
      <AgeingBreakdown ageing={dashboard.ageing} />

      <OverdueTable overdue={dashboard.overdue} />
      <NeedsAttention needsAttention={dashboard.needsAttention} now={dashboard.generatedAt} />
    </div>
  );
}
