// @vitest-environment jsdom
import { apiErrorBody, jsonResponse } from "@/tests/support/dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MyAssessmentCard } from "@/components/submissions/my-assessment-card";
import { ReceiptCard } from "@/components/submissions/receipt-card";
import { UploadPanel } from "@/components/submissions/upload-panel";
import type { MyAssessment, MyCanUpload } from "@/lib/services/submissions";
import { FakeXhr } from "../../support/fake-xhr";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const ASSESSMENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PENDING_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MB = 1024 * 1024;
const SHA = "ac924d08b121355adc8036236965384d12f1af07d2c2142585619ac19ed8f691";

const ALLOWED: MyCanUpload = { allowed: true, reason: null, message: null, late: false };

const ISSUED = {
  pendingUploadId: PENDING_ID,
  uploadUrl: "http://storage.test/submissions/key.pdf?X-Amz-Signature=abc",
  headers: { "Content-Type": "application/pdf" },
  expiresAt: "2026-10-12T04:15:00.000Z",
  late: false,
};
const RECEIPT = {
  submissionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  fileName: "essay.pdf",
  sizeBytes: 1234,
  sha256: SHA,
  uploadedAt: "2026-10-12T04:00:05.000Z",
  late: false,
  lateBy: null,
};

function pdfFile(name = "essay.pdf", size = 1234, type = "application/pdf") {
  const file = new File(["%PDF-1.7 content"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

type Call = { url: string; init?: RequestInit };
let calls: Call[];
function mockFetch(...answers: (Response | Error)[]) {
  calls = [];
  const queue = [...answers];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const next = queue.shift();
      if (!next) throw new Error(`Unexpected request ${init?.method ?? "GET"} ${url}`);
      if (next instanceof Error) throw next;
      return next;
    }),
  );
}

const user = () => userEvent.setup({ applyAccept: false });

/** The text of whatever an element points at with aria-describedby (its accessible description). */
function describedBy(element: HTMLElement): string {
  return (element.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}

function renderPanel(props: Partial<React.ComponentProps<typeof UploadPanel>> = {}) {
  return render(
    <UploadPanel
      assessmentId={ASSESSMENT_ID}
      canUpload={ALLOWED}
      hasSubmission={false}
      maxBytes={20 * MB}
      {...props}
    />,
  );
}

/** Waits for the PUT to start (after the upload-url answer) and returns its fake request. */
async function nextPut() {
  await waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
  return FakeXhr.instances[0]!;
}

beforeEach(() => {
  refresh.mockClear();
  FakeXhr.instances = [];
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.info).mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("UploadPanel when uploading is not allowed", () => {
  it("disables the button and writes the reason in plain words", () => {
    renderPanel({
      canUpload: {
        allowed: false,
        reason: "CLOSED",
        message: "This assessment is closed. Uploads are no longer accepted, not even late ones.",
        late: false,
      },
    });
    const button = screen.getByRole("button", { name: "Upload" });
    expect(button).toHaveProperty("disabled", true);
    expect(screen.getByText(/This assessment is closed/)).toBeTruthy();
    expect(describedBy(button)).toMatch(/This assessment is closed/);
    expect(screen.queryByLabelText(/Choose your file/)).toBeNull();
  });
});

describe("UploadPanel pre-checks", () => {
  it("shows the rule that uploads count from when they finish", () => {
    renderPanel();
    expect(
      screen.getByText("Submission time is when your upload finishes, not when you start it."),
    ).toBeTruthy();
  });

  it("warns that an upload after the deadline will be marked late", () => {
    renderPanel({ canUpload: { ...ALLOWED, late: true } });
    expect(screen.getByText(/accepted but marked late/)).toBeTruthy();
  });

  it("labels the button as a replacement when the student already has a file", () => {
    renderPanel({ hasSubmission: true });
    expect(screen.getByRole("button", { name: "Upload replacement" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByLabelText("Choose a replacement file")).toBeTruthy();
  });

  it.each([
    ["essay.docm", 100, /Macro-enabled/],
    ["notes.txt", 100, /Only PDF/],
    ["essay.pdf", 0, /empty/],
    ["essay.pdf", 20 * MB + 1, /too large\. The limit is 20 MB/],
  ])("blocks %s (%i bytes) before anything is sent", async (name, size, message) => {
    mockFetch();
    renderPanel();
    await user().upload(screen.getByLabelText("Choose your file"), pdfFile(name, size));
    expect((await screen.findByRole("alert")).textContent).toMatch(message);
    expect(screen.getByRole("button", { name: "Upload" })).toHaveProperty("disabled", true);
    expect(calls).toHaveLength(0);
  });

  it("accepts a file exactly at the limit", async () => {
    renderPanel();
    await user().upload(screen.getByLabelText("Choose your file"), pdfFile("essay.pdf", 20 * MB));
    expect(screen.getByRole("button", { name: "Upload" })).toHaveProperty("disabled", false);
  });
});

describe("UploadPanel upload flow", () => {
  it("asks for a URL, PUTs with the signed headers, confirms, and shows the receipt", async () => {
    mockFetch(jsonResponse(ISSUED), jsonResponse(RECEIPT));
    renderPanel();
    const u = user();
    await u.upload(screen.getByLabelText("Choose your file"), pdfFile());
    await u.click(screen.getByRole("button", { name: "Upload" }));

    // Step 1: the request describes the real file.
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.url).toBe(`/api/assessments/${ASSESSMENT_ID}/submission/upload-url`);
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      fileName: "essay.pdf",
      contentType: "application/pdf",
      sizeBytes: 1234,
    });

    // Step 2: straight to storage, with exactly the headers it was given, and progress shown.
    const xhr = await nextPut();
    expect(xhr.method).toBe("PUT");
    expect(xhr.url).toBe(ISSUED.uploadUrl);
    expect(xhr.headers).toEqual(ISSUED.headers);
    xhr.progress(617, 1234);
    expect(await screen.findByText("Uploading... 50%")).toBeTruthy();
    expect(
      screen.getByRole("progressbar", { name: "Upload progress" }).getAttribute("aria-valuenow"),
    ).toBe("50");
    xhr.finish(200);

    // Step 3: confirm, then the receipt.
    expect(await screen.findByText("Upload received")).toBeTruthy();
    expect(calls[1]!.url).toBe(`/api/assessments/${ASSESSMENT_ID}/submission/confirm`);
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({ pendingUploadId: PENDING_ID });
    expect(screen.getByText(SHA)).toBeTruthy();
    expect(screen.getByText("On time")).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith("File received on time.");
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Upload" })).toHaveProperty("disabled", true); // the file input was cleared
  });

  it("says when the received file is late", async () => {
    mockFetch(jsonResponse(ISSUED), jsonResponse({ ...RECEIPT, late: true, lateBy: "3 hours" }));
    renderPanel();
    const u = user();
    await u.upload(screen.getByLabelText("Choose your file"), pdfFile());
    await u.click(screen.getByRole("button", { name: "Upload" }));
    (await nextPut()).finish(200);
    expect(await screen.findByText("Upload received")).toBeTruthy();
    expect(screen.getByText("Late")).toBeTruthy();
    expect(screen.getByText("3 hours")).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith("File received. It is marked late.");
  });

  it("retries the confirm when the connection drops, because confirm is idempotent", async () => {
    mockFetch(jsonResponse(ISSUED), new TypeError("Failed to fetch"), jsonResponse(RECEIPT));
    renderPanel();
    const u = user();
    await u.upload(screen.getByLabelText("Choose your file"), pdfFile());
    await u.click(screen.getByRole("button", { name: "Upload" }));
    (await nextPut()).finish(200);
    expect(await screen.findByText("Upload received")).toBeTruthy();
    expect(calls.map((c) => c.url.split("/").pop())).toEqual(["upload-url", "confirm", "confirm"]);
  });

  it("shows the server's reason and refreshes the page when a rule says no", async () => {
    mockFetch(
      jsonResponse(
        apiErrorBody("BUSINESS_RULE", "This assessment is closed.", { rule: "CLOSED" }),
        422,
      ),
    );
    renderPanel();
    const u = user();
    await u.upload(screen.getByLabelText("Choose your file"), pdfFile());
    await u.click(screen.getByRole("button", { name: "Upload" }));
    expect(await screen.findByText("This assessment is closed.")).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
    expect(FakeXhr.instances).toHaveLength(0); // nothing was sent to storage
  });

  it("shows the file problem the server found at confirm", async () => {
    mockFetch(
      jsonResponse(ISSUED),
      jsonResponse(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "This file is not a valid PDF.",
            details: { fieldErrors: { file: ["This file is not a valid PDF."] } },
          },
        },
        400,
      ),
    );
    renderPanel();
    const u = user();
    await u.upload(screen.getByLabelText("Choose your file"), pdfFile());
    await u.click(screen.getByRole("button", { name: "Upload" }));
    (await nextPut()).finish(200);
    expect(await screen.findByText("This file is not a valid PDF.")).toBeTruthy();
    expect(screen.queryByText("Upload received")).toBeNull();
  });

  it("stops before confirming when storage refuses the file", async () => {
    mockFetch(jsonResponse(ISSUED));
    renderPanel();
    const u = user();
    await u.upload(screen.getByLabelText("Choose your file"), pdfFile());
    await u.click(screen.getByRole("button", { name: "Upload" }));
    (await nextPut()).finish(403);
    expect(await screen.findByText(/Storage refused the file/)).toBeTruthy();
    expect(calls).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Upload" })).toHaveProperty("disabled", false); // can try again
  });

  it("lets the student cancel while the file is going out", async () => {
    mockFetch(jsonResponse(ISSUED));
    renderPanel();
    const u = user();
    await u.upload(screen.getByLabelText("Choose your file"), pdfFile());
    await u.click(screen.getByRole("button", { name: "Upload" }));
    const xhr = await nextPut();
    await u.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith("Upload cancelled."));
    expect(xhr.aborted).toBe(true);
    expect(calls).toHaveLength(1); // no confirm
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});

describe("ReceiptCard", () => {
  it("shows the facts that settle a dispute: name, size, time in Dhaka and the fingerprint", () => {
    render(<ReceiptCard receipt={RECEIPT} />);
    expect(screen.getByText("essay.pdf")).toBeTruthy();
    expect(screen.getByText("1.2 KB")).toBeTruthy();
    expect(screen.getByText("12 Oct 2026, 10:00")).toBeTruthy(); // 04:00 UTC is 10:00 in Dhaka
    expect(screen.getByText(/Received \(Asia\/Dhaka\)/)).toBeTruthy();
    expect(screen.getByText(SHA)).toBeTruthy();
  });
});

describe("MyAssessmentCard", () => {
  const base: MyAssessment = {
    id: ASSESSMENT_ID,
    title: "Essay 1",
    module: { id: "m1", code: "ENG101", title: "English Composition" },
    deadline: "2026-10-13T17:59:00.000Z",
    extended: false,
    closedAt: null,
    state: "open",
    status: "NOT_SUBMITTED",
    lateBy: null,
    canUpload: ALLOWED,
    submission: null,
  };
  const NOW = "2026-10-12T04:00:00.000Z";

  it("offers Upload as a link to the detail page and a countdown to the deadline", () => {
    render(
      <ul>
        <MyAssessmentCard assessment={base} serverNow={NOW} />
      </ul>,
    );
    expect(screen.getByRole("link", { name: "Upload" }).getAttribute("href")).toBe(
      `/student/assessments/${ASSESSMENT_ID}`,
    );
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("Not submitted")).toBeTruthy();
    expect(screen.getByRole("timer").textContent).toBe("1d 13h 59m 0s");
    expect(screen.getByText("Deadline (Asia/Dhaka)")).toBeTruthy();
    expect(screen.getByText("Nothing uploaded yet.")).toBeTruthy();
  });

  it("shows the current file and receipt summary, and Replace file", () => {
    render(
      <ul>
        <MyAssessmentCard
          serverNow={NOW}
          assessment={{
            ...base,
            status: "ON_TIME",
            submission: {
              id: RECEIPT.submissionId,
              firstSubmittedAt: RECEIPT.uploadedAt,
              lastSubmittedAt: RECEIPT.uploadedAt,
              status: "ON_TIME",
              lateBy: null,
              currentFile: {
                id: "f1",
                version: 1,
                fileName: "essay.pdf",
                mimeType: "application/pdf",
                sizeBytes: 1234,
                sha256: SHA,
                uploadedAt: RECEIPT.uploadedAt,
                late: false,
                lateBy: null,
              },
              versions: [],
            },
          }}
        />
      </ul>,
    );
    expect(screen.getByRole("link", { name: "Replace file" })).toBeTruthy();
    expect(screen.getByText("essay.pdf")).toBeTruthy();
    expect(screen.getByText(/SHA-256 ac924d08b121355a/)).toBeTruthy();
    expect(screen.getByText("On time")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Receipts and history" })).toBeTruthy();
  });

  it("disables the button and explains why when the assessment is closed", () => {
    render(
      <ul>
        <MyAssessmentCard
          serverNow={NOW}
          assessment={{
            ...base,
            state: "closed",
            status: "CLOSED",
            closedAt: "2026-10-11T00:00:00.000Z",
            canUpload: {
              allowed: false,
              reason: "CLOSED",
              message:
                "This assessment is closed. Uploads are no longer accepted, not even late ones.",
              late: false,
            },
          }}
        />
      </ul>,
    );
    const button = screen.getByRole("button", { name: "Upload" });
    expect(button).toHaveProperty("disabled", true);
    expect(describedBy(button)).toMatch(/This assessment is closed/);
    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.getByText("Closed: no uploads")).toBeTruthy();
    // "Closed" appears once as a badge, not twice.
    expect(screen.getAllByText("Closed")).toHaveLength(1);
  });

  it("marks a late file with how late it is", () => {
    render(
      <ul>
        <MyAssessmentCard
          serverNow={NOW}
          assessment={{ ...base, state: "past-deadline", status: "LATE", lateBy: "2 days" }}
        />
      </ul>,
    );
    expect(screen.getByText("Late")).toBeTruthy();
    expect(screen.getByText("2 days")).toBeTruthy();
    expect(screen.getByText("Past deadline")).toBeTruthy();
  });
});
