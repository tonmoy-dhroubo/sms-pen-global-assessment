// @vitest-environment jsdom
import { apiErrorBody, jsonResponse } from "@/tests/support/dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RolePicker } from "@/components/session/role-picker";
import { RoleSwitcher } from "@/components/session/role-switcher";
import type { SessionOptions } from "@/lib/client/session";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const STAFF_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_STAFF_ID = "22222222-2222-4222-8222-222222222222";
const STUDENT_ID = "33333333-3333-4333-8333-333333333333";

const OPTIONS: SessionOptions = {
  staff: [
    { id: STAFF_ID, fullName: "Kamrul Hasan", jobTitle: "Registry Officer" },
    { id: OTHER_STAFF_ID, fullName: "Fatema Begum", jobTitle: "Finance Officer" },
  ],
  students: {
    items: [
      {
        id: STUDENT_ID,
        studentNumber: "SMS-2026-0002",
        fullName: "Tanvir Hasan",
        status: "ENROLLED",
      },
    ],
    total: 1,
  },
};

const FILTERED: SessionOptions = {
  staff: OPTIONS.staff,
  students: {
    items: [
      {
        id: STUDENT_ID,
        studentNumber: "SMS-2026-0002",
        fullName: "Tanvir Hasan",
        status: "ENROLLED",
      },
    ],
    total: 12,
  },
};

type FetchCall = { url: string; init?: RequestInit };
let calls: FetchCall[];

/** Answers `/api/session/options` and `PUT /api/session` like the real routes. */
function mockApi(
  overrides: {
    put?: () => Response;
    options?: (url: string) => Response;
    del?: () => Response;
  } = {},
) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.startsWith("/api/session/options")) {
        return overrides.options?.(url) ?? jsonResponse(url.includes("q=") ? FILTERED : OPTIONS);
      }
      if (url === "/api/session" && init?.method === "PUT") {
        return overrides.put?.() ?? jsonResponse({ role: JSON.parse(String(init.body)).role });
      }
      if (url === "/api/session" && init?.method === "DELETE") {
        return overrides.del?.() ?? jsonResponse({ role: null });
      }
      throw new Error(`Unexpected request ${url}`);
    }),
  );
}

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
  vi.mocked(toast.error).mockClear();
});
afterEach(() => vi.unstubAllGlobals());

const putCalls = () => calls.filter((call) => call.init?.method === "PUT");

describe("RoleSwitcher", () => {
  it("shows who the app is being viewed as", () => {
    mockApi();
    render(
      <RoleSwitcher
        current={{ role: "staff", id: STAFF_ID, fullName: "Kamrul Hasan", jobTitle: "x" }}
      />,
    );
    expect(screen.getByRole("button", { name: /Viewing as:\s*Kamrul Hasan/ })).toBeTruthy();
  });

  it("says so when nobody is selected yet", () => {
    mockApi();
    render(<RoleSwitcher current={null} />);
    expect(screen.getByRole("button", { name: /Not selected/ })).toBeTruthy();
  });

  it("loads the staff and students only once it is opened", async () => {
    mockApi();
    const user = userEvent.setup();
    render(<RoleSwitcher current={null} />);
    expect(calls).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: /Not selected/ }));
    expect(await screen.findByText("Fatema Begum")).toBeTruthy();
    expect(screen.getByText("Tanvir Hasan")).toBeTruthy();
    expect(screen.getByText("SMS-2026-0002")).toBeTruthy();
    expect(calls.map((call) => call.url)).toEqual(["/api/session/options"]);
  });

  it("switches to a staff member: PUT /api/session, then the staff home with a refresh", async () => {
    mockApi();
    const user = userEvent.setup();
    render(<RoleSwitcher current={null} />);

    await user.click(screen.getByRole("button", { name: /Not selected/ }));
    await user.click(await screen.findByText("Fatema Begum"));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/staff"));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(putCalls()).toHaveLength(1);
    expect(putCalls()[0]!.url).toBe("/api/session");
    expect(JSON.parse(String(putCalls()[0]!.init!.body))).toEqual({
      role: "staff",
      staffId: OTHER_STAFF_ID,
    });
  });

  it("switches to a student and lands on the student home", async () => {
    mockApi();
    const user = userEvent.setup();
    render(<RoleSwitcher current={null} />);

    await user.click(screen.getByRole("button", { name: /Not selected/ }));
    await user.click(await screen.findByText("Tanvir Hasan"));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/student"));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(putCalls()[0]!.init!.body))).toEqual({
      role: "student",
      studentId: STUDENT_ID,
    });
  });

  it("searches students on the server, debounced, after typing", async () => {
    mockApi();
    const user = userEvent.setup();
    render(<RoleSwitcher current={null} />);

    await user.click(screen.getByRole("button", { name: /Not selected/ }));
    await screen.findByText("Fatema Begum");
    await user.type(screen.getByRole("combobox"), "tanv");

    await waitFor(() =>
      expect(calls.some((call) => call.url === "/api/session/options?q=tanv")).toBe(true),
    );
    // Four keystrokes became one request.
    expect(calls.filter((call) => call.url.includes("q="))).toHaveLength(1);
    expect(await screen.findByText(/Showing 1 of 12 students/)).toBeTruthy();
  });

  it("can be driven from the keyboard: type, then Enter selects the highlighted match", async () => {
    mockApi();
    const user = userEvent.setup();
    render(<RoleSwitcher current={null} />);

    await user.click(screen.getByRole("button", { name: /Not selected/ }));
    await screen.findByText("Fatema Begum");
    await user.type(screen.getByRole("combobox"), "zzz");
    // Staff are filtered locally by the text, so only the student result remains once it has loaded.
    await screen.findByText(/Showing 1 of 12 students/);
    await user.keyboard("{Enter}");

    await waitFor(() => expect(push).toHaveBeenCalledWith("/student"));
    expect(JSON.parse(String(putCalls()[0]!.init!.body))).toMatchObject({ studentId: STUDENT_ID });
  });

  it("does not call the API when the current person is chosen again", async () => {
    mockApi();
    const user = userEvent.setup();
    render(
      <RoleSwitcher
        current={{ role: "staff", id: STAFF_ID, fullName: "Kamrul Hasan", jobTitle: "x" }}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Viewing as/ }));
    await user.click(await screen.findByText("Registry Officer"));

    expect(putCalls()).toHaveLength(0);
    expect(push).not.toHaveBeenCalled();
  });

  it("shows an error toast and stays put when the switch is rejected", async () => {
    mockApi({
      put: () => jsonResponse(apiErrorBody("NOT_FOUND", "Student not found."), 404),
    });
    const user = userEvent.setup();
    render(<RoleSwitcher current={null} />);

    await user.click(screen.getByRole("button", { name: /Not selected/ }));
    await user.click(await screen.findByText("Tanvir Hasan"));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Student not found."));
    expect(push).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("offers a retry when the list cannot be loaded", async () => {
    let fail = true;
    mockApi({
      options: () =>
        fail
          ? jsonResponse(apiErrorBody("INTERNAL_ERROR", "Unexpected error."), 500)
          : jsonResponse(OPTIONS),
    });
    const user = userEvent.setup();
    render(<RoleSwitcher current={null} />);

    await user.click(screen.getByRole("button", { name: /Not selected/ }));
    expect(await screen.findByText(/Unexpected error/)).toBeTruthy();

    fail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Fatema Begum")).toBeTruthy();
  });
});

describe("RoleSwitcher: Change role", () => {
  const STAFF_NOW = {
    role: "staff",
    id: STAFF_ID,
    fullName: "Kamrul Hasan",
    jobTitle: "x",
  } as const;
  const deleteCalls = () => calls.filter((call) => call.init?.method === "DELETE");

  it("sits at the bottom of the switcher, below the list of people", async () => {
    mockApi();
    const user = userEvent.setup();
    render(<RoleSwitcher current={STAFF_NOW} />);

    await user.click(screen.getByRole("button", { name: /Viewing as/ }));
    await screen.findByText("Fatema Begum");
    const button = screen.getByRole("button", { name: "Change role" });
    const list = screen.getByRole("listbox");
    // After the list in the document, and not inside it.
    expect(list.contains(button)).toBe(false);
    expect(list.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("is not offered when nobody has been chosen yet", async () => {
    mockApi();
    const user = userEvent.setup();
    render(<RoleSwitcher current={null} />);
    await user.click(screen.getByRole("button", { name: /Not selected/ }));
    await screen.findByText("Fatema Begum");
    expect(screen.queryByRole("button", { name: "Change role" })).toBeNull();
  });

  it("clears the session with DELETE /api/session, then goes to the role picker with a refresh", async () => {
    mockApi();
    const user = userEvent.setup();
    render(<RoleSwitcher current={STAFF_NOW} />);

    await user.click(screen.getByRole("button", { name: /Viewing as/ }));
    await user.click(await screen.findByRole("button", { name: "Change role" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(deleteCalls()).toHaveLength(1);
    expect(deleteCalls()[0]!.url).toBe("/api/session");
    expect(putCalls()).toHaveLength(0);
  });

  it("can be reached and chosen from the keyboard", async () => {
    mockApi();
    const user = userEvent.setup();
    render(<RoleSwitcher current={STAFF_NOW} />);

    await user.click(screen.getByRole("button", { name: /Viewing as/ }));
    await screen.findByText("Tanvir Hasan");
    // Focus starts in the search box; Tab moves on to the button under the list.
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Change role" }));
    await user.keyboard("{Enter}");

    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(deleteCalls()).toHaveLength(1);
  });

  it("shows an error toast and stays put when the session cannot be cleared", async () => {
    mockApi({ del: () => jsonResponse(apiErrorBody("INTERNAL_ERROR", "Try again later."), 500) });
    const user = userEvent.setup();
    render(<RoleSwitcher current={STAFF_NOW} />);

    await user.click(screen.getByRole("button", { name: /Viewing as/ }));
    await user.click(await screen.findByRole("button", { name: "Change role" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Try again later."));
    expect(push).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("RolePicker", () => {
  it("shows the staff and students it was given without fetching", () => {
    mockApi();
    render(<RolePicker initial={OPTIONS} />);
    expect(screen.getByText("Kamrul Hasan")).toBeTruthy();
    expect(screen.getByText("Registry Officer")).toBeTruthy();
    expect(screen.getByText("Tanvir Hasan")).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it("switches to a staff member and goes to /staff", async () => {
    mockApi();
    const user = userEvent.setup();
    render(<RolePicker initial={OPTIONS} />);

    await user.click(screen.getByRole("button", { name: /Kamrul Hasan/ }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/staff"));
    expect(refresh).toHaveBeenCalled();
    expect(JSON.parse(String(putCalls()[0]!.init!.body))).toEqual({
      role: "staff",
      staffId: STAFF_ID,
    });
  });

  it("searches students and switches to one", async () => {
    mockApi();
    const user = userEvent.setup();
    render(<RolePicker initial={OPTIONS} />);

    await user.type(screen.getByLabelText("Search by name or Student ID"), "tanv");
    await waitFor(() =>
      expect(calls.some((call) => call.url === "/api/session/options?q=tanv")).toBe(true),
    );
    await screen.findByText(/Showing 1 of 12 students/);
    await user.click(screen.getByRole("button", { name: /Tanvir Hasan/ }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/student"));
  });
});
