import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shared/placeholder-page";

export const metadata: Metadata = { title: "Results" };

// Placeholder until M15 (docs/milestones.md); the page's contents are specified in docs/pages.md.
export default function ResultsPage() {
  return (
    <PlaceholderPage
      title="Results"
      description="Your published marks and classifications."
      milestone="M15"
    />
  );
}
