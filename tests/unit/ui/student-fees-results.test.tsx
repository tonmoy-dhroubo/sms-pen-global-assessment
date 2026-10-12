// @vitest-environment jsdom
import "@/tests/support/dom";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MyChargesTable } from "@/components/student/my-charges-table";
import { MyFeeSummary } from "@/components/student/my-fee-summary";
import { MyPaymentsTable } from "@/components/student/my-payments-table";
import { MyResultsTable, NOT_AVAILABLE_TEXT } from "@/components/student/my-results-table";
import type { MyFees } from "@/lib/services/fees";
import type { MyResultItem } from "@/lib/services/marks";

const MODULE = { id: "m1", code: "ENG101", title: "Academic Writing" };

describe("MyResultsTable", () => {
  const published: MyResultItem = {
    status: "PUBLISHED",
    assessment: { id: "a1", title: "Essay 1", module: MODULE },
    mark: "62.5",
    isNonSubmission: false,
    classification: "MERIT",
    publishedAt: "2026-10-10T05:00:00.000Z",
  };
  const nonSubmission: MyResultItem = {
    status: "PUBLISHED",
    assessment: { id: "a2", title: "Report 2", module: MODULE },
    mark: null,
    isNonSubmission: true,
    classification: "FAIL",
    publishedAt: "2026-10-10T05:00:00.000Z",
  };
  const notAvailable: MyResultItem = {
    status: "NOT_AVAILABLE",
    assessment: { id: "a3", title: "Exam 3", module: MODULE },
  };

  it("shows the mark and classification of a published result", () => {
    render(<MyResultsTable items={[published]} />);
    const row = screen.getByRole("row", { name: /Essay 1/ });
    expect(within(row).getByText("62.5")).toBeTruthy();
    expect(within(row).getByText("Merit")).toBeTruthy();
    expect(within(row).getByText(/ENG101/)).toBeTruthy();
  });

  it("shows a non-submission as NS, not as a mark or a Fail", () => {
    render(<MyResultsTable items={[nonSubmission]} />);
    const row = screen.getByRole("row", { name: /Report 2/ });
    expect(within(row).getAllByText("NS").length).toBeGreaterThan(0);
    expect(within(row).queryByText("Fail")).toBeNull();
  });

  it("shows only 'Not yet available' for a result that is not published: no mark, no reason", () => {
    render(<MyResultsTable items={[notAvailable]} />);
    const row = screen.getByRole("row", { name: /Exam 3/ });
    expect(within(row).getByText(NOT_AVAILABLE_TEXT)).toBeTruthy();
    expect(within(row).queryByText("Merit")).toBeNull();
    expect(within(row).queryByRole("cell", { name: /^\d/ })).toBeNull();
    expect(row.querySelectorAll("[data-slot=status-badge]")).toHaveLength(0);
    // The row is the assessment's name, its module and the one phrase - nothing else.
    expect(row.textContent).toBe(`Exam 3ENG101 · Academic Writing${NOT_AVAILABLE_TEXT}`);
  });

  it("never renders a mark, classification or reason even if the data carried them", () => {
    // A draft or withheld mark must stay hidden even if a bug let extra fields through the API.
    const leaky = {
      status: "NOT_AVAILABLE",
      assessment: { id: "a4", title: "Exam 4", module: MODULE },
      mark: "12.5",
      classification: "FAIL",
      releaseStatus: "WITHHELD",
      withheldReason: "Academic misconduct investigation",
    } as unknown as MyResultItem;
    const { container } = render(<MyResultsTable items={[leaky]} />);
    expect(container.textContent).not.toContain("12.5");
    expect(container.textContent).not.toContain("Fail");
    expect(container.textContent).not.toContain("WITHHELD");
    expect(container.textContent).not.toContain("misconduct");
    expect(container.textContent).toContain(NOT_AVAILABLE_TEXT);
  });

  it("mixes published and unavailable rows in the order given", () => {
    render(<MyResultsTable items={[notAvailable, published]} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]!.textContent).toContain(NOT_AVAILABLE_TEXT);
    expect(rows[1]!.textContent).toContain("62.5");
  });

  it("has an empty state when the student has no assessments", () => {
    render(<MyResultsTable items={[]} />);
    expect(screen.getByText("No assessments yet")).toBeTruthy();
  });
});

describe("MyChargesTable", () => {
  it("labels a waiver and shows it as a reduction, without any staff name", () => {
    render(
      <MyChargesTable
        charges={[
          {
            id: "c1",
            kind: "PROGRAMME_FEE",
            academicYear: "2026-27",
            description: "Tuition - instalment 1",
            amount: "160000.00",
            dueDate: "2026-09-01",
          },
          {
            id: "c2",
            kind: "WAIVER",
            academicYear: "2026-27",
            description: "Merit scholarship",
            amount: "-20000.00",
            dueDate: "2026-09-01",
          },
        ]}
      />,
    );
    const waiver = screen.getByRole("row", { name: /Merit scholarship/ });
    expect(within(waiver).getByText("Waiver")).toBeTruthy();
    expect(within(waiver).getByText(/20,000\.00/).textContent).toMatch(/^-|−/);
    expect(screen.queryByText(/Added by/)).toBeNull();
  });

  it("has an empty state", () => {
    render(<MyChargesTable charges={[]} />);
    expect(screen.getByText("No charges yet")).toBeTruthy();
  });
});

describe("MyPaymentsTable", () => {
  it("shows the payment, method and reference, and nothing about who recorded it", () => {
    render(
      <MyPaymentsTable
        payments={[
          {
            id: "p1",
            amount: "60000.00",
            method: "BKASH",
            paidAt: "2026-09-02",
            reference: "TRX9F3",
          },
        ]}
      />,
    );
    const row = screen.getByRole("row", { name: /TRX9F3/ });
    expect(within(row).getByText("৳60,000.00")).toBeTruthy();
    expect(within(row).getByText("bKash")).toBeTruthy();
    expect(screen.queryByText(/Recorded by|Voided/)).toBeNull();
  });

  it("has an empty state", () => {
    render(<MyPaymentsTable payments={[]} />);
    expect(screen.getByText("No payments yet")).toBeTruthy();
  });
});

describe("MyFeeSummary", () => {
  const base: MyFees = {
    now: "2026-10-12T06:00:00.000Z",
    summary: {
      charged: "320000.00",
      waived: "20000.00",
      paid: "160000.00",
      balance: "140000.00",
      credit: "0.00",
      overdueAmount: "0.00",
      oldestOverdueDays: null,
      nextDueDate: "2026-11-01",
      feeState: "outstanding",
    },
    charges: [],
    payments: [],
    overdue: null,
  };

  it("shows the figures and the next due date", () => {
    render(<MyFeeSummary fees={base} />);
    expect(screen.getByText("Balance")).toBeTruthy();
    expect(screen.getByText("Balance").nextElementSibling?.textContent).toBe("৳1,40,000.00");
    expect(screen.getByText(/1 Nov 2026/)).toBeTruthy();
    expect(screen.getByText(/is outstanding, but nothing is due yet/)).toBeTruthy();
  });

  it("shows the overdue message", () => {
    render(
      <MyFeeSummary
        fees={{
          ...base,
          summary: { ...base.summary, feeState: "overdue", overdueAmount: "40000.00" },
          overdue: {
            amount: "40000.00",
            days: 1,
            message: "Overdue by 1 day. Please contact the Registry office.",
          },
        }}
      />,
    );
    expect(screen.getByText("Overdue by 1 day. Please contact the Registry office.")).toBeTruthy();
  });

  it("labels a credit as Credit", () => {
    render(
      <MyFeeSummary
        fees={{
          ...base,
          summary: {
            ...base.summary,
            feeState: "credit",
            balance: "-5000.00",
            credit: "5000.00",
            nextDueDate: null,
          },
        }}
      />,
    );
    expect(screen.getByText("Credit", { selector: "dt" })).toBeTruthy();
    expect(screen.getByText(/You have paid/)).toBeTruthy();
    expect(screen.getByText("Nothing due")).toBeTruthy();
  });
});
