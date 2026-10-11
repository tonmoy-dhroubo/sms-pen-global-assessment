import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shared/placeholder-page";

export const metadata: Metadata = { title: "New student" };

// Placeholder until M09 (docs/milestones.md); the page's contents are specified in docs/pages.md.
export default function NewstudentPage() {
  return (
    <PlaceholderPage
      title="New student"
      description="Create a student; the Student ID is assigned on save."
      milestone="M09"
    />
  );
}
