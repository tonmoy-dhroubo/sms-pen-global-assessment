import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shared/placeholder-page";

export const metadata: Metadata = { title: "Students" };

// Placeholder until M09 (docs/milestones.md); the page's contents are specified in docs/pages.md.
export default function StudentsPage() {
  return (
    <PlaceholderPage
      title="Students"
      description="Search, filter and open student records."
      milestone="M09"
    />
  );
}
