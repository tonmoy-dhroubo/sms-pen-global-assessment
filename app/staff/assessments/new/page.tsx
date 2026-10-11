import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shared/placeholder-page";

export const metadata: Metadata = { title: "New assessment" };

// Placeholder until M12 (docs/milestones.md); the page's contents are specified in docs/pages.md.
export default function NewassessmentPage() {
  return (
    <PlaceholderPage
      title="New assessment"
      description="Choose a module, a title and a deadline in Asia/Dhaka time."
      milestone="M12"
    />
  );
}
