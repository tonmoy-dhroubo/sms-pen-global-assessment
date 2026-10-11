import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { StudentForm } from "@/components/students/student-form";
import { requireStaffPage } from "@/lib/page-guards";
import { sessionFor } from "@/lib/services/rules/time";
import { listAcademicYears, listProgrammeOptions } from "@/lib/services/students";

export const metadata: Metadata = { title: "New student" };

// New student form (pages.md `/staff/students/new`). The session starts as the current one; the Student ID is
// assigned by the server when the form is saved.
export default async function NewStudentPage() {
  await requireStaffPage();
  const [programmes, academicYears] = await Promise.all([
    listProgrammeOptions(),
    listAcademicYears(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="New student"
        description="Enrol a student. Fee charges are created from the programme's fee schedule for the session."
      />
      <StudentForm
        mode={{ kind: "create" }}
        programmes={programmes}
        academicYears={academicYears}
        initialValues={{ academicYear: sessionFor(new Date()) }}
      />
    </div>
  );
}
