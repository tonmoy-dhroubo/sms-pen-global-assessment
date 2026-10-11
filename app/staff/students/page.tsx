import { PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { StudentFilters } from "@/components/students/student-filters";
import { StudentsTable } from "@/components/students/students-table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatSort } from "@/lib/list-params";
import { requireStaffPage } from "@/lib/page-guards";
import { listAcademicYears, listProgrammeOptions, listStudents } from "@/lib/services/students";
import { DEFAULT_STATUS_FILTER, studentListQuerySchema } from "@/lib/validation/students";

export const metadata: Metadata = { title: "Students" };

type SearchParams = Record<string, string | string[] | undefined>;

// The student list (pages.md `/staff/students`). Everything the user can change lives in the URL, so this page reads
// the same params the API does, through the same schema, and asks the service for that slice.
export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireStaffPage();

  const raw = await searchParams;
  const parsed = studentListQuerySchema.safeParse(raw);
  // A hand-edited address with a bad value shows the default list and says so, rather than an error page.
  const query = parsed.success ? parsed.data : studentListQuerySchema.parse({});

  const [list, programmes, academicYears] = await Promise.all([
    listStudents(query),
    listProgrammeOptions(),
    listAcademicYears(),
  ]);

  const statuses = query.status ?? [];
  const filtered =
    Boolean(query.q) ||
    Boolean(query.programmeId) ||
    Boolean(query.academicYear) ||
    Boolean(query.yearOfStudy) ||
    Boolean(query.feeState) ||
    (statuses.length > 0 &&
      !(
        statuses.length === DEFAULT_STATUS_FILTER.length &&
        DEFAULT_STATUS_FILTER.every((s) => statuses.includes(s))
      ));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Students"
        description="Search, filter and open student records."
        actions={
          <Button asChild>
            <Link href="/staff/students/new">
              <PlusIcon data-icon="inline-start" aria-hidden="true" />
              New student
            </Link>
          </Button>
        }
      />

      {!parsed.success ? (
        <Alert>
          <AlertDescription>
            Some search or filter values in the address were not understood and were ignored.
          </AlertDescription>
        </Alert>
      ) : null}

      <StudentFilters
        programmes={programmes}
        academicYears={academicYears}
        maxYearOfStudy={Math.max(...programmes.map((p) => p.durationYears), 4)}
      />

      <StudentsTable
        items={list.items}
        total={list.total}
        page={list.page}
        pageSize={list.pageSize}
        sort={formatSort(query.sort) ?? "fullName"}
        filtered={filtered}
      />
    </div>
  );
}
