import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { StudentForm } from "@/components/students/student-form";
import { NotFoundError } from "@/lib/api/errors";
import { requireStaffPage } from "@/lib/page-guards";
import { getStudent, listAcademicYears, listProgrammeOptions } from "@/lib/services/students";

export const metadata: Metadata = { title: "Edit student" };

// Edit form (pages.md `/staff/students/[id]/edit`). The form is keyed by the record's version, so "Reload latest"
// after a version conflict (router.refresh) starts it again from what is now stored.
export default async function EditStudentPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaffPage();
  const { id } = await params;

  const student = await getStudent(id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const [programmes, academicYears] = await Promise.all([
    listProgrammeOptions(),
    listAcademicYears(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Edit ${student.fullName}`}
        description={
          <Link href={`/staff/students/${student.id}`} className="underline underline-offset-4">
            Back to the student record
          </Link>
        }
      />
      <StudentForm
        key={student.version}
        mode={{
          kind: "edit",
          id: student.id,
          studentNumber: student.studentNumber,
          version: student.version,
        }}
        programmes={programmes}
        academicYears={academicYears}
        initialValues={{
          fullName: student.fullName,
          email: student.email,
          dateOfBirth: student.dateOfBirth,
          programmeId: student.programme.id,
          academicYear: student.academicYear,
          yearOfStudy: student.yearOfStudy,
        }}
      />
    </div>
  );
}
