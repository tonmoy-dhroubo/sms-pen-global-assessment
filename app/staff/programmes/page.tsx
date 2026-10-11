import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shared/placeholder-page";

export const metadata: Metadata = { title: "Programmes" };

// Placeholder until M10 (docs/milestones.md); the page's contents are specified in docs/pages.md.
export default function ProgrammesPage() {
  return (
    <PlaceholderPage
      title="Programmes"
      description="Programmes with their modules and the fee schedule for each session."
      milestone="M10"
    />
  );
}
