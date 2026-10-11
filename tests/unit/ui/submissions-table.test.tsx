// @vitest-environment jsdom
import { apiErrorBody, jsonResponse } from "@/tests/support/dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubmissionsTable } from "@/components/assessments/submissions-table";
import { formatFileSize } from "@/components/format/file-size";
import type { AssessmentSubmissions, SubmissionRow } from "@/lib/services/assessments";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const DEADLINE = "2026-10-11T17:59:00.000Z";
const PROGRAMME = { id: "p1", code: "BSC-CSE", name: "BSc in Computer Science" };

function file(id: string, version: number, name: string, uploadedAt: string, size = 48_200) {
  return {
    id,
    version,
    fileName: name,
    mimeType: "application/pdf",
    sizeBytes: size,
    sha256: String(version).repeat(64),
    uploadedAt,
  };
}

const v1 = file("f1", 1, "draft.pdf", "2026-10-10T08:00:00.000Z");
const v2 = file("f2", 2, "পোর্টফোলিও.pdf", "2026-10-11T09:00:00.000Z", 1_500_000);

const ON_TIME: SubmissionRow = {
  student: {
    id: "s1",
    studentNumber: "SMS-2026-0001",
    fullName: "Ayesha Rahman",
    status: "ENROLLED",
    programme: PROGRAMME,
  },
  eligible: true,
  status: "ON_TIME",
  lateBy: null,
  deadline: DEADLINE,
  extension: null,
  submission: {
    id: "sub1",
    firstSubmittedAt: v1.uploadedAt,
    lastSubmittedAt: v2.uploadedAt,
  },
  currentFile: v2,
  versions: [v2, v1],
};

const LATE: SubmissionRow = {
  ...ON_TIME,
  student: {
    ...ON_TIME.student,
    id: "s2",
    studentNumber: "SMS-2026-0002",
    fullName: "Tanvir Hasan",
  },
  status: "LATE",
  lateBy: "2 days",
  extension: { newDeadline: "2026-10-12T17:59:00.000Z", reason: "Medical grounds" },
  submission: {
    id: "sub2",
    firstSubmittedAt: "2026-10-13T10:00:00.000Z",
    lastSubmittedAt: "2026-10-13T10:00:00.000Z",
  },
  currentFile: file("f3", 1, "essay.pdf", "2026-10-13T10:00:00.000Z"),
  versions: [file("f3", 1, "essay.pdf", "2026-10-13T10:00:00.000Z")],
};

const NOT_SUBMITTED: SubmissionRow = {
  ...ON_TIME,
  student: {
    ...ON_TIME.student,
    id: "s3",
    studentNumber: "SMS-2026-0003",
    fullName: "Nusrat Jahan",
  },
  status: "NOT_SUBMITTED",
  submission: null,
  currentFile: null,
  versions: [],
};

const WITHDRAWN: SubmissionRow = {
  ...ON_TIME,
  student: {
    ...ON_TIME.student,
    id: "s4",
    studentNumber: "SMS-2026-0004",
    fullName: "Habib Ullah",
    status: "WITHDRAWN",
  },
  eligible: false,
  currentFile: file("f4", 1, "late-work.pdf", "2026-10-10T08:00:00.000Z"),
  versions: [file("f4", 1, "late-work.pdf", "2026-10-10T08:00:00.000Z")],
};

function submissions(items: SubmissionRow[]): AssessmentSubmissions {
  return {
    assessmentId: "a1",
    total: items.length,
    summary: {
      onTime: items.filter((r) => r.status === "ON_TIME").length,
      late: items.filter((r) => r.status === "LATE").length,
      notSubmitted: items.filter((r) => r.status === "NOT_SUBMITTED").length,
    },
    items,
  };
}

function rowOf(name: string) {
  return screen.getByRole("link", { name }).closest("tr")!;
}

beforeEach(() => vi.mocked(toast.error).mockClear());
afterEach(() => vi.unstubAllGlobals());

describe("SubmissionsTable", () => {
  it("shows a status badge for each student: on time, late with how late, not submitted", () => {
    render(<SubmissionsTable submissions={submissions([ON_TIME, LATE, NOT_SUBMITTED])} />);

    expect(within(rowOf("Ayesha Rahman")).getByText("On time")).toBeTruthy();
    const late = within(rowOf("Tanvir Hasan")).getByText("Late").parentElement!;
    expect(late.textContent).toBe("Late·2 days");
    expect(within(rowOf("Nusrat Jahan")).getByText("Not submitted")).toBeTruthy();
    expect(screen.getByText(/3 students/).textContent).toMatch(
      /1 on time, 1 late, 1 not submitted/,
    );
  });

  it("shows the current file, the effective deadline and an extension with its reason", () => {
    render(<SubmissionsTable submissions={submissions([ON_TIME, LATE])} />);
    expect(within(rowOf("Ayesha Rahman")).getByText("পোর্টফোলিও.pdf")).toBeTruthy();
    expect(within(rowOf("Ayesha Rahman")).getByText("1.4 MB")).toBeTruthy();
    expect(within(rowOf("Tanvir Hasan")).getByText(/Extended/).textContent).toContain(
      "Medical grounds",
    );
  });

  it("offers no download or versions for a student who has not submitted", () => {
    render(<SubmissionsTable submissions={submissions([NOT_SUBMITTED])} />);
    const row = rowOf("Nusrat Jahan");
    expect(within(row).queryByRole("button", { name: /Download/ })).toBeNull();
    expect(within(row).queryByRole("button", { name: /versions/ })).toBeNull();
  });

  it("labels a student who submitted but is no longer eligible, with their current status", () => {
    render(<SubmissionsTable submissions={submissions([WITHDRAWN])} />);
    const row = rowOf("Habib Ullah");
    expect(within(row).getByText("Withdrawn")).toBeTruthy();
    expect(within(row).getByText(/No longer eligible/)).toBeTruthy();
    expect(within(row).getByText("On time")).toBeTruthy(); // still shown with the submission status
  });

  it("expands every version with name, size, arrival time and SHA-256, and collapses again", async () => {
    const user = userEvent.setup();
    render(<SubmissionsTable submissions={submissions([ON_TIME])} />);

    const toggle = screen.getByRole("button", { name: "Show versions for Ayesha Rahman" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toContain("2 versions");
    expect(screen.queryByRole("list", { name: /Versions submitted by/ })).toBeNull();

    await user.click(toggle);
    const list = screen.getByRole("list", { name: "Versions submitted by Ayesha Rahman" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain("Version 2");
    expect(items[0]!.textContent).toContain("Current");
    expect(items[0]!.textContent).toContain("পোর্টফোলিও.pdf");
    expect(items[0]!.textContent).toContain("2".repeat(64));
    expect(items[0]!.textContent).toContain("11 Oct 2026, 15:00"); // 09:00 UTC in Dhaka
    expect(items[1]!.textContent).toContain("Version 1");
    expect(items[1]!.textContent).not.toContain("Current");
    expect(within(items[1]!).getByRole("button", { name: "Download draft.pdf" })).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Hide versions for Ayesha Rahman" })
        .getAttribute("aria-expanded"),
    ).toBe("true");

    await user.click(screen.getByRole("button", { name: "Hide versions for Ayesha Rahman" }));
    expect(screen.queryByRole("list", { name: /Versions submitted by/ })).toBeNull();
  });

  it("downloads through the API: asks for a link, then follows it", async () => {
    const clicked: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this.href);
    });
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        url: "http://storage.test/file?sig=1",
        expiresAt: "2026-10-12T04:05:00.000Z",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<SubmissionsTable submissions={submissions([ON_TIME])} />);

    await user.click(
      within(rowOf("Ayesha Rahman")).getByRole("button", { name: "Download পোর্টফোলিও.pdf" }),
    );

    await waitFor(() => expect(clicked).toEqual(["http://storage.test/file?sig=1"]));
    expect(fetchMock).toHaveBeenCalledWith("/api/files/f2/download", expect.anything());
    click.mockRestore();
  });

  it("shows the error when the download link cannot be made", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(apiErrorBody("NOT_FOUND", "File not found."), 404)),
    );
    const user = userEvent.setup();
    render(<SubmissionsTable submissions={submissions([ON_TIME])} />);
    await user.click(within(rowOf("Ayesha Rahman")).getByRole("button", { name: /Download/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("File not found."));
  });

  it("explains an empty list", () => {
    render(<SubmissionsTable submissions={submissions([])} />);
    expect(screen.getByText("No eligible students yet")).toBeTruthy();
  });
});

describe("formatFileSize", () => {
  it("uses bytes, KB and MB", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(812)).toBe("812 B");
    expect(formatFileSize(1024)).toBe("1.0 KB");
    expect(formatFileSize(48_200)).toBe("47.1 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatFileSize(-1)).toBe("—");
  });
});
