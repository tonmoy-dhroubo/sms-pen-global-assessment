import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shared/placeholder-page";

export const metadata: Metadata = { title: "Student record" };

// Placeholder until M09 (docs/milestones.md); the page's contents are specified in docs/pages.md.
export default function StudentrecordPage() {
  return (
    <PlaceholderPage
      title="Student record"
      description="Profile, fees, submissions, results and the activity timeline."
      milestone="M09"
    />
  );
}
