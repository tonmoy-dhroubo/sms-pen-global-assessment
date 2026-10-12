// @vitest-environment jsdom
import { jsonResponse } from "@/tests/support/dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StudentResultsCard } from "@/components/marks/student-results-card";
import type { StudentResultItem, StudentResults } from "@/lib/services/marks";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const STAFF = { id: "st1", fullName: "Shirin Akter" };
const MODULE = { id: "m1", code: "ENG101", title: "Academic Writing" };

function item(
  overrides: Partial<StudentResultItem> & Pick<StudentResultItem, "markId">,
): StudentResultItem {
  return {
    assessment: {
      id: "a1",
      title: "Essay 1",
      deadline: "2026-09-01T17:59:00.000Z",
      module: MODULE,
    },
    mark: "62.5",
    isNonSubmission: false,
    classification: "MERIT",
    releaseStatus: "PUBLISHED",
    withheldReason: null,
    publishedAt: "2026-09-20T05:00:00.000Z",
    version: 2,
    updatedAt: "2026-09-21T05:00:00.000Z",
    enteredBy: STAFF,
    history: [],
    ...overrides,
  };
}

const APPEALED = item({
  markId: "k1",
  history: [
    {
      id: "h2",
      change: "MARK",
      oldMark: "57.0",
      newMark: "62.5",
      reason: "Appeal upheld",
      changedBy: STAFF,
      changedAt: "2026-09-21T05:00:00.000Z",
    },
    {
      id: "h1",
      change: "PUBLISH",
      oldMark: null,
      newMark: null,
      reason: null,
      changedBy: STAFF,
      changedAt: "2026-09-20T05:00:00.000Z",
    },
  ],
});
const WITHHELD = item({
  markId: "k2",
  assessment: { id: "a2", title: "Quiz 1", deadline: "2026-08-01T17:59:00.000Z", module: MODULE },
  mark: null,
  isNonSubmission: true,
  classification: "FAIL",
  releaseStatus: "WITHHELD",
  withheldReason: "Outstanding fees",
  publishedAt: null,
});

function results(...items: StudentResultItem[]): StudentResults {
  return {
    student: { id: "s1", studentNumber: "SMS-2026-0001", fullName: "Ayesha Rahman" },
    summary: {
      total: items.length,
      draft: 0,
      published: items.filter((i) => i.releaseStatus === "PUBLISHED").length,
      withheld: items.filter((i) => i.releaseStatus === "WITHHELD").length,
    },
    items,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("StudentResultsCard", () => {
  it("lists marks with classification, release status and the withheld reason", () => {
    render(
      <StudentResultsCard
        studentId="s1"
        studentName="Ayesha Rahman"
        results={results(APPEALED, WITHHELD)}
      />,
    );
    expect(screen.getByText("2 marks: 1 published, 0 draft, 1 withheld.")).toBeTruthy();
    const essay = screen.getByRole("link", { name: "Essay 1" }).closest("tr")!;
    expect(within(essay).getByText("62.5")).toBeTruthy();
    expect(within(essay).getByText("Merit")).toBeTruthy();
    expect(within(essay).getByText("Published")).toBeTruthy();
    const quiz = screen.getByRole("link", { name: "Quiz 1" }).closest("tr")!;
    expect(within(quiz).getAllByText("NS").length).toBeGreaterThan(0);
    expect(within(quiz).getByText("Withheld")).toBeTruthy();
    expect(within(quiz).getByText(/Outstanding fees/)).toBeTruthy();
  });

  it("expands the history with who, when and why", async () => {
    const user = userEvent.setup();
    render(
      <StudentResultsCard studentId="s1" studentName="Ayesha Rahman" results={results(APPEALED)} />,
    );
    expect(screen.queryByRole("list", { name: "History of Essay 1" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show history for Essay 1" }));
    const history = screen.getByRole("list", { name: "History of Essay 1" });
    const entries = within(history).getAllByRole("listitem");
    expect(entries).toHaveLength(2);
    expect(within(entries[0]!).getByText("Mark changed from 57.0 to 62.5")).toBeTruthy();
    expect(within(entries[0]!).getByText(/Appeal upheld/)).toBeTruthy();
    expect(within(entries[0]!).getByText(/Shirin Akter/)).toBeTruthy();
    expect(within(entries[1]!).getByText("Published to the student")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Hide history for Essay 1" }));
    expect(screen.queryByRole("list", { name: "History of Essay 1" })).toBeNull();
  });

  it("opens the publish preview for this student from the publish-all button", async () => {
    const preview = {
      dryRun: true,
      published: 0,
      toPublish: 1,
      alreadyPublished: 1,
      missingMarks: [],
      overdueStudents: [],
      overdueTotal: "0.00",
      summary: "Publish 1 mark",
    };
    const fetchMock = vi.fn(async () => jsonResponse(preview));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <StudentResultsCard
        studentId="s1"
        studentName="Ayesha Rahman"
        results={results(APPEALED, WITHHELD)}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Publish all for this student/ }));
    const dialog = await screen.findByRole("dialog", { name: "Publish results" });
    await waitFor(() =>
      expect(within(dialog).getByText("Publish 1 mark", { selector: "p" })).toBeTruthy(),
    );
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body))).toEqual({ studentId: "s1", dryRun: true });
  });

  it("explains when there are no marks and offers no publish button", () => {
    render(<StudentResultsCard studentId="s1" studentName="Ayesha Rahman" results={results()} />);
    expect(screen.getByText("No marks yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Publish all/ })).toBeNull();
  });
});
