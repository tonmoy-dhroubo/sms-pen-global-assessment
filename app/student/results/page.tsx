import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { MyResultsTable } from "@/components/student/my-results-table";
import { requireStudentPage } from "@/lib/page-guards";
import { getMyResults } from "@/lib/services/marks";

export const metadata: Metadata = { title: "Results" };

// The student's results (pages.md `/student/results`): published marks with their classification; every other
// assessment reads "Not yet available", with no mark and no reason. The service sends nothing more than that.
export default async function ResultsPage() {
  const identity = await requireStudentPage();
  const { items } = await getMyResults(identity.student.id);
  const published = items.filter((item) => item.status === "PUBLISHED").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Results"
        description={
          items.length === 0
            ? "Your published marks and classifications."
            : `${published} of ${items.length} ${items.length === 1 ? "result is" : "results are"} available.`
        }
      />
      <MyResultsTable items={items} />
    </div>
  );
}
