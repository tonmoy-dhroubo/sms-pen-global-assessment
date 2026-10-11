import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shared/placeholder-page";

export const metadata: Metadata = { title: "Edit student" };

// Placeholder until M09 (docs/milestones.md); the page's contents are specified in docs/pages.md.
export default function EditstudentPage() {
  return (
    <PlaceholderPage
      title="Edit student"
      description="Update a student's details."
      milestone="M09"
    />
  );
}
