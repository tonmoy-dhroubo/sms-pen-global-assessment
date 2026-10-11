// @vitest-environment jsdom
import { apiErrorBody, jsonResponse } from "@/tests/support/dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StatusChangeDialog } from "@/components/students/status-change-dialog";
import type { EnrolmentStatus } from "@/lib/services/rules/types";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const STUDENT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function renderDialog(status: EnrolmentStatus, version = 5) {
  return render(
    <StatusChangeDialog
      studentId={STUDENT_ID}
      studentName="Tanvir Hasan"
      status={status}
      version={version}
    />,
  );
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Change status" }));
  return screen.findByRole("dialog", { name: "Change status" });
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
      if (!next) throw new Error(`Unexpected request ${url}`);
      return next;
    }),
  );
}

beforeEach(() => {
  refresh.mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("StatusChangeDialog options", () => {
  it.each<[EnrolmentStatus, string[]]>([
    ["ENROLLED", ["Deferred", "Withdrawn", "Completed"]],
    ["DEFERRED", ["Enrolled", "Withdrawn"]],
    ["WITHDRAWN", ["Enrolled"]],
  ])("from %s offers only %j", async (status, expected) => {
    const user = userEvent.setup();
    renderDialog(status);
    const dialog = await open(user);
    const labels = within(dialog)
      .getAllByRole("radio")
      .map((radio) => radio.closest("label")?.textContent ?? "");
    expect(labels).toHaveLength(expected.length);
    expected.forEach((name, index) => expect(labels[index]).toContain(name));
  });

  it("marks the transitions that need a reason", async () => {
    const user = userEvent.setup();
    renderDialog("ENROLLED");
    const dialog = await open(user);
    const label = (name: string) =>
      within(dialog)
        .getByRole("radio", { name: new RegExp(name) })
        .closest("label")?.textContent;
    expect(label("Deferred")).toContain("Reason required");
    expect(label("Withdrawn")).toContain("Reason required");
    expect(label("Completed")).not.toContain("Reason required");
  });

  it("disables the button for a completed student, because completed is final", () => {
    renderDialog("COMPLETED");
    const button = screen.getByRole("button", { name: "Change status" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Completed records are final.")).toBeTruthy();
  });
});

describe("StatusChangeDialog submit", () => {
  it("requires choosing a status, and a reason where the matrix says so", async () => {
    mockFetch();
    const user = userEvent.setup();
    renderDialog("ENROLLED");
    const dialog = await open(user);

    await user.click(within(dialog).getByRole("button", { name: "Change status" }));
    expect(await within(dialog).findByText("Choose the new status.")).toBeTruthy();

    await user.click(within(dialog).getByRole("radio", { name: /Withdrawn/ }));
    expect(within(dialog).getByLabelText("Reason")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Change status" }));
    expect(await within(dialog).findByText("Enter a reason.")).toBeTruthy();
    expect(requests).toHaveLength(0);
  });

  it("treats a reason as optional when the transition does not need one", async () => {
    mockFetch(jsonResponse({ id: STUDENT_ID, status: "COMPLETED", version: 6 }));
    const user = userEvent.setup();
    renderDialog("ENROLLED");
    const dialog = await open(user);

    await user.click(within(dialog).getByRole("radio", { name: /Completed/ }));
    expect(within(dialog).getByLabelText("Reason (optional)")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Change status" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(requests[0]!.url).toBe(`/api/students/${STUDENT_ID}/status`);
    expect(JSON.parse(String(requests[0]!.init?.body))).toEqual({
      toStatus: "COMPLETED",
      version: 5,
    });
    expect(toast.success).toHaveBeenCalledWith("Tanvir Hasan is now Completed.");
  });

  it("sends the reason and the version, then refreshes the record", async () => {
    mockFetch(jsonResponse({ id: STUDENT_ID, status: "WITHDRAWN", version: 6 }));
    const user = userEvent.setup();
    renderDialog("DEFERRED", 5);
    const dialog = await open(user);

    await user.click(within(dialog).getByRole("radio", { name: /Withdrawn/ }));
    await user.type(within(dialog).getByLabelText("Reason"), "  Moved abroad  ");
    await user.click(within(dialog).getByRole("button", { name: "Change status" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(JSON.parse(String(requests[0]!.init?.body))).toEqual({
      toStatus: "WITHDRAWN",
      reason: "Moved abroad",
      version: 5,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows a server reason error on the reason field", async () => {
    mockFetch(
      jsonResponse(
        apiErrorBody("VALIDATION_ERROR", "Some fields are invalid.", {
          fieldErrors: { reason: ["Enter a reason to move a student from Enrolled to Deferred."] },
        }),
        400,
      ),
    );
    const user = userEvent.setup();
    renderDialog("ENROLLED");
    const dialog = await open(user);
    await user.click(within(dialog).getByRole("radio", { name: /Deferred/ }));
    await user.type(within(dialog).getByLabelText("Reason"), "Medical leave");
    await user.click(within(dialog).getByRole("button", { name: "Change status" }));
    expect(
      await within(dialog).findByText(
        "Enter a reason to move a student from Enrolled to Deferred.",
      ),
    ).toBeTruthy();
  });

  it("reports a stale record and offers a reload", async () => {
    mockFetch(
      jsonResponse(
        apiErrorBody("VERSION_CONFLICT", "This record was changed by someone else.", {
          currentVersion: 6,
        }),
        409,
      ),
    );
    const user = userEvent.setup();
    renderDialog("ENROLLED");
    const dialog = await open(user);
    await user.click(within(dialog).getByRole("radio", { name: /Completed/ }));
    await user.click(within(dialog).getByRole("button", { name: "Change status" }));

    expect(await within(dialog).findByText("This record changed since you opened it")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Reload" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("toasts a refused transition and stays open", async () => {
    mockFetch(
      jsonResponse(
        apiErrorBody("BUSINESS_RULE", "A Withdrawn student cannot be changed to Completed.", {
          rule: "STATUS_TRANSITION",
        }),
        422,
      ),
    );
    const user = userEvent.setup();
    renderDialog("ENROLLED");
    const dialog = await open(user);
    await user.click(within(dialog).getByRole("radio", { name: /Completed/ }));
    await user.click(within(dialog).getByRole("button", { name: "Change status" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "A Withdrawn student cannot be changed to Completed.",
      ),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
