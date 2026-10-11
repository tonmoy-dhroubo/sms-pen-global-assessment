import { ConstructionIcon } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";

// A stand-in for a route whose real page arrives in a later milestone (docs/milestones.md). It names the page and
// the milestone, so the shell can be walked end to end before the pages exist.

export interface PlaceholderPageProps {
  title: string;
  /** What the page will show, in a sentence (from docs/pages.md). */
  description: string;
  /** The milestone that builds it, e.g. "M09". */
  milestone: string;
}

export function PlaceholderPage({ title, description, milestone }: PlaceholderPageProps) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />
      <EmptyState
        icon={ConstructionIcon}
        title={`Coming in ${milestone}`}
        description="This page is part of the build plan and has not been built yet."
      />
    </div>
  );
}
