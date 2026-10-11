// @vitest-environment jsdom
import { apiErrorBody, jsonResponse } from "@/tests/support/dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssessmentActions } from "@/components/assessments/assessment-actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MODULE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MODULES = [{ id: MODULE_ID, code: "ENG101", title: "English Composition" }];

function renderActions(overrides: { closedAt?: string | null; submitted?: number } = {}) {
  return render(
    <AssessmentActions
      assessment={{
        id: ID,
        title: "Essay 1",
        module: MODULES[0]!,
        deadline: "2026-10-11T17:59:00.000Z",
        closedAt: overrides.closedAt ?? null,
        version: 3,
        counts: {
          eligible: 10,
          submitted: overrides.submitted ?? 4,
          late: 1,
          marked: 0,
          published: 0,
        },
      }}
      modules={MODULES}
      now="2026-10-12T04:00:00.000Z"
    />,
  );
}

type Request = { url: string; init?: RequestInit };
let requests: Request[];
function mockFetch(...answers: Response[]) {
  requests = [];
  const queue = [...answers];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      const next = queue.shift();
      if (!next) throw new Error(`Unexpected request ${init?.method ?? "GET"} ${url}`);
      return next;
    }),
  );
}

beforeEach(() => {
  refresh.mockClear();
  for (const fn of Object.values(toast)) vi.mocked(fn).mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("Close", () => {
  it("asks before closing, says what it does, and only then posts to /close", async () => {
    mockFetch(jsonResponse({ id: ID, closedAt: "2026-10-12T04:00:00.000Z" }));
    const user = userEvent.setup();
    renderActions();

    await user.click(screen.getByRole("button", { name: "Close" }));
    const dialog = await screen.findByRole("dialog", { name: "Close this assessment?" });
    expect(within(dialog).getByText(/no longer be able to upload or replace files/)).toBeTruthy();
    expect(within(dialog).getByText(/not even late ones/)).toBeTruthy();
    expect(requests).toHaveLength(0); // nothing has happened yet

    await user.click(within(dialog).getByRole("button", { name: "Close assessment" }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({ url: `/api/assessments/${ID}/close` });
    expect(requests[0]!.init?.method).toBe("POST");
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("Essay 1 is closed"));
  });

  it("does nothing when cancelled", async () => {
    mockFetch();
    const user = userEvent.setup();
    renderActions();

    await user.click(screen.getByRole("button", { name: "Close" }));
    const dialog = await screen.findByRole("dialog", { name: "Close this assessment?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(requests).toHaveLength(0);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes to the real state, with a note, when someone else already closed it", async () => {
    mockFetch(
      jsonResponse(
        apiErrorBody("BUSINESS_RULE", "This assessment is already closed.", {
          rule: "ALREADY_CLOSED",
        }),
        422,
      ),
    );
    const user = userEvent.setup();
    renderActions();

    await user.click(screen.getByRole("button", { name: "Close" }));
    const dialog = await screen.findByRole("dialog", { name: "Close this assessment?" });
    await user.click(within(dialog).getByRole("button", { name: "Close assessment" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining("already closed"));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("keeps the dialog open and shows the error when closing fails for another reason", async () => {
    mockFetch(jsonResponse(apiErrorBody("INTERNAL_ERROR", "Something went wrong."), 500));
    const user = userEvent.setup();
    renderActions();

    await user.click(screen.getByRole("button", { name: "Close" }));
    const dialog = await screen.findByRole("dialog", { name: "Close this assessment?" });
    await user.click(within(dialog).getByRole("button", { name: "Close assessment" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByRole("dialog", { name: "Close this assessment?" })).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("Reopen", () => {
  it("offers Reopen instead of Close for a closed assessment, and posts to /reopen after confirmation", async () => {
    mockFetch(jsonResponse({ id: ID, closedAt: null }));
    const user = userEvent.setup();
    renderActions({ closedAt: "2026-10-12T03:00:00.000Z" });

    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Reopen" }));
    const dialog = await screen.findByRole("dialog", { name: "Reopen this assessment?" });
    await user.click(within(dialog).getByRole("button", { name: "Reopen assessment" }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({ url: `/api/assessments/${ID}/reopen` });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
});

describe("Edit", () => {
  it("opens the edit form with the stored values and the deadline as a Dhaka date and time", async () => {
    mockFetch();
    const user = userEvent.setup();
    renderActions();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit assessment" });

    expect((within(dialog).getByLabelText("Title") as HTMLInputElement).value).toBe("Essay 1");
    expect((within(dialog).getByLabelText("Date") as HTMLInputElement).value).toBe("2026-10-11");
    expect((within(dialog).getByLabelText("Time (24-hour)") as HTMLInputElement).value).toBe(
      "23:59",
    );
    // Four students have submitted, so the module is locked.
    expect(
      within(dialog).getByText(/cannot be changed because 4 students have already submitted/),
    ).toBeTruthy();
    expect(within(dialog).getByRole("combobox", { name: "Module" }).hasAttribute("disabled")).toBe(
      true,
    );
  });
});
