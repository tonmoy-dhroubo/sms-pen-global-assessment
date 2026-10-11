// @vitest-environment jsdom
import { apiErrorBody, jsonResponse } from "@/tests/support/dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssessmentForm, type AssessmentFormProps } from "@/components/assessments/assessment-form";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MODULE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_MODULE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NOW = "2026-10-12T04:00:00.000Z"; // 12 Oct 2026, 10:00 in Dhaka

const MODULES = [
  { id: MODULE_ID, code: "ENG101", title: "English Composition" },
  { id: OTHER_MODULE_ID, code: "CSE101", title: "Structured Programming" },
];

const onSaved = vi.fn();
const onCancel = vi.fn();
const onReload = vi.fn();

function renderForm(overrides: Partial<AssessmentFormProps> = {}) {
  return render(
    <AssessmentForm
      mode={{ kind: "create" }}
      modules={MODULES}
      now={NOW}
      onSaved={onSaved}
      onCancel={onCancel}
      onReload={onReload}
      {...overrides}
    />,
  );
}

function renderEdit(submitted = 0) {
  return renderForm({
    mode: { kind: "edit", id: ID, version: 3, submitted },
    initialValues: {
      moduleId: MODULE_ID,
      title: "Essay 1",
      deadlineDate: "2026-10-11",
      deadlineTime: "23:59",
    },
  });
}

type Request = { url: string; init?: RequestInit };
let requests: Request[];
const bodyOf = (request: Request | undefined) =>
  JSON.parse(String(request?.init?.body)) as Record<string, unknown>;
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
  for (const fn of [onSaved, onCancel, onReload]) fn.mockClear();
  for (const fn of Object.values(toast)) vi.mocked(fn).mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("new assessment form", () => {
  it("starts with the end of tomorrow in Dhaka time", () => {
    renderForm();
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe("2026-10-13");
    expect((screen.getByLabelText("Time (24-hour)") as HTMLInputElement).value).toBe("23:59");
    expect(screen.getByText(/Asia\/Dhaka time/)).toBeTruthy();
  });

  it("shows what is missing and sends nothing", async () => {
    mockFetch();
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: "Create assessment" }));

    expect(await screen.findByText("Choose a module.")).toBeTruthy();
    expect(screen.getByText("Enter a title.")).toBeTruthy();
    expect(requests).toHaveLength(0);
  });

  it("posts the deadline as the UTC instant for the Dhaka date and time that were typed", async () => {
    mockFetch(jsonResponse({ id: ID, title: "Essay 1", version: 1 }, 201));
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("combobox", { name: "Module" }));
    await user.click(screen.getByRole("option", { name: /ENG101/ }));
    await user.type(screen.getByLabelText("Title"), "  Essay   1 ");
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-30" } });
    fireEvent.change(screen.getByLabelText("Time (24-hour)"), { target: { value: "09:30" } });
    await user.click(screen.getByRole("button", { name: "Create assessment" }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]!.url).toBe("/api/assessments");
    expect(requests[0]!.init?.method).toBe("POST");
    expect(bodyOf(requests[0])).toEqual({
      moduleId: MODULE_ID,
      title: "Essay 1",
      deadline: "2026-10-30T03:30:00.000Z", // 09:30 in Dhaka
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith("Created Essay 1.");
  });

  it("allows a deadline in the past, says so, and shows the server's warning after saving", async () => {
    mockFetch(
      jsonResponse(
        {
          id: ID,
          title: "Old",
          version: 1,
          warnings: [{ code: "DEADLINE_IN_PAST", message: "The deadline is already in the past." }],
        },
        201,
      ),
    );
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("combobox", { name: "Module" }));
    await user.click(screen.getByRole("option", { name: /CSE101/ }));
    await user.type(screen.getByLabelText("Title"), "Old");
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-01-15" } });
    expect(screen.getByText(/This deadline is in the past/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Create assessment" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(bodyOf(requests[0]).deadline).toBe("2026-01-15T17:59:00.000Z");
    expect(toast.warning).toHaveBeenCalledWith("The deadline is already in the past.", {
      duration: 15_000,
    });
  });

  it("maps a server field error onto the field", async () => {
    mockFetch(
      jsonResponse(
        apiErrorBody("VALIDATION_ERROR", "Some fields are invalid.", {
          fieldErrors: { moduleId: ["Choose a module."] },
        }),
        400,
      ),
    );
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("combobox", { name: "Module" }));
    await user.click(screen.getByRole("option", { name: /ENG101/ }));
    await user.type(screen.getByLabelText("Title"), "Essay");
    await user.click(screen.getByRole("button", { name: "Create assessment" }));

    expect(await screen.findByText("Choose a module.")).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("cancels without sending anything", async () => {
    mockFetch();
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(0);
  });
});

describe("edit assessment form", () => {
  it("sends only what changed, with the version that was loaded", async () => {
    mockFetch(jsonResponse({ id: ID, title: "Essay one", version: 4 }));
    const user = userEvent.setup();
    renderEdit();

    const title = screen.getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Essay one");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({ url: `/api/assessments/${ID}` });
    expect(requests[0]!.init?.method).toBe("PATCH");
    expect(bodyOf(requests[0])).toEqual({ title: "Essay one", version: 3 });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it("does not call the API when nothing changed", async () => {
    mockFetch();
    const user = userEvent.setup();
    renderEdit();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(toast.info).toHaveBeenCalled());
    expect(requests).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("warns that late flags will be recalculated when the deadline changes and students have submitted", async () => {
    mockFetch();
    renderEdit(4);

    expect(screen.queryByText(/recalculates which of the 4 submissions/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Time (24-hour)"), { target: { value: "12:00" } });
    expect(
      await screen.findByText(/recalculates which of the 4 submissions are late/),
    ).toBeTruthy();
  });

  it("does not show that warning when nobody has submitted", async () => {
    renderEdit(0);
    fireEvent.change(screen.getByLabelText("Time (24-hour)"), { target: { value: "12:00" } });
    await screen.findByText(/Will be saved as/);
    expect(screen.queryByText(/recalculates which of the/)).toBeNull();
  });

  it("shows how many late flags changed after saving a new deadline", async () => {
    mockFetch(
      jsonResponse({
        id: ID,
        title: "Essay 1",
        version: 4,
        warnings: [
          {
            code: "LATE_FLAGS_RECALCULATED",
            message: "The deadline moved. 2 submissions changed between on time and late.",
            details: { changed: 2, submissions: 4 },
          },
        ],
      }),
    );
    const user = userEvent.setup();
    renderEdit(4);

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-14" } });
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(bodyOf(requests[0])).toEqual({
      deadline: "2026-10-14T17:59:00.000Z",
      version: 3,
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(toast.warning).toHaveBeenCalledWith(
      "The deadline moved. 2 submissions changed between on time and late.",
      { duration: 15_000 },
    );
  });

  it("locks the module once students have submitted", () => {
    renderEdit(1);
    expect(screen.getByRole("combobox", { name: "Module" }).hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByText(/cannot be changed because 1 student has already submitted/),
    ).toBeTruthy();
  });

  it("allows changing the module while nobody has submitted", async () => {
    mockFetch(jsonResponse({ id: ID, title: "Essay 1", version: 4 }));
    const user = userEvent.setup();
    renderEdit(0);

    await user.click(screen.getByRole("combobox", { name: "Module" }));
    await user.click(screen.getByRole("option", { name: /CSE101/ }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(bodyOf(requests[0])).toEqual({ moduleId: OTHER_MODULE_ID, version: 3 });
  });

  it("shows 'This record changed since you opened it' with a reload on a version conflict", async () => {
    mockFetch(
      jsonResponse(
        apiErrorBody("VERSION_CONFLICT", "This record was changed by someone else.", {
          currentVersion: 4,
        }),
        409,
      ),
    );
    const user = userEvent.setup();
    renderEdit();

    const title = screen.getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Changed");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("This record changed since you opened it")).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Reload latest" }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("puts the 'module cannot change' rule on the module field", async () => {
    mockFetch(
      jsonResponse(
        apiErrorBody(
          "BUSINESS_RULE",
          "The module cannot be changed because students have submitted.",
          {
            rule: "ASSESSMENT_HAS_SUBMISSIONS",
          },
        ),
        422,
      ),
    );
    const user = userEvent.setup();
    renderEdit(0);
    await user.click(screen.getByRole("combobox", { name: "Module" }));
    await user.click(screen.getByRole("option", { name: /CSE101/ }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(
      await screen.findByText(/The module cannot be changed because students have submitted/),
    ).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
