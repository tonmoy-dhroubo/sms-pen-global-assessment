import { ArrowLeftIcon, ConstructionIcon, PencilIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { DateTime } from "@/components/format/date-time";
import { StudentFeesCard } from "@/components/fees/student-fees-card";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { FeeStatus } from "@/components/students/fee-status";
import { StatusChangeDialog } from "@/components/students/status-change-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NotFoundError } from "@/lib/api/errors";
import { requireStaffPage } from "@/lib/page-guards";
import { getStudentFees } from "@/lib/services/fees";
import { getStudent } from "@/lib/services/students";

export const metadata: Metadata = { title: "Student record" };

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm break-words">{children}</dd>
    </div>
  );
}

/** A section whose content arrives in a later milestone (docs/milestones.md). */
function ComingSoon({
  title,
  description,
  milestone,
}: {
  title: string;
  description: string;
  milestone: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <ConstructionIcon className="size-4" aria-hidden="true" />
          Coming in {milestone}.
        </p>
      </CardContent>
    </Card>
  );
}

// The student record (pages.md `/staff/students/[id]`): the header with the profile and the status and fee badges, the
// edit and status actions, and the sections that later milestones fill in.
export default async function StudentRecordPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaffPage();
  const { id } = await params;

  const [student, fees] = await Promise.all([getStudent(id), getStudentFees(id)]).catch(
    (error: unknown) => {
      if (error instanceof NotFoundError) notFound();
      throw error;
    },
  );

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2.5">
          <Link href="/staff/students">
            <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
            Students
          </Link>
        </Button>
      </div>

      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {student.fullName}
            <StatusBadge group="enrolment" value={student.status} />
          </span>
        }
        description={<span className="font-mono">{student.studentNumber}</span>}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`/staff/students/${student.id}/edit`}>
                <PencilIcon data-icon="inline-start" aria-hidden="true" />
                Edit details
              </Link>
            </Button>
            <StatusChangeDialog
              studentId={student.id}
              studentName={student.fullName}
              status={student.status}
              version={student.version}
            />
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            <Detail label="Student ID">
              <span className="font-mono">{student.studentNumber}</span>
            </Detail>
            <Detail label="Status">
              <StatusBadge group="enrolment" value={student.status} />
            </Detail>
            <Detail label="Fees">
              <FeeStatus summary={fees.summary} />
            </Detail>
            <Detail label="Programme">{student.programme.name}</Detail>
            <Detail label="Session">{student.academicYear}</Detail>
            <Detail label="Year of study">Year {student.yearOfStudy}</Detail>
            <Detail label="Email">
              <a href={`mailto:${student.email}`} className="underline-offset-4 hover:underline">
                {student.email}
              </a>
            </Detail>
            <Detail label="Date of birth">
              <DateTime value={student.dateOfBirth} />
            </Detail>
          </dl>
        </CardContent>
      </Card>

      <StudentFeesCard studentId={student.id} studentName={student.fullName} fees={fees} />

      <div className="grid gap-6 lg:grid-cols-2">
        <ComingSoon
          title="Submissions"
          description="Each assessment's deadline, status, file versions and receipt."
          milestone="M13"
        />
        <ComingSoon
          title="Results"
          description="Grades, classification, release status and history."
          milestone="M14"
        />
      </div>
      <ComingSoon
        title="Activity timeline"
        description="Status changes, payments, voids, mark changes and releases."
        milestone="M16"
      />
    </div>
  );
}
