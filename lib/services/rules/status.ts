import type { EnrolmentStatus } from "./types";

// Enrolment status transitions, exactly as the table in docs/api.md. Every change is written to STATUS_CHANGE by the
// service; this module only decides what is allowed and whether a reason is needed.
//
//   Enrolled  -> Deferred (reason), Withdrawn (reason), Completed
//   Deferred  -> Enrolled (return), Withdrawn (reason)
//   Withdrawn -> Enrolled (re-admission, reason)
//   Completed -> nothing (final)

interface TransitionRule {
  reasonRequired: boolean;
}

const TRANSITIONS: Record<EnrolmentStatus, Partial<Record<EnrolmentStatus, TransitionRule>>> = {
  ENROLLED: {
    DEFERRED: { reasonRequired: true },
    WITHDRAWN: { reasonRequired: true },
    COMPLETED: { reasonRequired: false },
  },
  DEFERRED: {
    ENROLLED: { reasonRequired: false },
    WITHDRAWN: { reasonRequired: true },
  },
  WITHDRAWN: {
    ENROLLED: { reasonRequired: true }, // re-admission
  },
  COMPLETED: {}, // final
};

export type TransitionRefusal = "NO_CHANGE" | "NOT_ALLOWED";

export type TransitionCheck =
  { allowed: true; reasonRequired: boolean } | { allowed: false; code: TransitionRefusal };

/** Whether `from -> to` is a permitted transition, and whether it needs a reason. */
export function transitionRule(from: EnrolmentStatus, to: EnrolmentStatus): TransitionCheck {
  if (from === to) return { allowed: false, code: "NO_CHANGE" };
  const rule = TRANSITIONS[from][to];
  if (!rule) return { allowed: false, code: "NOT_ALLOWED" };
  return { allowed: true, reasonRequired: rule.reasonRequired };
}

/** The statuses a student can move to from `from`, for the status dialog ("allowed transitions only"). */
export function allowedTransitions(
  from: EnrolmentStatus,
): { to: EnrolmentStatus; reasonRequired: boolean }[] {
  return (Object.entries(TRANSITIONS[from]) as [EnrolmentStatus, TransitionRule][]).map(
    ([to, rule]) => ({
      to,
      reasonRequired: rule.reasonRequired,
    }),
  );
}

/** Full check for a requested change: allowed, and a non-blank reason supplied where one is required. */
export function checkTransition(
  from: EnrolmentStatus,
  to: EnrolmentStatus,
  reason?: string | null,
): { ok: true } | { ok: false; code: TransitionRefusal | "REASON_REQUIRED" } {
  const rule = transitionRule(from, to);
  if (!rule.allowed) return { ok: false, code: rule.code };
  if (rule.reasonRequired && !reason?.trim()) return { ok: false, code: "REASON_REQUIRED" };
  return { ok: true };
}
