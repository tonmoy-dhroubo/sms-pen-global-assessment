import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/api/errors";
import { systemClock } from "@/lib/services/clock";
import type { Clock } from "@/lib/services/clock";
import { getMyFees } from "@/lib/services/fees";
import type { MyFees } from "@/lib/services/fees";
import { getMyResults } from "@/lib/services/marks";
import type { MyResultItem } from "@/lib/services/marks";
import type { EnrolmentStatus } from "@/lib/services/rules/types";
import { listMyAssessments } from "@/lib/services/submissions";
import type { MyAssessment } from "@/lib/services/submissions";

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

// --- The overview page ----------------------------------------------------------------------------------------------

/** How many upcoming deadlines and latest results the overview shows. */
export const OVERVIEW_ITEMS = 3;

export type PublishedResult = Extract<MyResultItem, { status: "PUBLISHED" }>;

/** Everything `/student` shows, for the signed-in student only. */
export interface MyOverview {
  /** The server's "now" (ISO), shared by the fee date maths and the deadline countdowns. */
  now: string;
  profile: MyProfile;
  canSubmit: CanSubmit;
  fees: MyFees;
  /** The next open assessments by the student's own deadline, nearest first. */
  deadlines: MyAssessment[];
  /** The most recently published results, newest first. Draft and withheld marks never appear. */
  latestResults: PublishedResult[];
}

/**
 * The overview: fee position, the next three open deadlines and the latest three published results. "Open" is the
 * student's own `state` (their extension counted): the deadline is ahead and uploads are not closed.
 */
export async function getMyOverview(
  studentId: string,
  clock: Clock = systemClock,
): Promise<MyOverview> {
  const now = clock();
  const [profile, fees, assessments, results] = await Promise.all([
    getMyProfile(studentId),
    getMyFees(studentId, () => now),
    listMyAssessments(studentId, () => now),
    getMyResults(studentId),
  ]);

  const deadlines = assessments.items
    .filter((item) => item.state === "open")
    .sort(
      (a, b) =>
        new Date(a.deadline).getTime() - new Date(b.deadline).getTime() || a.id.localeCompare(b.id),
    )
    .slice(0, OVERVIEW_ITEMS);
  const latestResults = results.items
    .filter((item): item is PublishedResult => item.status === "PUBLISHED")
    .sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime() ||
        a.assessment.id.localeCompare(b.assessment.id),
    )
    .slice(0, OVERVIEW_ITEMS);

  return {
    now: now.toISOString(),
    profile,
    canSubmit: canSubmitFor(profile.status),
    fees,
    deadlines,
    latestResults,
  };
}
