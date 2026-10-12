// @vitest-environment jsdom
import "@/tests/support/dom";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DeadlinesCard } from "@/components/student/deadlines-card";
import { FeeBalanceCard } from "@/components/student/fee-balance-card";
import { LatestResultsCard } from "@/components/student/latest-results-card";
import { StatusNotice } from "@/components/student/status-notice";
import type { MyFees } from "@/lib/services/fees";
import type { PublishedResult } from "@/lib/services/me";
import type { MyAssessment } from "@/lib/services/submissions";

// The cards on the student's overview (pages.md `/student`): the fee card in its overdue, credit, outstanding and paid
// states, the deadlines and results cards, and the notice for a student who is not Enrolled.

const NOW = "2026-10-12T06:00:00.000Z";

function fees(summary: Partial<MyFees["summary"]>, overdue: MyFees["overdue"] = null): MyFees {
  return {
    now: NOW,
    summary: {
      charged: "320000.00",
      waived: "0.00",
      paid: "0.00",
      balance: "320000.00",
      credit: "0.00",
      overdueAmount: "0.00",
      oldestOverdueDays: null,
      nextDueDate: null,
      feeState: "outstanding",
      ...summary,
    },
    charges: [],
    payments: [],
    overdue,
  };
}

describe("FeeBalanceCard", () => {
  it("shows the overdue message, the amount and the next due date for an overdue student", () => {
    render(
      <FeeBalanceCard
        fees={fees(
          {
            feeState: "overdue",
            balance: "260000.00",
            overdueAmount: "100000.00",
            oldestOverdueDays: 45,
            nextDueDate: "2026-11-01",
          },
          {
            amount: "100000.00",
            days: 45,
            message: "Overdue by 45 days. Please contact the Registry office.",
          },
        )}
      />,
    );

    const card = screen.getByText("Fee balance").closest("[data-slot=fee-balance-card]")!;
    expect(within(card as HTMLElement).getByText("Overdue", { selector: "span" })).toBeTruthy();
    expect(
      screen.getByText("Overdue by 45 days. Please contact the Registry office."),
    ).toBeTruthy();
    expect(card.querySelector("[data-slot=overdue-message]")?.textContent).toContain(
      "৳1,00,000.00 is overdue.",
    );
    expect(screen.getByText("You owe")).toBeTruthy();
    expect(screen.getByText("৳2,60,000.00")).toBeTruthy();
    expect(screen.getByText(/1 Nov 2026/)).toBeTruthy();
    expect(screen.getByText(/in 20 days/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "View fee details" }).getAttribute("href")).toBe(
      "/student/fees",
    );
  });

  it("shows a credit as a credit, never as a negative balance", () => {
    render(
      <FeeBalanceCard
        fees={fees({
          feeState: "credit",
          balance: "-5000.00",
          credit: "5000.00",
          charged: "160000.00",
          paid: "165000.00",
        })}
      />,
    );

    expect(screen.getByText("Credit", { selector: "p" })).toBeTruthy();
    expect(screen.getByText("৳5,000.00")).toBeTruthy();
    expect(screen.queryByText(/-৳|−৳|\(৳/)).toBeNull();
    expect(screen.queryByText("You owe")).toBeNull();
    expect(screen.getByText("You have paid more than has been charged.")).toBeTruthy();
    expect(screen.queryByText(/Overdue by/)).toBeNull();
  });

  it("says nothing is due yet when the balance is outstanding but not overdue", () => {
    render(<FeeBalanceCard fees={fees({ nextDueDate: "2026-10-13" })} />);
    expect(screen.getByText("Nothing is due yet.")).toBeTruthy();
    expect(screen.getByText(/tomorrow/)).toBeTruthy();
    expect(screen.queryByText(/Overdue by/)).toBeNull();
  });

  it("says nothing is owed when the account is settled", () => {
    render(
      <FeeBalanceCard
        fees={fees({ feeState: "paid", balance: "0.00", charged: "0.00", paid: "0.00" })}
      />,
    );
    expect(screen.getByText("Nothing owed.")).toBeTruthy();
    expect(screen.queryByText(/Next due/)).toBeNull();
  });
});

function assessment(overrides: Partial<MyAssessment> & Pick<MyAssessment, "id">): MyAssessment {
  return {
    title: "Essay 1",
    module: { id: "m1", code: "ENG101", title: "Academic Writing" },
    deadline: "2026-10-14T17:59:00.000Z",
    extended: false,
    closedAt: null,
    state: "open",
    status: "NOT_SUBMITTED",
    lateBy: null,
    canUpload: { allowed: true, reason: null, message: null, late: false },
    submission: null,
    ...overrides,
  };
}

describe("DeadlinesCard", () => {
  it("lists each deadline with a countdown, its status, and a link to the assessment", () => {
    render(
      <DeadlinesCard
        now={NOW}
        deadlines={[
          assessment({ id: "a1", title: "Essay 1" }),
          assessment({ id: "a2", title: "Report 2", status: "ON_TIME" }),
        ]}
      />,
    );

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByRole("link", { name: "Essay 1" }).getAttribute("href")).toBe(
      "/student/assessments/a1",
    );
    expect(within(items[0]!).getByText("Not submitted")).toBeTruthy();
    expect(within(items[0]!).getByRole("timer").textContent).toBe("2d 11h 59m 0s");
    expect(within(items[1]!).getByText("On time")).toBeTruthy();
    expect(screen.getByRole("link", { name: "All assessments" }).getAttribute("href")).toBe(
      "/student/assessments",
    );
  });

  it("has an empty state when nothing is open", () => {
    render(<DeadlinesCard now={NOW} deadlines={[]} />);
    expect(screen.getByText("No open deadlines right now.")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });
});

function result(overrides: Partial<PublishedResult> = {}): PublishedResult {
  return {
    status: "PUBLISHED",
    assessment: { id: "a1", title: "Essay 1", module: { id: "m1", code: "ENG101", title: "W" } },
    mark: "62.5",
    isNonSubmission: false,
    classification: "MERIT",
    publishedAt: "2026-10-10T05:00:00.000Z",
    ...overrides,
  };
}

describe("LatestResultsCard", () => {
  it("shows the mark and classification of each published result, and NS for a non-submission", () => {
    render(
      <LatestResultsCard
        results={[
          result(),
          result({
            assessment: {
              id: "a2",
              title: "Report 2",
              module: { id: "m1", code: "ENG101", title: "W" },
            },
            mark: null,
            isNonSubmission: true,
            classification: "FAIL",
          }),
        ]}
      />,
    );

    const items = screen.getAllByRole("listitem");
    expect(within(items[0]!).getByText("62.5")).toBeTruthy();
    expect(within(items[0]!).getByText("Merit")).toBeTruthy();
    expect(within(items[1]!).getAllByText("NS").length).toBeGreaterThan(0);
    expect(within(items[1]!).queryByText("Fail")).toBeNull();
  });

  it("has an empty state when nothing has been published", () => {
    render(<LatestResultsCard results={[]} />);
    expect(screen.getByText("No results have been published yet.")).toBeTruthy();
  });
});

describe("StatusNotice", () => {
  it("renders nothing for an enrolled student", () => {
    const { container } = render(<StatusNotice status="ENROLLED" />);
    expect(container.innerHTML).toBe("");
  });

  it.each([
    ["DEFERRED", "Your studies are deferred", /contact the Registry office/],
    ["WITHDRAWN", "You have withdrawn from your programme", /re-admitted/],
    ["COMPLETED", "You have completed your programme", /Registry office/],
  ] as const)("explains what a %s student can and cannot do", (status, headline, action) => {
    render(<StatusNotice status={status} />);
    const notice = screen.getByRole("status");
    expect(within(notice).getByText(headline)).toBeTruthy();
    expect(within(notice).getByText(/can't upload new work/)).toBeTruthy();
    expect(within(notice).getByText(/published results/)).toBeTruthy();
    expect(within(notice).getByText(action)).toBeTruthy();
  });
});
