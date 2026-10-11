import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shared/placeholder-page";

export const metadata: Metadata = { title: "Dashboard" };

// Placeholder until M11 (docs/milestones.md); the page's contents are specified in docs/pages.md.
export default function DashboardPage() {
  return (
    <PlaceholderPage
      title="Dashboard"
      description="KPI cards, the overdue table with ageing buckets and the needs-attention list."
      milestone="M11"
    />
  );
}
