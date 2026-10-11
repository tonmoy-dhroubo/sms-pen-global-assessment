import { effectiveDeadline, isLate, isPastDeadline } from "./deadlines";
import type { EnrolmentStatus } from "./types";

// Who may upload (api.md "Submissions and files", edge-cases.md "Submissions"). The same check runs at the
// upload-URL step and again at confirm, with `now` = the moment the file arrived (D-023).

export type UploadBlockReason =
  "NOT_ENROLLED" | "MODULE_NOT_IN_PROGRAMME" | "CLOSED" | "ON_TIME_LOCKED";

export interface UploadStudent {
  status: EnrolmentStatus;
  /** Ids of the modules in the student's programme. */
  programmeModuleIds: readonly string[];
}

export interface UploadAssessment {
  moduleId: string;
  deadline: Date;
  /** Set when staff closed the assessment: no uploads at all. */
  closedAt?: Date | null;
  /** This student's extension (DB-014), if any; makes the deadline extension-aware. */
  extensionDeadline?: Date | null;
}

export interface ExistingSubmission {
  /** When the latest file arrived (`Submission.lastSubmittedAt`). */
  lastSubmittedAt: Date;
}

export type UploadDecision =
  | {
      allowed: true;
      /** The upload would arrive after the deadline and be flagged late. */ late: boolean;
    }
  | { allowed: false; reason: UploadBlockReason };

/**
 * Decides whether a student may upload now. Checks run in this order, so the first failing rule is the reason:
 * not enrolled, module not in the programme, assessment closed, then an on-time submission that is locked because
 * the deadline has passed. A first submission after the deadline is allowed and flagged late; a late submission can
 * still be replaced.
 */
export function canUpload(
  student: UploadStudent,
  assessment: UploadAssessment,
  existingSubmission: ExistingSubmission | null | undefined,
  now: Date,
): UploadDecision {
  if (student.status !== "ENROLLED") return { allowed: false, reason: "NOT_ENROLLED" };
  if (!student.programmeModuleIds.includes(assessment.moduleId)) {
    return { allowed: false, reason: "MODULE_NOT_IN_PROGRAMME" };
  }
  if (assessment.closedAt) return { allowed: false, reason: "CLOSED" };

  const deadline = effectiveDeadline(
    assessment.deadline,
    assessment.extensionDeadline ? { newDeadline: assessment.extensionDeadline } : null,
  );
  const pastDeadline = isPastDeadline(now, deadline);
  if (existingSubmission && pastDeadline && !isLate(existingSubmission.lastSubmittedAt, deadline)) {
    return { allowed: false, reason: "ON_TIME_LOCKED" };
  }
  return { allowed: true, late: pastDeadline };
}
