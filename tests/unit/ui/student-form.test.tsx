// @vitest-environment jsdom
import { apiErrorBody, jsonResponse } from "@/tests/support/dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudentForm, type StudentFormProps } from "@/components/students/student-form";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const PROGRAMME_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHORT_PROGRAMME_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const STUDENT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const PROGRAMMES: StudentFormProps["programmes"] = [
  { id: PROGRAMME_ID, code: "BSC-CSE", name: "BSc in Computer Science", durationYears: 4 },
  { id: SHORT_PROGRAMME_ID, code: "DIP", name: "Diploma in Design", durationYears: 2 },
];

const MATCH = {
  id: OTHER_ID,
  studentNumber: "SMS-2026-0009",
  fullName: "Ayesha Rahman",
  email: "ayesha.old@example.edu",
  dateOfBirth: "2005-03-14",
  status: "ENROLLED",
  programme: { id: PROGRAMME_ID, code: "BSC-CSE", name: "BSc in Computer Science" },
};

const CREATED = {
  id: STUDENT_ID,
  studentNumber: "SMS-2026-0031",
  fullName: "Ayesha Rahman",
  status: "ENROLLED",
  version: 1,
};

function renderForm(overrides: Partial<StudentFormProps> = {}) {
  return render(
    <StudentForm
      mode={{ kind: "create" }}
      programmes={PROGRAMMES}
      academicYears={["2026-27", "2025-26"]}
      initialValues={{ academicYear: "2026-27" }}
      {...overrides}
    />,
  );
}

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Full name"), "Ayesha Rahman");
  await user.type(screen.getByLabelText("Email"), "Ayesha.New@Example.edu");
  await user.type(screen.getByLabelText("Date of birth"), "2005-03-14");
  await user.click(screen.getByRole("combobox", { name: "Programme" }));
  await user.click(screen.getByRole("option", { name: /BSc in Computer Science/ }));
}

type Request = { url: string; init?: RequestInit };
let requests: Request[];

function bodyOf(request: Request | undefined): Record<string, unknown> {
  return JSON.parse(String(request?.init?.body)) as Record<string, unknown>;
}

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
  push.mockClear();
  refresh.mockClear();
  for (const fn of Object.values(toast)) vi.mocked(fn).mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("new student form: validation", () => {
  it("shows what is missing and sends nothing", async () => {
    mockFetch();
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("button", { name: "Create student" }));

    expect(await screen.findByText("Enter the full name.")).toBeTruthy();
    expect(screen.getByText("Enter an email address.")).toBeTruthy();
    expect(screen.getByText("Enter the date of birth.")).toBeTruthy();
    expect(screen.getByText("Choose a programme.")).toBeTruthy();
    expect(requests).toHaveLength(0);
    expect(screen.getByLabelText("Full name").getAttribute("aria-invalid")).toBe("true");
  });

  it("rejects a malformed email", async () => {
    mockFetch();
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Create student" }));
    expect(await screen.findByText("Enter a valid email address.")).toBeTruthy();
  });

  it("rejects a date of birth in the future and an implausible age", async () => {
    mockFetch();
    const user = userEvent.setup();
    renderForm();

    const dob = screen.getByLabelText("Date of birth");
    await user.type(dob, "2999-01-01");
    await user.click(screen.getByRole("button", { name: "Create student" }));
    expect(await screen.findByText("Date of birth cannot be in the future.")).toBeTruthy();

    await user.clear(dob);
    await user.type(dob, "2020-06-01");
    await user.click(screen.getByRole("button", { name: "Create student" }));
    expect(await screen.findByText("Students must be at least 16 years old.")).toBeTruthy();

    await user.clear(dob);
    await user.type(dob, "1900-01-01");
    await user.click(screen.getByRole("button", { name: "Create student" }));
    expect(await screen.findByText("Students must be at most 100 years old.")).toBeTruthy();
    expect(requests).toHaveLength(0);
  });

  it("offers only the years the chosen programme runs for, and clamps the year when it shrinks", async () => {
    mockFetch();
    const user = userEvent.setup();
    renderForm({ initialValues: { academicYear: "2026-27", yearOfStudy: 4 } });

    await user.click(screen.getByRole("combobox", { name: "Programme" }));
    await user.click(screen.getByRole("option", { name: /Diploma in Design/ }));
    // Year 4 does not exist in a two-year diploma: the select now shows year 2.
    expect(screen.getByRole("combobox", { name: "Year of study" }).textContent).toContain("Year 2");

    await user.click(screen.getByRole("combobox", { name: "Year of study" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Year 1", "Year 2"]);
  });

  it("says the Student ID is assigned on save", () => {
    renderForm();
    expect(screen.getByText("The Student ID is assigned when you save.")).toBeTruthy();
  });
});

describe("new student form: saving", () => {
  it("creates the student and opens the record, toasting any warning", async () => {
    mockFetch(
      jsonResponse(
        {
          ...CREATED,
          warnings: [{ code: "NO_FEE_SCHEDULE", message: "No fee schedule for 2026-27." }],
        },
        201,
      ),
    );
    const user = userEvent.setup();
    renderForm();
    await fillValid(user);
    await user.click(screen.getByRole("button", { name: "Create student" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/staff/students/${STUDENT_ID}`));
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("/api/students");
    expect(requests[0]!.init?.method).toBe("POST");
    expect(bodyOf(requests[0])).toEqual({
      fullName: "Ayesha Rahman",
      email: "ayesha.new@example.edu",
      dateOfBirth: "2005-03-14",
      programmeId: PROGRAMME_ID,
      academicYear: "2026-27",
      yearOfStudy: 1,
    });
    expect(toast.success).toHaveBeenCalledWith("Created Ayesha Rahman (SMS-2026-0031).");
    expect(toast.warning).toHaveBeenCalledWith("No fee schedule for 2026-27.", expect.anything());
  });

  it("puts a server field error on the field", async () => {
    mockFetch(
      jsonResponse(
        apiErrorBody("VALIDATION_ERROR", "Some fields are invalid.", {
          fieldErrors: { yearOfStudy: ["This programme runs for 2 years."] },
        }),
        400,
      ),
    );
    const user = userEvent.setup();
    renderForm();
    await fillValid(user);
    await user.click(screen.getByRole("button", { name: "Create student" }));
    expect(await screen.findByText("This programme runs for 2 years.")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it("shows a taken email on the email field with a link to the existing record", async () => {
    mockFetch(
      jsonResponse(
        apiErrorBody("CONFLICT", "A student with this email address already exists.", {
          field: "email",
          existing: { id: OTHER_ID, studentNumber: "SMS-2026-0009", fullName: "Ayesha Rahman" },
        }),
        409,
      ),
    );
    const user = userEvent.setup();
    renderForm();
    await fillValid(user);
    await user.click(screen.getByRole("button", { name: "Create student" }));

    expect(
      await screen.findByText("A student with this email address already exists."),
    ).toBeTruthy();
    const link = screen.getByRole("link", { name: /Ayesha Rahman \(SMS-2026-0009\)/ });
    expect(link.getAttribute("href")).toBe(`/staff/students/${OTHER_ID}`);
    expect(push).not.toHaveBeenCalled();
  });
});

describe("new student form: duplicate warning", () => {
  const duplicateResponse = () =>
    jsonResponse(
      apiErrorBody(
        "DUPLICATE_WARNING",
        "A student with the same name and date of birth already exists.",
        { matches: [MATCH] },
      ),
      409,
    );

  it("lists the matches, and 'Create anyway' resends with confirmDuplicate", async () => {
    mockFetch(duplicateResponse(), jsonResponse(CREATED, 201));
    const user = userEvent.setup();
    renderForm();
    await fillValid(user);
    await user.click(screen.getByRole("button", { name: "Create student" }));

    const dialog = await screen.findByRole("dialog", {
      name: "This student may already be registered",
    });
    expect(within(dialog).getByText("Ayesha Rahman")).toBeTruthy();
    expect(within(dialog).getByText("SMS-2026-0009")).toBeTruthy();
    expect(within(dialog).getByText("ayesha.old@example.edu")).toBeTruthy();
    expect(within(dialog).getByText("14 Mar 2005")).toBeTruthy();
    expect(within(dialog).getByText("Enrolled")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    expect(bodyOf(requests[0])).not.toHaveProperty("confirmDuplicate");

    await user.click(within(dialog).getByRole("button", { name: "Create anyway" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/staff/students/${STUDENT_ID}`));
    expect(requests).toHaveLength(2);
    expect(bodyOf(requests[1])).toMatchObject({
      fullName: "Ayesha Rahman",
      email: "ayesha.new@example.edu",
      confirmDuplicate: true,
    });
  });

  it("cancelling closes the dialog without creating anything", async () => {
    mockFetch(duplicateResponse());
    const user = userEvent.setup();
    renderForm();
    await fillValid(user);
    await user.click(screen.getByRole("button", { name: "Create student" }));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(requests).toHaveLength(1);
    expect(push).not.toHaveBeenCalled();
    // The form is still filled in, so the user can correct the details instead.
    expect((screen.getByLabelText("Full name") as HTMLInputElement).value).toBe("Ayesha Rahman");
  });
});

describe("edit student form", () => {
  const editProps: Partial<StudentFormProps> = {
    mode: { kind: "edit", id: STUDENT_ID, studentNumber: "SMS-2026-0031", version: 3 },
    initialValues: {
      fullName: "Ayesha Rahman",
      email: "ayesha@example.edu",
      dateOfBirth: "2005-03-14",
      programmeId: PROGRAMME_ID,
      academicYear: "2026-27",
      yearOfStudy: 2,
    },
  };

  it("shows the Student ID as read-only text and the stored values", () => {
    renderForm(editProps);
    expect(screen.getByText("SMS-2026-0031")).toBeTruthy();
    expect((screen.getByLabelText("Full name") as HTMLInputElement).value).toBe("Ayesha Rahman");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
  });

  it("sends only the changed fields with the version it was opened at", async () => {
    mockFetch(jsonResponse({ ...CREATED, version: 4 }));
    const user = userEvent.setup();
    renderForm(editProps);

    const name = screen.getByLabelText("Full name");
    await user.clear(name);
    await user.type(name, "Ayesha R. Rahman");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/staff/students/${STUDENT_ID}`));
    expect(requests[0]!.url).toBe(`/api/students/${STUDENT_ID}`);
    expect(requests[0]!.init?.method).toBe("PATCH");
    expect(bodyOf(requests[0])).toEqual({ fullName: "Ayesha R. Rahman", version: 3 });
  });

  it("says nothing changed instead of calling the API", async () => {
    mockFetch();
    const user = userEvent.setup();
    renderForm(editProps);
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith("Nothing to save: no fields were changed."),
    );
    expect(requests).toHaveLength(0);
  });

  it("explains a version conflict and reloads on request", async () => {
    mockFetch(
      jsonResponse(
        apiErrorBody("VERSION_CONFLICT", "This record was changed by someone else.", {
          currentVersion: 4,
        }),
        409,
      ),
    );
    const user = userEvent.setup();
    renderForm(editProps);
    const name = screen.getByLabelText("Full name");
    await user.clear(name);
    await user.type(name, "Someone Else");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("This record changed since you opened it")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Reload latest" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
