// @vitest-environment jsdom
import "@/tests/support/dom";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgeingBreakdown } from "@/components/dashboard/ageing-breakdown";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { NeedsAttention } from "@/components/dashboard/needs-attention";
import { OverdueTable } from "@/components/dashboard/overdue-table";
import type { Dashboard } from "@/lib/services/dashboard";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const NOW = "2026-10-12T04:00:00.000Z";

const MODULE = { id: "m1", code: "ENG101", title: "English Composition" };
const ASSESSMENT = { id: "a1", title: "Essay 1", module: MODULE };
const STUDENT = { id: "s1", studentNumber: "SMS-2026-0002", fullName: "Tanvir Hasan" };

const kpis: Dashboard["kpis"] = {
  students: { enrolled: 21, deferred: 3, withdrawn: 3, completed: 3 },
  outstanding: { amount: "1815000.00", students: 11 },
  overdue: { students: 8, amount: "1115000.00" },
  lateSubmissions: { count: 6, windowDays: 14, since: "2026-09-28T04:00:00.000Z" },
  resultsAwaitingPublication: { draftMarks: 27, assessments: 2, withheldMarks: 2 },
};

const ageing: Dashboard["ageing"] = [
  { bucket: "1-30", students: 4, amount: "615000.00" },
  { bucket: "31-60", students: 2, amount: "210000.00" },
  { bucket: "60+", students: 2, amount: "290000.00" },
];

const overdue: Dashboard["overdue"] = {
  total: 12,
  items: [
    {
      id: "s9",
      studentNumber: "SMS-2025-0029",
      fullName: "Habib Ullah",
      programme: { id: "p3", code: "BA-ENG", name: "BA (Hons) in English" },
      status: "WITHDRAWN",
      overdueAmount: "90000.00",
      balance: "90000.00",
      oldestOverdueDays: 120,
      ageingBucket: "60+",
    },
  ],
};

const needsAttention: Dashboard["needsAttention"] = {
  lateSubmissions: {
    total: 3,
    items: [
      {
        submissionId: "sub1",
        student: STUDENT,
        assessment: ASSESSMENT,
        submittedAt: "2026-10-10T04:00:00.000Z",
        deadline: "2026-10-08T04:00:00.000Z",
        lateBy: "2 days",
        href: "/staff/assessments/a1",
      },
    ],
  },
  withheldResults: {
    total: 1,
    items: [
      {
        markId: "mk1",
        student: STUDENT,
        assessment: ASSESSMENT,
        reason: "Outstanding fees",
        href: "/staff/students/s1",
      },
    ],
  },
  draftAssessments: {
    total: 1,
    items: [
      {
        assessment: { ...ASSESSMENT, deadline: "2026-10-05T17:59:00.000Z" },
        draftMarks: 10,
        href: "/staff/assessments/a1",
      },
    ],
  },
};

describe("KpiCards", () => {
  it("shows each figure with its label and the related statuses", () => {
    render(<KpiCards kpis={kpis} />);
    const group = screen.getByRole("region", { name: "Key figures" });
    expect(within(group).getByText("Enrolled students").nextSibling?.textContent).toBe("21");
    expect(within(group).getByText("3 deferred · 3 withdrawn · 3 completed")).toBeTruthy();
    expect(within(group).getByText("৳18,15,000.00")).toBeTruthy();
    expect(within(group).getByText("Overdue students").nextSibling?.textContent).toBe("8");
    expect(within(group).getByText("Late submissions").nextSibling?.textContent).toBe("6");
    expect(within(group).getByText("In the last 14 days")).toBeTruthy();
    expect(within(group).getByText("27 draft marks in 2 assessments · 2 withheld")).toBeTruthy();
    expect(within(group).getByRole("link", { name: "View overdue" }).getAttribute("href")).toBe(
      "/staff/fees?feeState=overdue",
    );
  });
});

describe("AgeingBreakdown", () => {
  it("states every bucket's students and amount in text", () => {
    render(<AgeingBreakdown ageing={ageing} />);
    expect(
      screen.getByRole("img", { name: /1–30 days: 4, 31–60 days: 2, Over 60 days: 2/ }),
    ).toBeTruthy();
    expect(screen.getByText("1–30 days")).toBeTruthy();
    expect(screen.getByText("4 students")).toBeTruthy();
    expect(screen.getByText("৳6,15,000.00")).toBeTruthy();
    expect(screen.getByText("৳2,90,000.00")).toBeTruthy();
  });

  it("says so when nobody is overdue", () => {
    render(
      <AgeingBreakdown
        ageing={ageing.map((bucket) => ({ ...bucket, students: 0, amount: "0.00" }))}
      />,
    );
    expect(screen.getByText(/No overdue balances/)).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("OverdueTable", () => {
  it("lists students with their age and a Record payment action, and links to the full list", () => {
    render(<OverdueTable overdue={overdue} />);
    const row = screen.getByRole("row", { name: /Habib Ullah/ });
    expect(within(row).getByRole("link", { name: "Habib Ullah" }).getAttribute("href")).toBe(
      "/staff/students/s9",
    );
    expect(within(row).getByText("Withdrawn")).toBeTruthy(); // a withdrawn student who still owes stays listed
    expect(within(row).getByText("৳90,000.00")).toBeTruthy();
    expect(within(row).getByText("120 days")).toBeTruthy();
    expect(within(row).getByText("60+ days")).toBeTruthy();
    expect(within(row).getByRole("button", { name: /Record payment/ })).toBeTruthy();
    expect(screen.getByText(/Showing the 1 longest overdue of 12/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "See all 12 overdue students" }).getAttribute("href"),
    ).toBe("/staff/fees?feeState=overdue");
  });

  it("shows an empty state when nothing is overdue", () => {
    render(<OverdueTable overdue={{ total: 0, items: [] }} />);
    expect(screen.getByText("No overdue balances")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("NeedsAttention", () => {
  it("links each row to its student or assessment and shows how late, why withheld and how many drafts", () => {
    render(<NeedsAttention needsAttention={needsAttention} now={NOW} />);

    const late = screen
      .getByRole("heading", { name: /Recent late submissions/ })
      .closest("section")!;
    expect(within(late).getByRole("link", { name: "Tanvir Hasan" }).getAttribute("href")).toBe(
      "/staff/students/s1",
    );
    expect(within(late).getByRole("link", { name: "Essay 1" }).getAttribute("href")).toBe(
      "/staff/assessments/a1",
    );
    expect(within(late).getByText("Late")).toBeTruthy();
    expect(within(late).getByText("2 days")).toBeTruthy();
    expect(within(late).getByText("and 2 more late submissions")).toBeTruthy();

    const withheld = screen.getByRole("heading", { name: /Withheld results/ }).closest("section")!;
    expect(within(withheld).getByRole("link", { name: "Tanvir Hasan" }).getAttribute("href")).toBe(
      "/staff/students/s1",
    );
    expect(within(withheld).getByText("Outstanding fees")).toBeTruthy();

    const drafts = screen
      .getByRole("heading", { name: /Marks waiting to be published/ })
      .closest("section")!;
    expect(within(drafts).getByRole("link", { name: "Essay 1" }).getAttribute("href")).toBe(
      "/staff/assessments/a1",
    );
    expect(within(drafts).getByText("10 marks not yet published")).toBeTruthy();
  });

  it("gives each list its own empty line", () => {
    render(
      <NeedsAttention
        now={NOW}
        needsAttention={{
          lateSubmissions: { total: 0, items: [] },
          withheldResults: { total: 0, items: [] },
          draftAssessments: { total: 0, items: [] },
        }}
      />,
    );
    expect(screen.getByText("No late submissions in the last 14 days.")).toBeTruthy();
    expect(screen.getByText("No results are being withheld.")).toBeTruthy();
    expect(screen.getByText("Every entered mark has been published or withheld.")).toBeTruthy();
  });
});

describe("dashboard card titles (code review #7)", () => {
  // CardTitle already renders an <h2>; React reports a nested heading as a hydration error, but only once per
  // pair of tags, so each card is checked on its own as well as by the console.error guard in the test setup.
  it.each([
    ["Overdue ageing", () => <AgeingBreakdown ageing={ageing} />],
    ["Overdue balances", () => <OverdueTable overdue={overdue} />],
    ["Needs attention", () => <NeedsAttention needsAttention={needsAttention} now={NOW} />],
  ])("%s is one heading, not a heading inside a heading", (title, card) => {
    const { container } = render(card());
    const heading = screen.getByRole("heading", { level: 2, name: title });
    expect(heading.querySelector("h1, h2, h3, h4, h5, h6")).toBeNull();
    expect(container.querySelectorAll("h2 h2")).toHaveLength(0);
  });
});
