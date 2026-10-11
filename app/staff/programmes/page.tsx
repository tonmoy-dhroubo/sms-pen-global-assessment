import { GraduationCapIcon } from "lucide-react";
import type { Metadata } from "next";
import { ProgrammeCard } from "@/components/programmes/programme-card";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { requireStaffPage } from "@/lib/page-guards";
import { listProgrammeDetails } from "@/lib/services/programmes";
import { sessionLabel, sessionStartYear } from "@/lib/services/rules/time";

export const metadata: Metadata = { title: "Programmes" };

/** The previous session, the current one and the next two: the ones worth adding a schedule for. */
function candidateSessions(now: Date): string[] {
  const current = sessionStartYear(now);
  return [current + 2, current + 1, current, current - 1].map(sessionLabel);
}

// Programmes with their modules and the fee schedule for each session (pages.md `/staff/programmes`). Editing a
// schedule affects only students enrolled afterwards; existing charges never change.
export default async function ProgrammesPage() {
  await requireStaffPage();

  const programmes = await listProgrammeDetails();
  const candidates = candidateSessions(new Date());

  return (
    <div className="space-y-6">
      <PageHeader
        title="Programmes"
        description="Programmes with their modules and the fee schedule for each session. Editing a schedule affects only students enrolled afterwards; existing charges never change."
      />

      {programmes.length === 0 ? (
        <EmptyState
          icon={GraduationCapIcon}
          title="No programmes yet"
          description="Programmes are set up with the seed data. Once one exists, its modules and fee schedules appear here."
        />
      ) : (
        programmes.map((programme) => (
          <ProgrammeCard
            key={programme.id}
            programme={programme}
            addableSessions={candidates.filter(
              (session) => !programme.feeSchedules.some((s) => s.academicYear === session),
            )}
          />
        ))
      )}
    </div>
  );
}
