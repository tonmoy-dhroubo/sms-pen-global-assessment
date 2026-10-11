import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shared/placeholder-page";

export const metadata: Metadata = { title: "Overview" };

// Placeholder until M15 (docs/milestones.md); the page's contents are specified in docs/pages.md.
export default function OverviewPage() {
  return (
    <PlaceholderPage
      title="Overview"
      description="Your fee balance, next deadlines and latest published results."
      milestone="M15"
    />
  );
}
