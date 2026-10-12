// @vitest-environment jsdom
import { apiErrorBody, jsonResponse } from "@/tests/support/dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublishPreviewDialog } from "@/components/marks/publish-preview-dialog";
import type { PublishResponse } from "@/lib/client/marks";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const ASSESSMENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MODULE = { id: "mod1", code: "CSE101", title: "Programming" };

function person(n: number, fullName: string) {
  return { id: `s${n}`, studentNumber: `SMS-2026-000${n}`, fullName };
}

const PREVIEW: PublishResponse = {
  dryRun: true,
  published: 0,
  toPublish: 18,
  alreadyPublished: 4,
  missingMarks: [
    {
      student: person(5, "Eman Ali"),
      assessment: { id: ASSESSMENT_ID, title: "Essay 1", module: MODULE },
    },
    {
      student: person(6, "Farah Noor"),
      assessment: { id: ASSESSMENT_ID, title: "Essay 1", module: MODULE },
    },
    {
      student: person(7, "Gulshan Ara"),
      assessment: { id: ASSESSMENT_ID, title: "Essay 1", module: MODULE },
    },
  ],
  overdueStudents: [
    { student: person(1, "Jannatul Ferdous"), overdueAmount: "260000.00", marksToPublish: 2 },
    { student: person(2, "Tanvir Hasan"), overdueAmount: "100000.00", marksToPublish: 1 },
  ],
  overdueTotal: "360000.00",
  summary: "Publish 18 marks - 2 students have overdue fees, 3 marks missing",
  warnings: [
    { code: "OVERDUE_FEES", message: "2 students have overdue fees." },
    { code: "MISSING_MARKS", message: "3 marks missing." },
  ],
};

type Request = { url: string; body?: Record<string, unknown> };
let requests: Request[];
function mockFetch(...answers: Response[]) {
  requests = [];
  const queue = [...answers];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({
        url,
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
      });
      const next = queue.shift();
      if (!next) throw new Error(`Unexpected request ${url}`);
      return next;
    }),
  );
}

function renderDialog(
  props: { onPublished?: () => void; onOpenChange?: (open: boolean) => void } = {},
) {
  return render(
    <PublishPreviewDialog
      open
      onOpenChange={props.onOpenChange ?? vi.fn()}
      target={{ assessmentId: ASSESSMENT_ID }}
      subject="Essay 1"
      onPublished={props.onPublished}
    />,
  );
}

beforeEach(() => {
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("PublishPreviewDialog", () => {
  it("asks for a dry run and shows the counts, the overdue students and the missing marks", async () => {
    mockFetch(jsonResponse(PREVIEW));
    renderDialog();
    const dialog = await screen.findByRole("dialog", { name: "Publish results" });

    expect(await within(dialog).findByText(PREVIEW.summary)).toBeTruthy();
    expect(requests[0]).toEqual({
      url: "/api/marks/publish",
      body: { assessmentId: ASSESSMENT_ID, dryRun: true },
    });
    expect(within(dialog).getByText("18")).toBeTruthy(); // to publish
    expect(within(dialog).getByText("4")).toBeTruthy(); // already published

    // Overdue fees: highlighted, with the amounts and the option to withhold instead (DB-012).
    const overdue = within(dialog).getByRole("region", { name: /2 students have overdue fees/ });
    expect(within(overdue).getByText(/You can still publish/)).toBeTruthy();
    expect(within(overdue).getByText("Withhold")).toBeTruthy();
    const list = overdue.querySelector("[data-slot=overdue-students]") as HTMLElement;
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByRole("link", { name: "Jannatul Ferdous" }).getAttribute("href")).toBe(
      "/staff/students/s1",
    );
    expect(within(list).getByText(/2,60,000\.00/)).toBeTruthy();
    expect(within(list).getAllByRole("listitem")[0]?.className).toContain("bg-tone-amber");

    // Missing marks are listed by name.
    const missing = within(dialog).getByRole("region", { name: /3 marks are missing/ });
    expect(within(missing).getAllByRole("listitem")).toHaveLength(3);
    expect(within(missing).getByText(/Eman Ali/)).toBeTruthy();
  });

  it("publishes for real when confirmed, then reports and closes", async () => {
    mockFetch(jsonResponse(PREVIEW), jsonResponse({ ...PREVIEW, dryRun: false, published: 18 }));
    const onPublished = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onPublished, onOpenChange });
    const dialog = await screen.findByRole("dialog", { name: "Publish results" });

    await user.click(await within(dialog).findByRole("button", { name: "Publish 18 marks" }));

    await waitFor(() => expect(onPublished).toHaveBeenCalledTimes(1));
    expect(requests[1]).toEqual({
      url: "/api/marks/publish",
      body: { assessmentId: ASSESSMENT_ID, dryRun: false },
    });
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith("Published 18 marks.");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps the dialog open and shows the error when publishing fails", async () => {
    mockFetch(
      jsonResponse(PREVIEW),
      jsonResponse(apiErrorBody("INTERNAL_ERROR", "Something went wrong."), 500),
    );
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onOpenChange });
    const dialog = await screen.findByRole("dialog", { name: "Publish results" });
    await user.click(await within(dialog).findByRole("button", { name: "Publish 18 marks" }));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("offers nothing to confirm when no marks can be published, and shows no warnings sections", async () => {
    mockFetch(
      jsonResponse({
        ...PREVIEW,
        toPublish: 0,
        alreadyPublished: 6,
        missingMarks: [],
        overdueStudents: [],
        overdueTotal: "0.00",
        summary: "Publish 0 marks",
      }),
    );
    renderDialog();
    const dialog = await screen.findByRole("dialog", { name: "Publish results" });
    expect(await within(dialog).findByText(/no draft or withheld marks/)).toBeTruthy();
    expect(
      (within(dialog).getByRole("button", { name: "Publish" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(within(dialog).queryByRole("region")).toBeNull();
  });

  it("shows an error with a retry when the preview cannot be loaded", async () => {
    mockFetch(
      jsonResponse(
        apiErrorBody("INTERNAL_ERROR", "Something went wrong.", { requestId: "req-1" }),
        500,
      ),
      jsonResponse(PREVIEW),
    );
    const user = userEvent.setup();
    renderDialog();
    const dialog = await screen.findByRole("dialog", { name: "Publish results" });
    expect(await within(dialog).findByText("Could not check the marks")).toBeTruthy();
    expect(
      (within(dialog).getByRole("button", { name: "Publish" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.click(within(dialog).getByRole("button", { name: "Try again" }));
    expect(await within(dialog).findByText(PREVIEW.summary)).toBeTruthy();
    expect(requests).toHaveLength(2);
  });

  it("previews a student's results with the student scope", async () => {
    mockFetch(
      jsonResponse({
        ...PREVIEW,
        overdueStudents: [],
        overdueTotal: "0.00",
        missingMarks: [],
        summary: "Publish 18 marks",
      }),
    );
    render(
      <PublishPreviewDialog
        open
        onOpenChange={vi.fn()}
        target={{ studentId: "s9" }}
        subject="Ayesha Rahman"
      />,
    );
    await screen.findByText("Publish 18 marks", { selector: "p" });
    expect(requests[0]?.body).toEqual({ studentId: "s9", dryRun: true });
  });
});
