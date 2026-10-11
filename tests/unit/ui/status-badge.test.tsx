// @vitest-environment jsdom
import "@/tests/support/dom";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BADGES, StatusBadge, badgeDefinition } from "@/components/shared/status-badge";
import type { StatusBadgeProps } from "@/components/shared/status-badge";

// docs/pages.md "Status badges": every group and value, its text label and its tone. The assessment group (open / past
// deadline / closed) is the open/closed badge of `/staff/assessments`, added in M12.
const SPEC = [
  ["enrolment", "ENROLLED", "Enrolled", "green"],
  ["enrolment", "DEFERRED", "Deferred", "amber"],
  ["enrolment", "WITHDRAWN", "Withdrawn", "grey"],
  ["enrolment", "COMPLETED", "Completed", "blue"],
  ["fees", "paid", "Paid", "green"],
  ["fees", "outstanding", "Outstanding", "grey"],
  ["fees", "overdue", "Overdue", "red"],
  ["fees", "credit", "Credit", "blue"],
  ["submission", "ON_TIME", "On time", "green"],
  ["submission", "LATE", "Late", "amber"],
  ["submission", "NOT_SUBMITTED", "Not submitted", "grey"],
  ["submission", "CLOSED", "Closed", "grey"],
  ["assessment", "open", "Open", "green"],
  ["assessment", "past-deadline", "Past deadline", "amber"],
  ["assessment", "closed", "Closed", "grey"],
  ["result", "DRAFT", "Draft", "grey"],
  ["result", "PUBLISHED", "Published", "blue"],
  ["result", "WITHHELD", "Withheld", "amber"],
  ["classification", "DISTINCTION", "Distinction", "neutral"],
  ["classification", "MERIT", "Merit", "neutral"],
  ["classification", "PASS", "Pass", "neutral"],
  ["classification", "FAIL", "Fail", "neutral"],
  ["classification", "NS", "NS", "neutral"],
] as const;

describe("StatusBadge", () => {
  it.each(SPEC)("%s / %s shows the text label %s in the %s tone", (group, value, label, tone) => {
    render(<StatusBadge {...({ group, value } as StatusBadgeProps)} />);
    const badge = screen.getByText(label);
    expect(badge.textContent).toBe(label);
    expect(badge.getAttribute("data-tone")).toBe(tone);
    expect(badge.getAttribute("data-group")).toBe(group);
  });

  it("covers exactly the values listed above and nothing else", () => {
    const defined = Object.entries(BADGES).flatMap(([group, values]) =>
      Object.keys(values).map((value) => `${group}/${value}`),
    );
    expect(defined.sort()).toEqual(SPEC.map(([group, value]) => `${group}/${value}`).sort());
  });

  it("shows how late a late submission is", () => {
    render(<StatusBadge group="submission" value="LATE" detail="2 days" />);
    expect(screen.getByText("Late").parentElement?.textContent).toBe("Late·2 days");
  });

  it("ignores the detail for a value that is not LATE", () => {
    render(<StatusBadge group="submission" value="ON_TIME" detail="2 days" />);
    expect(screen.queryByText("2 days")).toBeNull();
  });

  it("explains the NS abbreviation as a title", () => {
    render(<StatusBadge group="classification" value="NS" />);
    expect(screen.getByText("NS").getAttribute("title")).toBe("Non-submission");
  });

  it("still shows a readable label for a value it does not know", () => {
    render(
      <StatusBadge
        {...({ group: "enrolment", value: "ARCHIVED" } as unknown as StatusBadgeProps)}
      />,
    );
    expect(screen.getByText("ARCHIVED").getAttribute("data-tone")).toBe("grey");
    expect(badgeDefinition("nope", "x")).toBeUndefined();
  });

  it("merges a custom class name", () => {
    render(<StatusBadge group="fees" value="paid" className="ml-2" />);
    expect(screen.getByText("Paid").className).toContain("ml-2");
  });
});
