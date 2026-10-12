import { NotFoundError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { toCsv } from "@/lib/csv";
import { systemClock } from "@/lib/services/clock";
import type { Clock } from "@/lib/services/clock";
import { listBalances } from "@/lib/services/fees";
import { assertKnownId } from "@/lib/services/ids";
import { getMarksheet } from "@/lib/services/marks";
import type { AgeingBucket } from "@/lib/services/rules/fees";
import { instantToLocalDateTime, todayIn } from "@/lib/services/rules/time";
import type { BalancesQuery } from "@/lib/validation/fees";

// CSV exports for staff (api.md "Exports"): the overdue list and one assessment's marksheet. They read through the
// same services as the pages, so a file and the screen it came from always agree. Money is plain two-decimal text
// (`40000.00`, BDT in the heading) so a spreadsheet can add it up; dates are `YYYY-MM-DD`, moments are Dhaka time.

export interface CsvExport {
  filename: string;
  csv: string;
}

/** More rows than any real Registry has; it only bounds the in-memory work of one export. */
const EXPORT_ROWS = 100_000;

const STATUS_LABEL = {
  ENROLLED: "Enrolled",
  DEFERRED: "Deferred",
  WITHDRAWN: "Withdrawn",
  COMPLETED: "Completed",
} as const;

const SUBMISSION_LABEL = {
  ON_TIME: "On time",
  LATE: "Late",
  NOT_SUBMITTED: "Not submitted",
} as const;

const RELEASE_LABEL = { DRAFT: "Draft", PUBLISHED: "Published", WITHHELD: "Withheld" } as const;
const CLASSIFICATION_LABEL = {
  DISTINCTION: "Distinction",
  MERIT: "Merit",
  PASS: "Pass",
  FAIL: "Fail",
} as const;

/** `2026-10-12 11:01` in Dhaka time: sortable, and a spreadsheet reads it as a date. */
function dhakaStamp(iso: string | null): string | null {
  if (!iso) return null;
  const { date, time } = instantToLocalDateTime(new Date(iso));
  return `${date} ${time}`;
}

/** ASCII words for a file name (`cse101-essay-1`), so every browser saves it as is. */
function slug(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Students whose fees are overdue, longest overdue first, with the figures behind the ageing buckets. */
export async function exportOverdueCsv(
  filters: { programmeId?: string; ageingBucket?: AgeingBucket } = {},
  clock: Clock = systemClock,
): Promise<CsvExport> {
  const query: BalancesQuery = {
    feeState: "overdue",
    programmeId: filters.programmeId,
    ageingBucket: filters.ageingBucket,
    page: 1,
    pageSize: EXPORT_ROWS,
  };
  const { items } = await listBalances(query, clock);

  const csv = toCsv(
    [
      "Student ID",
      "Full name",
      "Email",
      "Programme code",
      "Programme",
      "Session",
      "Year of study",
      "Enrolment status",
      "Overdue amount (BDT)",
      "Oldest overdue (days)",
      "Ageing bucket",
      "Balance (BDT)",
      "Last payment date",
      "Last payment amount (BDT)",
    ],
    items.map((item) => [
      item.studentNumber,
      item.fullName,
      item.email,
      item.programme.code,
      item.programme.name,
      item.academicYear,
      item.yearOfStudy,
      STATUS_LABEL[item.status],
      item.feeSummary.overdueAmount,
      item.feeSummary.oldestOverdueDays,
      item.feeSummary.ageingBucket,
      item.feeSummary.balance,
      item.lastPayment?.paidAt,
      item.lastPayment?.amount,
    ]),
  );
  return { filename: `overdue-fees-${todayIn(clock())}.csv`, csv };
}

/** One assessment's marksheet as staff see it: every student on it, their submission and their mark. */
export async function exportMarksheetCsv(
  assessmentId: string,
  clock: Clock = systemClock,
): Promise<CsvExport> {
  assertKnownId(assessmentId, "Assessment");
  const [marksheet, assessment] = await Promise.all([
    getMarksheet(assessmentId),
    db.assessment.findUnique({
      where: { id: assessmentId },
      select: { title: true, module: { select: { code: true } } },
    }),
  ]);
  if (!assessment) throw new NotFoundError("Assessment not found.");

  const csv = toCsv(
    [
      "Student ID",
      "Full name",
      "Programme code",
      "Enrolment status",
      "Currently eligible",
      "Submission",
      "Late by",
      "Last submitted (Dhaka time)",
      "Mark",
      "Classification",
      "Release status",
      "Withheld reason",
      "Published at (Dhaka time)",
    ],
    marksheet.items.map((row) => [
      row.student.studentNumber,
      row.student.fullName,
      row.student.programme.code,
      STATUS_LABEL[row.student.status],
      row.eligible ? "Yes" : "No",
      SUBMISSION_LABEL[row.submission.status],
      row.submission.lateBy,
      dhakaStamp(row.submission.lastSubmittedAt),
      // A non-submission reads "NS", as on the marksheet screen; no mark yet is an empty cell.
      row.markId === null ? null : row.isNonSubmission ? "NS" : row.mark,
      row.classification === null
        ? null
        : row.isNonSubmission
          ? "NS"
          : CLASSIFICATION_LABEL[row.classification],
      row.releaseStatus ? RELEASE_LABEL[row.releaseStatus] : null,
      row.withheldReason,
      dhakaStamp(row.publishedAt),
    ]),
  );
  const name = [assessment.module.code, assessment.title].map(slug).filter(Boolean).join("-");
  return {
    filename: `marksheet-${name || "assessment"}-${todayIn(clock())}.csv`,
    csv,
  };
}
