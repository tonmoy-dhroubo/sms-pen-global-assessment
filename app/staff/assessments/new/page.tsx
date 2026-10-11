import type { Metadata } from "next";
import { NewAssessmentForm } from "@/components/assessments/new-assessment-form";
import { PageHeader } from "@/components/shared/page-header";
import { requireStaffPage } from "@/lib/page-guards";
import { systemClock } from "@/lib/services/clock";
import { listModules } from "@/lib/services/programmes";

export const metadata: Metadata = { title: "New assessment" };

// New assessment form (pages.md `/staff/assessments/new`): module, title, and a deadline typed in Asia/Dhaka time.
export default async function NewAssessmentPage() {
  await requireStaffPage();
  const modules = await listModules();

  return (
    <div className="space-y-6">
      <PageHeader
        title="New assessment"
        description="Choose a module, a title and a deadline. Enrolled students on programmes that include the module can then submit work."
      />
      <div className="max-w-2xl">
        <NewAssessmentForm
          modules={modules.map(({ id, code, title }) => ({ id, code, title }))}
          now={systemClock().toISOString()}
        />
      </div>
    </div>
  );
}
