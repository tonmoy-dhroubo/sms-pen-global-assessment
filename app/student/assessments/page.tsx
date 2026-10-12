import { ClipboardListIcon } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { SubmissionRules } from "@/components/submissions/submission-rules";
import { MyAssessmentCard } from "@/components/submissions/my-assessment-card";
import { requireStudentPage } from "@/lib/page-guards";
import { APP_TIME_ZONE } from "@/lib/services/rules/time";
import { listMyAssessments } from "@/lib/services/submissions";

export const metadata: Metadata = { title: "Assessments" };

// The student's assessments (pages.md `/student/assessments`): the deadline with a countdown, the status, the current
// file with its receipt summary, and Upload / Replace. The rules are written out in plain words at the top.
export default async function AssessmentsPage() {
  const identity = await requireStudentPage();
  const { now, items } = await listMyAssessments(identity.student.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Assessments"
        description={`Your deadlines, submission status and file upload. All times are in ${APP_TIME_ZONE}.`}
      />

      <SubmissionRules />

      {items.length === 0 ? (
        <EmptyState
          icon={ClipboardListIcon}
          title="No assessments yet"
          description="Assessments for your programme's modules appear here as soon as the Registry sets them up."
        />
      ) : (
        <ul className="space-y-4" aria-label="Your assessments">
          {items.map((assessment) => (
            <MyAssessmentCard key={assessment.id} assessment={assessment} serverNow={now} />
          ))}
        </ul>
      )}
    </div>
  );
}
