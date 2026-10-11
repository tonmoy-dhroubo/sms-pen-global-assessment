import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shared/placeholder-page";

export const metadata: Metadata = { title: "Assessment" };

// Placeholder until M13 (docs/milestones.md); the page's contents are specified in docs/pages.md.
export default function AssessmentPage() {
  return (
    <PlaceholderPage
      title="Assessment"
      description="Submission history and receipts for one assessment."
      milestone="M13"
    />
  );
}
