import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shared/placeholder-page";

export const metadata: Metadata = { title: "Fees" };

// Placeholder until M10 (docs/milestones.md); the page's contents are specified in docs/pages.md.
export default function FeesPage() {
  return (
    <PlaceholderPage
      title="Fees"
      description="Every student with a balance: outstanding or overdue, ageing and last payment."
      milestone="M10"
    />
  );
}
