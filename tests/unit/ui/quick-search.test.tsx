// @vitest-environment jsdom
import { apiErrorBody, jsonResponse } from "@/tests/support/dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppHeader } from "@/components/layout/app-header";
import { StaffQuickSearch } from "@/components/layout/staff-quick-search";
import type { StudentList, StudentListItem } from "@/lib/services/students";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => "/staff",
}));

const ZERO_FEES = {
  charged: "0.00",
  waived: "0.00",
  paid: "0.00",
  balance: "0.00",
  credit: "0.00",
  overdueAmount: "0.00",
  oldestOverdueDays: null,
  ageingBucket: null,
  nextDueDate: null,
  feeState: "paid",
} as const;

function student(
  id: string,
  fullName: string,
  studentNumber: string,
  status: StudentListItem["status"] = "ENROLLED",
): StudentListItem {
  return {
    id,
    studentNumber,
    fullName,
    email: `${id}@example.test`,
    programme: { id: "p1", code: "BSC-CSE", name: "BSc Computer Science" },
    academicYear: "2026-27",
    yearOfStudy: 1,
    status,
    feeSummary: ZERO_FEES,
  };
}

const AYESHA = student("11111111-1111-4111-8111-111111111111", "Ayesha Rahman", "SMS-2026-0001");
const HABIB = student(
  "22222222-2222-4222-8222-222222222222",
  "Habib Chowdhury",
  "SMS-2025-0007",
  "WITHDRAWN",
);

function list(items: StudentListItem[], total = items.length): StudentList {
  return { items, page: 1, pageSize: 8, total };
}

let urls: string[];

/** Answers `/api/students?...` with `reply(q)`. */
function mockSearch(reply: (q: string) => Response = () => jsonResponse(list([AYESHA, HABIB]))) {
  urls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      if (url.startsWith("/api/students?"))
        return reply(new URL(url, "http://x").searchParams.get("q") ?? "");
      throw new Error(`Unexpected request ${url}`);
    }),
  );
}

beforeEach(() => push.mockClear());
afterEach(() => vi.unstubAllGlobals());

const input = () => screen.getByRole("combobox", { name: /Search students/ }) as HTMLInputElement;

describe("StaffQuickSearch", () => {
  it("is a labelled combobox that starts closed and empty", () => {
    mockSearch();
    render(<StaffQuickSearch />);
    expect(input().getAttribute("aria-expanded")).toBe("false");
    expect(input().value).toBe("");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(urls).toHaveLength(0);
  });

  it("opens and focuses from anywhere with Ctrl+K, and with Cmd+K", async () => {
    mockSearch();
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Somewhere else</button>
        <StaffQuickSearch />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Somewhere else" }));

    await user.keyboard("{Control>}k{/Control}");
    expect(document.activeElement).toBe(input());
    expect(input().getAttribute("aria-expanded")).toBe("true");
    expect(await screen.findByText("Type a name, a Student ID or an email address.")).toBeTruthy();

    await user.keyboard("{Escape}");
    expect(input().getAttribute("aria-expanded")).toBe("false");
    await user.click(screen.getByRole("button", { name: "Somewhere else" }));
    expect(document.activeElement).not.toBe(input());

    await user.keyboard("{Meta>}k{/Meta}");
    expect(document.activeElement).toBe(input());
    expect(input().getAttribute("aria-expanded")).toBe("true");
  });

  it("searches after a pause: one request across every status, eight results at most", async () => {
    mockSearch();
    const user = userEvent.setup();
    render(<StaffQuickSearch />);

    await user.type(input(), "ayes");
    await screen.findByText("Ayesha Rahman");

    // Four keystrokes became one request, for every enrolment status, eight rows at most.
    expect(urls).toHaveLength(1);
    const params = new URL(urls[0]!, "http://x").searchParams;
    expect(params.get("q")).toBe("ayes");
    expect(params.get("pageSize")).toBe("8");
    expect(params.getAll("status").sort()).toEqual([
      "COMPLETED",
      "DEFERRED",
      "ENROLLED",
      "WITHDRAWN",
    ]);

    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(within(options[0]!).getByText("SMS-2026-0001")).toBeTruthy();
    expect(within(options[0]!).getByText("Enrolled")).toBeTruthy();
    // A withdrawn student is found too, with their status shown.
    expect(within(options[1]!).getByText("Habib Chowdhury")).toBeTruthy();
    expect(within(options[1]!).getByText("Withdrawn")).toBeTruthy();
  });

  it("opens the highlighted record with Enter and clears the box", async () => {
    mockSearch();
    const user = userEvent.setup();
    render(<StaffQuickSearch />);

    await user.type(input(), "ayes");
    await screen.findByText("Ayesha Rahman");
    expect(screen.getAllByRole("option")[0]!.getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{Enter}");

    expect(push).toHaveBeenCalledWith(`/staff/students/${AYESHA.id}`);
    expect(input().value).toBe("");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("moves the highlight with the arrow keys before Enter", async () => {
    mockSearch();
    const user = userEvent.setup();
    render(<StaffQuickSearch />);

    await user.type(input(), "a");
    await screen.findByText("Habib Chowdhury");
    await user.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("option")[1]!.getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith(`/staff/students/${HABIB.id}`);
  });

  it("opens a record by clicking it", async () => {
    mockSearch();
    const user = userEvent.setup();
    render(<StaffQuickSearch />);
    await user.type(input(), "hab");
    await user.click(await screen.findByText("Habib Chowdhury"));
    expect(push).toHaveBeenCalledWith(`/staff/students/${HABIB.id}`);
  });

  it("holds an Enter pressed before the results arrive, then opens the first match", async () => {
    mockSearch(() => jsonResponse(list([AYESHA])));
    const user = userEvent.setup();
    render(<StaffQuickSearch />);

    // Typed and submitted faster than the pause before searching: nothing may open from stale rows.
    await user.type(input(), "ayesha{Enter}");
    expect(push).not.toHaveBeenCalled();

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/staff/students/${AYESHA.id}`));
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("does nothing on Enter with an empty box", async () => {
    mockSearch();
    const user = userEvent.setup();
    render(<StaffQuickSearch />);
    await user.click(input());
    await user.keyboard("{Enter}");
    expect(push).not.toHaveBeenCalled();
    expect(urls).toHaveLength(0);
  });

  it("says when nothing matches, and when the search fails", async () => {
    let fail = false;
    mockSearch(() =>
      fail
        ? jsonResponse(apiErrorBody("INTERNAL_ERROR", "Search is down."), 500)
        : jsonResponse(list([])),
    );
    const user = userEvent.setup();
    render(<StaffQuickSearch />);

    await user.type(input(), "zzz");
    expect(await screen.findByText(/No students match .zzz./)).toBeTruthy();

    fail = true;
    await user.clear(input());
    await user.type(input(), "yyy");
    expect(await screen.findByText("Search is down.")).toBeTruthy();
  });

  it("offers the full list when there are more matches than it shows", async () => {
    mockSearch(() => jsonResponse(list([AYESHA], 23)));
    const user = userEvent.setup();
    render(<StaffQuickSearch />);

    await user.type(input(), "rahman");
    await user.click(await screen.findByText(/Showing 1 of 23/));
    const target = push.mock.calls[0]![0] as string;
    expect(target.startsWith("/staff/students?")).toBe(true);
    const params = new URL(target, "http://x").searchParams;
    expect(params.get("q")).toBe("rahman");
    expect(params.getAll("status")).toHaveLength(4);
  });
});

describe("AppHeader quick search", () => {
  const staff = { role: "staff", id: "s1", fullName: "Kamrul Hasan", jobTitle: "Officer" } as const;

  it("is in the header for staff", () => {
    mockSearch();
    render(<AppHeader identity={staff} />);
    expect(screen.getByRole("search")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /Search students/ })).toBeTruthy();
  });

  it("is not there for a student, or before anyone is chosen", () => {
    mockSearch();
    const { unmount } = render(
      <AppHeader
        identity={{ role: "student", id: "x", fullName: "Ayesha Rahman", studentNumber: "SMS-1" }}
      />,
    );
    expect(screen.queryByRole("search")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    unmount();

    render(<AppHeader identity={null} />);
    expect(screen.queryByRole("search")).toBeNull();
  });
});
