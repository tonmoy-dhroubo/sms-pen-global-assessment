import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/api/errors";
import type { EnrolmentStatus } from "@/lib/services/rules/types";

// The signed-in student's own view of themselves (api.md "Student self-service"). Always scoped to one id taken
// from the session, never from the request.

export interface MyProfile {
  id: string;
  studentNumber: string;
  fullName: string;
  email: string;
  dateOfBirth: string;
  programme: { id: string; code: string; name: string };
  academicYear: string;
  yearOfStudy: number;
  status: EnrolmentStatus;
}

/**
 * What the student may do. M05 only knows the student's own status, so the single reason is `NOT_ENROLLED`;
 * per-assessment rules (closed, deadline passed, module not in programme) are answered by `/api/me/assessments`.
 */
export interface CanSubmit {
  allowed: boolean;
  reason: "NOT_ENROLLED" | null;
  message: string | null;
}

export function canSubmitFor(status: EnrolmentStatus): CanSubmit {
  if (status === "ENROLLED") return { allowed: true, reason: null, message: null };
  return {
    allowed: false,
    reason: "NOT_ENROLLED",
    message: "Only enrolled students can submit work.",
  };
}

export async function getMyProfile(studentId: string): Promise<MyProfile> {
  const student = await db.student.findUnique({
    where: { id: studentId },
    include: { programme: { select: { id: true, code: true, name: true } } },
  });
  if (!student) throw new NotFoundError("Student not found.");
  return {
    id: student.id,
    studentNumber: student.studentNumber,
    fullName: student.fullName,
    email: student.email,
    // `date` columns arrive as UTC midnight; the calendar day is the first 10 characters (DB-006).
    dateOfBirth: student.dateOfBirth.toISOString().slice(0, 10),
    programme: student.programme,
    academicYear: student.academicYear,
    yearOfStudy: student.yearOfStudy,
    status: student.status,
  };
}
