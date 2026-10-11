import { cn } from "@/lib/utils";
import type { Classification, EnrolmentStatus, ReleaseStatus } from "@/lib/services/rules/types";
import type { FeeState } from "@/lib/services/rules/fees";

// One badge for every status in the app (pages.md "Status badges"). A badge always shows its text label; the tone is
// an extra cue, never the only one (D-017). Tone colours are theme tokens in app/globals.css with light and dark
// variants whose text/background pairs are checked for 4.5:1 contrast by tests/unit/ui/tone-contrast.test.ts.

export type Tone = "green" | "amber" | "grey" | "blue" | "red" | "neutral";

export type SubmissionState = "ON_TIME" | "LATE" | "NOT_SUBMITTED" | "CLOSED";

/** A mark classification, or `NS` for a non-submission. */
export type ResultClassification = Classification | "NS";

interface BadgeDef {
  label: string;
  tone: Tone;
  /** Longer wording for assistive technology and the hover title, when the label is an abbreviation. */
  title?: string;
}

export const BADGES = {
  enrolment: {
    ENROLLED: { label: "Enrolled", tone: "green" },
    DEFERRED: { label: "Deferred", tone: "amber" },
    WITHDRAWN: { label: "Withdrawn", tone: "grey" },
    COMPLETED: { label: "Completed", tone: "blue" },
  },
  fees: {
    paid: { label: "Paid", tone: "green" },
    outstanding: { label: "Outstanding", tone: "grey" },
    overdue: { label: "Overdue", tone: "red" },
    credit: { label: "Credit", tone: "blue" },
  },
  submission: {
    ON_TIME: { label: "On time", tone: "green" },
    LATE: { label: "Late", tone: "amber" },
    NOT_SUBMITTED: { label: "Not submitted", tone: "grey" },
    CLOSED: { label: "Closed", tone: "grey" },
  },
  result: {
    DRAFT: { label: "Draft", tone: "grey" },
    PUBLISHED: { label: "Published", tone: "blue" },
    WITHHELD: { label: "Withheld", tone: "amber" },
  },
  classification: {
    DISTINCTION: { label: "Distinction", tone: "neutral" },
    MERIT: { label: "Merit", tone: "neutral" },
    PASS: { label: "Pass", tone: "neutral" },
    FAIL: { label: "Fail", tone: "neutral" },
    NS: { label: "NS", tone: "neutral", title: "Non-submission" },
  },
} as const satisfies Record<string, Record<string, BadgeDef>>;

export type StatusBadgeProps = { className?: string } & (
  | { group: "enrolment"; value: EnrolmentStatus }
  | { group: "fees"; value: FeeState }
  | {
      group: "submission";
      value: SubmissionState;
      /** For `LATE`: how late, e.g. "2 days" (from `lateBy`). Shown after the label. */
      detail?: string | null;
    }
  | { group: "result"; value: ReleaseStatus }
  | { group: "classification"; value: ResultClassification }
);

const TONE_CLASSES: Record<Tone, string> = {
  green: "bg-tone-green text-tone-green-foreground border-transparent",
  amber: "bg-tone-amber text-tone-amber-foreground border-transparent",
  grey: "bg-tone-grey text-tone-grey-foreground border-transparent",
  blue: "bg-tone-blue text-tone-blue-foreground border-transparent",
  red: "bg-tone-red text-tone-red-foreground border-transparent",
  neutral: "border-border bg-background text-foreground",
};

/** The label and tone for a group/value pair; `undefined` for a value the group does not define. */
export function badgeDefinition(group: string, value: string): BadgeDef | undefined {
  const defs = BADGES[group as keyof typeof BADGES] as Record<string, BadgeDef> | undefined;
  return defs?.[value];
}

export function StatusBadge(props: StatusBadgeProps) {
  const { group, value, className } = props;
  const def = badgeDefinition(group, value);
  // An unknown value (a new enum member the UI has not learned yet) still shows something readable.
  const label = def?.label ?? value;
  const tone = def?.tone ?? "grey";
  const detail = props.group === "submission" && value === "LATE" ? props.detail : null;

  return (
    <span
      data-slot="status-badge"
      data-group={group}
      data-tone={tone}
      title={def && "title" in def ? def.title : undefined}
      className={cn(
        "inline-flex h-5 w-fit shrink-0 items-center gap-1 rounded-4xl border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {label}
      {detail ? <span aria-hidden="true">&middot;</span> : null}
      {detail ? <span>{detail}</span> : null}
    </span>
  );
}
