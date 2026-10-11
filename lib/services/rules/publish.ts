import { Decimal, ZERO, sum, toDecimal, type MoneyValue } from "./money";
import type { ReleaseStatus } from "./types";

// Publish preview (DB-010, DB-012, edge-cases.md "Bulk publish preview"): what a publish would do, shown before the
// staff member confirms. A real publish releases the DRAFT and WITHHELD marks in scope; marks that are already
// PUBLISHED are left alone. Overdue fees only warn, never block (DB-012).

export interface PublishMark {
  markId: string;
  studentId: string;
  assessmentId: string;
  releaseStatus: ReleaseStatus;
}

/** A (student, assessment) pair that is in scope and should have a mark, whether or not one has been entered. */
export interface ExpectedMark {
  studentId: string;
  assessmentId: string;
}

export interface OverdueStudent {
  studentId: string;
  overdueAmount: MoneyValue;
}

export interface PublishPreviewInput {
  /** Existing marks in the publish scope. */
  marks: readonly PublishMark[];
  /** Pairs in scope that should have a mark; those without one are counted as missing. */
  expected: readonly ExpectedMark[];
  /** Students in scope who currently have an overdue fee balance. */
  overdueStudents: readonly OverdueStudent[];
}

export interface PublishWarning {
  code: "OVERDUE_FEES" | "MISSING_MARKS";
  message: string;
}

export interface PublishPreview {
  /** DRAFT + WITHHELD marks that a real run would publish. */
  toPublish: number;
  alreadyPublished: number;
  missingMarks: ExpectedMark[];
  /** Students with something to publish who also owe overdue fees. */
  overdueStudents: { studentId: string; overdueAmount: Decimal; marksToPublish: number }[];
  /** Total overdue across `overdueStudents`. */
  overdueTotal: Decimal;
  /** Warnings in the api.md `{ code, message }` shape; empty when there is nothing to flag. */
  warnings: PublishWarning[];
  /** For the dialog, e.g. "Publish 18 marks - 2 students have overdue fees, 3 marks missing". */
  summary: string;
}

const pairKey = (m: ExpectedMark) => `${m.studentId}|${m.assessmentId}`;

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export function buildPublishPreview(input: PublishPreviewInput): PublishPreview {
  const publishable = input.marks.filter((m) => m.releaseStatus !== "PUBLISHED");
  const alreadyPublished = input.marks.length - publishable.length;

  const haveMark = new Set(input.marks.map(pairKey));
  const missingMarks = input.expected.filter((e) => !haveMark.has(pairKey(e)));

  const marksByStudent = new Map<string, number>();
  for (const mark of publishable) {
    marksByStudent.set(mark.studentId, (marksByStudent.get(mark.studentId) ?? 0) + 1);
  }
  const overdueStudents = input.overdueStudents
    .map((s) => ({
      studentId: s.studentId,
      overdueAmount: toDecimal(s.overdueAmount),
      marksToPublish: marksByStudent.get(s.studentId) ?? 0,
    }))
    .filter((s) => s.marksToPublish > 0 && s.overdueAmount.greaterThan(0));

  const warnings: PublishWarning[] = [];
  const parts: string[] = [];
  if (overdueStudents.length > 0) {
    const text = `${count(overdueStudents.length, "student")} ${overdueStudents.length === 1 ? "has" : "have"} overdue fees`;
    parts.push(text);
    warnings.push({ code: "OVERDUE_FEES", message: `${text}.` });
  }
  if (missingMarks.length > 0) {
    const text = `${count(missingMarks.length, "mark")} missing`;
    parts.push(text);
    warnings.push({ code: "MISSING_MARKS", message: `${text}.` });
  }
  const headline = `Publish ${count(publishable.length, "mark")}`;

  return {
    toPublish: publishable.length,
    alreadyPublished,
    missingMarks,
    overdueStudents,
    overdueTotal:
      overdueStudents.length > 0 ? sum(overdueStudents.map((s) => s.overdueAmount)) : ZERO,
    warnings,
    summary: parts.length > 0 ? `${headline} - ${parts.join(", ")}` : headline,
  };
}
