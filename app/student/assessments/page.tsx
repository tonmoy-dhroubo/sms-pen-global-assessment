import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shared/placeholder-page";

export const metadata: Metadata = { title: "Assessments" };

// Placeholder until M13 (docs/milestones.md); the page's contents are specified in docs/pages.md.
export default function AssessmentsPage() {
  return (
    <PlaceholderPage
      title="Assessments"
      description="Your deadlines, submission status and file upload."
      milestone="M13"
    />
  );
}
