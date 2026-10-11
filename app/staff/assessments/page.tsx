import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shared/placeholder-page";

export const metadata: Metadata = { title: "Assessments" };

// Placeholder until M12 (docs/milestones.md); the page's contents are specified in docs/pages.md.
export default function AssessmentsPage() {
  return (
    <PlaceholderPage
      title="Assessments"
      description="Modules, deadlines, submission counts and marking progress."
      milestone="M12"
    />
  );
}
