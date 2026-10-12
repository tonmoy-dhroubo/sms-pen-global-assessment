// @vitest-environment jsdom
import { apiErrorBody, jsonResponse } from "@/tests/support/dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarksheetGrid } from "@/components/marks/marksheet-grid";
import type { MarkDto, Marksheet, MarksheetRow } from "@/lib/services/marks";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const ASSESSMENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROGRAMME = { id: "p1", code: "BSC-CSE", name: "BSc in Computer Science" };

function row(
  n: number,
  name: string,
  overrides: Partial<MarksheetRow> = {},
  late: string | null = null,
): MarksheetRow {
  return {
    student: {
      id: `s${n}`,
      studentNumber: `SMS-2026-000${n}`,
      fullName: name,
      status: "ENROLLED",
      programme: PROGRAMME,
    },
    eligible: true,
    submission: {
      status: late ? "LATE" : "ON_TIME",
      lateBy: late,
      deadline: "2026-10-11T17:59:00.000Z",
      lastSubmittedAt: "2026-10-11T10:00:00.000Z",
    },
    markId: null,
    mark: null,
    isNonSubmission: false,
    classification: null,
    releaseStatus: null,
    withheldReason: null,
    publishedAt: null,
    version: null,
    updatedAt: null,
    ...overrides,
  };
}

const AYESHA = row(1, "Ayesha Rahman");
const BILAL = row(2, "Bilal Khan", {}, "5 hours");
const CHAITY = row(3, "Chaity Das", {
  markId: "m3",
  mark: "57.0",
  classification: "PASS",
  releaseStatus: "PUBLISHED",
  publishedAt: "2026-10-12T04:00:00.000Z",
  version: 1,
  updatedAt: "2026-10-12T04:00:00.000Z",
});

function sheet(...items: MarksheetRow[]): Marksheet {
  return {
    assessmentId: ASSESSMENT_ID,
    total: items.length,
    summary: { entered: 0, missing: 0, draft: 0, published: 0, withheld: 0 },
    items,
  };
}

function dto(studentId: string, mark: string | null, overrides: Partial<MarkDto> = {}): MarkDto {
  return {
    markId: `m-${studentId}`,
    assessmentId: ASSESSMENT_ID,
    studentId,
    mark,
    isNonSubmission: mark === null,
    classification: "MERIT",
    releaseStatus: "DRAFT",
    withheldReason: null,
    publishedAt: null,
    version: 1,
    updatedAt: "2026-10-12T05:00:00.000Z",
    ...overrides,
  };
}

type Request = { url: string; init?: RequestInit; body?: Record<string, unknown> };
let requests: Request[];
function mockFetch(...answers: Response[]) {
  requests = [];
  const queue = [...answers];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({
        url,
        init,
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
      });
      const next = queue.shift();
      if (!next) throw new Error(`Unexpected request ${url}`);
      return next;
    }),
  );
}

function renderGrid(...items: MarksheetRow[]) {
  return render(
    <MarksheetGrid
      assessmentId={ASSESSMENT_ID}
      assessmentTitle="Essay 1"
      initial={sheet(...items)}
    />,
  );
}

const markBox = (name: string) => screen.getByRole("textbox", { name: `Mark for ${name}` });
const rowOf = (name: string) => screen.getByRole("link", { name }).closest("tr")!;

beforeEach(() => {
  refresh.mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("MarksheetGrid", () => {
  it("shows one row per student with the late flag, the mark and the release badge", () => {
    renderGrid(AYESHA, BILAL, CHAITY);
    expect(screen.getAllByRole("row")).toHaveLength(4); // header + 3
    expect(within(rowOf("Bilal Khan")).getByText("Late")).toBeTruthy();
    expect(within(rowOf("Bilal Khan")).getByText("5 hours")).toBeTruthy();
    expect(within(rowOf("Ayesha Rahman")).getByText("No mark yet")).toBeTruthy();
    expect((markBox("Chaity Das") as HTMLInputElement).value).toBe("57.0");
    expect(within(rowOf("Chaity Das")).getByText("Published")).toBeTruthy();
    expect(within(rowOf("Chaity Das")).getByText("Pass")).toBeTruthy();
  });

  it("shows the classification as you type, before anything is saved", async () => {
    const user = userEvent.setup();
    renderGrid(AYESHA);
    const box = markBox("Ayesha Rahman");
    await user.type(box, "69.5");
    expect(within(rowOf("Ayesha Rahman")).getByText("Distinction")).toBeTruthy();
    await user.clear(box);
    await user.type(box, "39.4");
    expect(within(rowOf("Ayesha Rahman")).getByText("Fail")).toBeTruthy();
    expect(within(rowOf("Ayesha Rahman")).getByText("Unsaved")).toBeTruthy();
  });

  it("Enter saves the row and moves to the next row's box; Shift+Enter moves back up", async () => {
    mockFetch(jsonResponse(dto("s1", "67.5"), 201));
    const user = userEvent.setup();
    renderGrid(AYESHA, BILAL, CHAITY);

    await user.type(markBox("Ayesha Rahman"), "67.5{Enter}");

    expect(document.activeElement).toBe(markBox("Bilal Khan"));
    await waitFor(() => expect(within(rowOf("Ayesha Rahman")).getByText("Saved")).toBeTruthy());
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: `/api/assessments/${ASSESSMENT_ID}/marks/s1`,
      init: { method: "PUT" },
      body: { mark: "67.5" }, // a first entry names no version
    });
    expect(requests[0]?.body).not.toHaveProperty("version");
    expect(within(rowOf("Ayesha Rahman")).getByText("Draft")).toBeTruthy();
    expect(within(rowOf("Ayesha Rahman")).getByText("Merit")).toBeTruthy();

    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(document.activeElement).toBe(markBox("Ayesha Rahman"));
    // Nothing was typed in Bilal's row, so nothing more was sent.
    expect(requests).toHaveLength(1);
  });

  it("arrow keys move between rows without losing what is typed; Tab keeps its normal order", async () => {
    mockFetch(jsonResponse(dto("s1", "50.0", { classification: "PASS" }), 201));
    const user = userEvent.setup();
    renderGrid(AYESHA, BILAL);
    await user.type(markBox("Ayesha Rahman"), "50");
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(markBox("Bilal Khan"));
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(markBox("Ayesha Rahman"));
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Non-submission for Ayesha Rahman" }),
    );
  });

  it("saves a changed mark when the box loses focus, sending the version it read", async () => {
    mockFetch(
      jsonResponse(dto("s1", "55.0", { classification: "PASS", version: 2 })),
      jsonResponse(dto("s1", "56.0", { classification: "PASS", version: 3 })),
    );
    const user = userEvent.setup();
    renderGrid(
      row(1, "Ayesha Rahman", {
        markId: "m-s1",
        mark: "50.0",
        classification: "PASS",
        releaseStatus: "DRAFT",
        version: 1,
      }),
    );
    const box = markBox("Ayesha Rahman");
    await user.clear(box);
    await user.type(box, "55");
    await user.tab();
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]?.body).toEqual({ mark: "55", version: 1 });
    await waitFor(() => expect((box as HTMLInputElement).value).toBe("55.0"));

    // The next change uses the version the first save returned.
    await user.clear(box);
    await user.type(box, "56");
    await user.tab();
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]?.body).toEqual({ mark: "56", version: 2 });
  });

  it("does not send anything when the mark did not change", async () => {
    mockFetch();
    const user = userEvent.setup();
    renderGrid(CHAITY);
    const box = markBox("Chaity Das");
    await user.click(box);
    await user.type(box, "{Enter}");
    await user.clear(box);
    await user.type(box, "57");
    await user.tab();
    expect(requests).toHaveLength(0);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("marks a non-submission by typing NS or pressing the NS button", async () => {
    mockFetch(
      jsonResponse(dto("s1", null, { classification: "FAIL" }), 201),
      jsonResponse(dto("s2", null, { classification: "FAIL" }), 201),
    );
    const user = userEvent.setup();
    renderGrid(AYESHA, BILAL);

    await user.type(markBox("Ayesha Rahman"), "ns{Enter}");
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]?.body).toEqual({ isNonSubmission: true });
    expect(
      within(rowOf("Ayesha Rahman")).getByText("NS", { selector: "[data-slot=status-badge]" }),
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Non-submission for Bilal Khan" }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]).toMatchObject({
      url: `/api/assessments/${ASSESSMENT_ID}/marks/s2`,
      body: { isNonSubmission: true },
    });
    expect(
      screen
        .getByRole("button", { name: "Non-submission for Bilal Khan" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("explains an invalid mark in the row and sends nothing", async () => {
    mockFetch();
    const user = userEvent.setup();
    renderGrid(AYESHA);
    const box = markBox("Ayesha Rahman");
    await user.type(box, "100.5{Enter}");
    expect(within(rowOf("Ayesha Rahman")).getByText(/between 0 and 100/)).toBeTruthy();
    expect(box.getAttribute("aria-invalid")).toBe("true");

    await user.clear(box);
    await user.type(box, "40.25{Enter}");
    expect(within(rowOf("Ayesha Rahman")).getByText(/one decimal place/)).toBeTruthy();
    expect(requests).toHaveLength(0);
  });

  it("puts the saved value back on Escape", async () => {
    const user = userEvent.setup();
    renderGrid(
      row(1, "Ayesha Rahman", {
        markId: "m1",
        mark: "50.0",
        classification: "PASS",
        releaseStatus: "DRAFT",
        version: 1,
      }),
    );
    const box = markBox("Ayesha Rahman");
    await user.clear(box);
    await user.type(box, "88{Escape}");
    expect((box as HTMLInputElement).value).toBe("50.0");
  });

  describe("a published mark", () => {
    it("asks for a reason before saving, then sends it with the change", async () => {
      mockFetch(
        jsonResponse(
          dto("s3", "62.5", {
            markId: "m3",
            releaseStatus: "PUBLISHED",
            publishedAt: "2026-10-12T04:00:00.000Z",
            version: 2,
          }),
        ),
      );
      const user = userEvent.setup();
      renderGrid(CHAITY);
      const box = markBox("Chaity Das");
      await user.clear(box);
      await user.type(box, "62.5{Enter}");

      const dialog = await screen.findByRole("dialog", { name: "Change a published mark" });
      expect(requests).toHaveLength(0);
      expect(within(dialog).getByText("57.0")).toBeTruthy();
      expect(within(dialog).getByText("62.5")).toBeTruthy();

      // An empty reason is refused by the form itself.
      await user.click(within(dialog).getByRole("button", { name: "Save change" }));
      expect(await within(dialog).findByText("Enter a reason.")).toBeTruthy();
      expect(requests).toHaveLength(0);

      await user.type(within(dialog).getByLabelText("Reason for the change"), "Appeal upheld");
      await user.click(within(dialog).getByRole("button", { name: "Save change" }));
      await waitFor(() => expect(requests).toHaveLength(1));
      expect(requests[0]).toMatchObject({
        init: { method: "PUT" },
        body: { mark: "62.5", version: 1, reason: "Appeal upheld" },
      });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect((markBox("Chaity Das") as HTMLInputElement).value).toBe("62.5");
      expect(within(rowOf("Chaity Das")).getByText("Published")).toBeTruthy();
    });

    it("puts the old mark back and sends nothing when the reason is cancelled", async () => {
      mockFetch();
      const user = userEvent.setup();
      renderGrid(CHAITY);
      const box = markBox("Chaity Das");
      await user.clear(box);
      await user.type(box, "62.5{Enter}");
      const dialog = await screen.findByRole("dialog", { name: "Change a published mark" });
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect((box as HTMLInputElement).value).toBe("57.0");
      expect(requests).toHaveLength(0);
    });
  });

  it("says when a colleague changed the mark first, and offers to reload that row", async () => {
    mockFetch(
      jsonResponse(
        apiErrorBody("VERSION_CONFLICT", "This record was changed.", { currentVersion: 4 }),
        409,
      ),
      jsonResponse(
        sheet(
          row(1, "Ayesha Rahman", {
            markId: "m1",
            mark: "71.0",
            classification: "DISTINCTION",
            releaseStatus: "DRAFT",
            version: 4,
          }),
        ),
      ),
    );
    const user = userEvent.setup();
    renderGrid(
      row(1, "Ayesha Rahman", {
        markId: "m1",
        mark: "50.0",
        classification: "PASS",
        releaseStatus: "DRAFT",
        version: 1,
      }),
    );
    const box = markBox("Ayesha Rahman");
    await user.clear(box);
    await user.type(box, "55");
    await user.tab();

    expect(await within(rowOf("Ayesha Rahman")).findByText(/Changed by someone else/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Reload this row" }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]?.url).toBe(`/api/assessments/${ASSESSMENT_ID}/marks`);
    // The row now holds the colleague's version; what was typed stays so it can be saved again on purpose.
    await waitFor(() =>
      expect(within(rowOf("Ayesha Rahman")).queryByText(/Changed by someone else/)).toBeNull(),
    );
  });

  describe("leaving with unsaved changes", () => {
    function leave() {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }

    it("warns while a mark is typed but not saved or refused, and not when everything is saved", async () => {
      const user = userEvent.setup();
      renderGrid(AYESHA);
      expect(leave()).toBe(false);
      await user.type(markBox("Ayesha Rahman"), "55");
      expect(leave()).toBe(true);
      await user.keyboard("{Escape}");
      expect(leave()).toBe(false);
    });

    it("asks before an in-app link is followed, and stays when the answer is no", async () => {
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      const user = userEvent.setup();
      renderGrid(AYESHA);
      await user.type(markBox("Ayesha Rahman"), "100.5{Enter}"); // refused: stays unsaved
      const link = screen.getByRole("link", { name: "Ayesha Rahman" });
      const clicked = link.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(clicked).toBe(false); // the navigation was cancelled
      confirm.mockRestore();
    });
  });

  describe("selection and release actions", () => {
    it("enables Withhold and Unpublish only for ticked rows, and sends the reason with the mark ids", async () => {
      mockFetch(
        jsonResponse({ changed: 1, skipped: 0, markIds: ["m3"] }),
        jsonResponse(
          sheet(AYESHA, { ...CHAITY, releaseStatus: "WITHHELD", withheldReason: "Fees" }),
        ),
      );
      const user = userEvent.setup();
      renderGrid(AYESHA, CHAITY);

      const withholdButton = screen.getByRole("button", { name: /Withhold selected/ });
      expect((withholdButton as HTMLButtonElement).disabled).toBe(true);
      expect(
        (screen.getByRole("checkbox", { name: "Select Ayesha Rahman" }) as HTMLInputElement)
          .disabled,
      ).toBe(true);

      await user.click(screen.getByRole("checkbox", { name: "Select Chaity Das" }));
      expect((withholdButton as HTMLButtonElement).disabled).toBe(false);
      await user.click(withholdButton);

      const dialog = await screen.findByRole("dialog", { name: "Withhold selected results" });
      await user.type(within(dialog).getByLabelText("Reason"), "Fees");
      await user.click(within(dialog).getByRole("button", { name: "Withhold" }));

      await waitFor(() => expect(requests.length).toBeGreaterThanOrEqual(1));
      expect(requests[0]).toMatchObject({
        url: "/api/marks/withhold",
        init: { method: "POST" },
        body: { markIds: ["m3"], reason: "Fees" },
      });
      await waitFor(() => expect(within(rowOf("Chaity Das")).getByText("Withheld")).toBeTruthy());
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith("Withheld 1 mark.");
    });

    it("select-all ticks every row that has a mark", async () => {
      const user = userEvent.setup();
      renderGrid(AYESHA, CHAITY);
      await user.click(screen.getByRole("checkbox", { name: "Select all marks" }));
      expect(
        (screen.getByRole("checkbox", { name: "Select Chaity Das" }) as HTMLInputElement).checked,
      ).toBe(true);
      expect(
        (screen.getByRole("checkbox", { name: "Select Ayesha Rahman" }) as HTMLInputElement)
          .checked,
      ).toBe(false);
    });

    it("opens the publish preview from the Publish… button", async () => {
      mockFetch(
        jsonResponse({
          dryRun: true,
          published: 0,
          toPublish: 2,
          alreadyPublished: 0,
          missingMarks: [],
          overdueStudents: [],
          overdueTotal: "0.00",
          summary: "Publish 2 marks",
        }),
      );
      const user = userEvent.setup();
      renderGrid(AYESHA, CHAITY);
      await user.click(screen.getByRole("button", { name: "Publish…" }));
      const dialog = await screen.findByRole("dialog", { name: "Publish results" });
      expect(await within(dialog).findByText("Publish 2 marks", { selector: "p" })).toBeTruthy();
      expect(requests[0]).toMatchObject({
        url: "/api/marks/publish",
        body: { assessmentId: ASSESSMENT_ID, dryRun: true },
      });
    });
  });

  it("explains an empty marksheet", () => {
    renderGrid();
    expect(screen.getByText("No students to mark yet")).toBeTruthy();
  });
});
