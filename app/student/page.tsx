import type { Metadata } from "next";
import { StatusBadge } from "@/components/shared/status-badge";
import { PageHeader } from "@/components/shared/page-header";
import { DeadlinesCard } from "@/components/student/deadlines-card";
import { FeeBalanceCard } from "@/components/student/fee-balance-card";
import { LatestResultsCard } from "@/components/student/latest-results-card";
import { StatusNotice } from "@/components/student/status-notice";
import { requireStudentPage } from "@/lib/page-guards";
import { getMyOverview } from "@/lib/services/me";

export const metadata: Metadata = { title: "Overview" };

// The student's overview (pages.md `/student`): a greeting with Student ID, programme and status, a notice when they are
// deferred, withdrawn or completed, and three cards (fees, next deadlines, latest published results). Everything is read
// for the student in the session; the URL carries nothing that selects data.
export default async function OverviewPage() {
  const identity = await requireStudentPage();
  const { now, profile, fees, deadlines, latestResults } = await getMyOverview(identity.student.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Hello, ${profile.fullName}`}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              Student ID <span className="font-mono">{profile.studentNumber}</span>
            </span>
            <span aria-hidden="true">&middot;</span>
            <span>{profile.programme.name}</span>
            <span aria-hidden="true">&middot;</span>
            <span>
              Session {profile.academicYear}, year {profile.yearOfStudy}
            </span>
            <StatusBadge group="enrolment" value={profile.status} />
          </span>
        }
      />

      <StatusNotice status={profile.status} />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <FeeBalanceCard fees={fees} />
        <DeadlinesCard deadlines={deadlines} now={now} />
        <LatestResultsCard results={latestResults} />
      </div>
    </div>
  );
}
