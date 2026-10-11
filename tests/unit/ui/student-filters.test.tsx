// @vitest-environment jsdom
import "@/tests/support/dom";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SEARCH_DEBOUNCE_MS, StudentFilters } from "@/components/students/student-filters";

const push = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/staff/students",
  useSearchParams: () => new URLSearchParams(search),
}));

const PROGRAMME_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function renderFilters() {
  return render(
    <StudentFilters
      programmes={[
        { id: PROGRAMME_ID, code: "BSC-CSE", name: "BSc in Computer Science", durationYears: 4 },
      ]}
      academicYears={["2026-27", "2025-26"]}
      maxYearOfStudy={4}
    />,
  );
}

/** The URL the last navigation went to. */
const lastUrl = () => String(push.mock.calls.at(-1)?.[0]);

beforeEach(() => {
  push.mockClear();
  search = "";
});

describe("StudentFilters search", () => {
  it("puts the typed text into the URL after a pause, and resets to page 1", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      search = "page=3&sort=-fullName";
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderFilters();

      await user.type(screen.getByRole("searchbox", { name: "Search students" }), "0007");
      expect(push).not.toHaveBeenCalled(); // still waiting for the pause
      await act(async () => {
        vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 50);
      });

      expect(push).toHaveBeenCalledTimes(1);
      expect(lastUrl()).toBe("/staff/students?sort=-fullName&q=0007");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the search from the URL", () => {
    search = "q=jose";
    renderFilters();
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("jose");
  });
});

describe("StudentFilters status and chips", () => {
  it("hides withdrawn and completed by default, with a way to show them", async () => {
    const user = userEvent.setup();
    renderFilters();
    expect(screen.getByText(/Withdrawn and completed students are hidden/)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Active filters" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Show them" }));
    expect(new URLSearchParams(lastUrl().split("?")[1]).getAll("status")).toEqual([
      "ENROLLED",
      "DEFERRED",
      "WITHDRAWN",
      "COMPLETED",
    ]);
  });

  it("shows a chip for a non-default status filter, and removing it restores the default", async () => {
    search = "status=WITHDRAWN&status=COMPLETED&page=2";
    const user = userEvent.setup();
    renderFilters();

    const chips = screen.getByRole("list", { name: "Active filters" });
    expect(within(chips).getByText("Status: Withdrawn, Completed")).toBeTruthy();
    expect(screen.queryByText(/hidden/)).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Remove filter Status: Withdrawn, Completed" }),
    );
    expect(lastUrl()).toBe("/staff/students");
  });

  it("ticking a status in the menu adds it to the URL", async () => {
    const user = userEvent.setup();
    renderFilters();
    await user.click(screen.getByRole("button", { name: /Enrolled, Deferred/ }));
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "Withdrawn" }));
    expect(new URLSearchParams(lastUrl().split("?")[1]).getAll("status")).toEqual([
      "ENROLLED",
      "DEFERRED",
      "WITHDRAWN",
    ]);
  });

  it("shows one removable chip per filter, and 'Clear all' removes them together", async () => {
    search = `programmeId=${PROGRAMME_ID}&academicYear=2025-26&yearOfStudy=2&feeState=overdue&q=ayesha`;
    const user = userEvent.setup();
    renderFilters();

    const chips = within(screen.getByRole("list", { name: "Active filters" }));
    expect(chips.getByText("Programme: BSC-CSE")).toBeTruthy();
    expect(chips.getByText("Session: 2025-26")).toBeTruthy();
    expect(chips.getByText("Year: 2")).toBeTruthy();
    expect(chips.getByText("Fees: Overdue")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Remove filter Year: 2" }));
    expect(lastUrl()).toBe(
      `/staff/students?programmeId=${PROGRAMME_ID}&academicYear=2025-26&feeState=overdue&q=ayesha`,
    );

    await user.click(screen.getByRole("button", { name: "Clear all" }));
    expect(lastUrl()).toBe("/staff/students");
  });
});
