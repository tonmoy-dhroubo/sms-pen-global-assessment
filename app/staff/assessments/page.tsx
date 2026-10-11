import { PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AssessmentFilters } from "@/components/assessments/assessment-filters";
import { AssessmentsTable } from "@/components/assessments/assessments-table";
import { PageHeader } from "@/components/shared/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatSort } from "@/lib/list-params";
import { requireStaffPage } from "@/lib/page-guards";
import { systemClock } from "@/lib/services/clock";
import { listAssessments } from "@/lib/services/assessments";
import { listModules } from "@/lib/services/programmes";
import { assessmentListQuerySchema } from "@/lib/validation/assessments";

export const metadata: Metadata = { title: "Assessments" };

type SearchParams = Record<string, string | string[] | undefined>;

// The assessment list (pages.md `/staff/assessments`). Filters, sort and page live in the URL, so this page reads the
// same params the API does, through the same schema, and asks the service for that slice.
export default async function AssessmentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireStaffPage();

  const parsed = assessmentListQuerySchema.safeParse(await searchParams);
  // A hand-edited address with a bad value shows the default list and says so, rather than an error page.
  const query = parsed.success ? parsed.data : assessmentListQuerySchema.parse({});

  const now = systemClock();
  const [list, modules] = await Promise.all([listAssessments(query, () => now), listModules()]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Assessments"
        description="Deadlines, submissions and marking progress for every module."
        actions={
          <Button asChild>
            <Link href="/staff/assessments/new">
              <PlusIcon data-icon="inline-start" aria-hidden="true" />
              New assessment
            </Link>
          </Button>
        }
      />

      {!parsed.success ? (
        <Alert>
          <AlertDescription>
            Some filter values in the address were not understood and were ignored.
          </AlertDescription>
        </Alert>
      ) : null}

      <AssessmentFilters modules={modules.map(({ id, code, title }) => ({ id, code, title }))} />

      <AssessmentsTable
        items={list.items}
        total={list.total}
        page={list.page}
        pageSize={list.pageSize}
        sort={formatSort(query.sort) ?? "-deadline"}
        now={now.toISOString()}
        filtered={Boolean(query.moduleId || query.state)}
      />
    </div>
  );
}
