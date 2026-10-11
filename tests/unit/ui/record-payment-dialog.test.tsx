// @vitest-environment jsdom
import { apiErrorBody, jsonResponse } from "@/tests/support/dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordPaymentDialog } from "@/components/fees/record-payment-dialog";
import { todayIn } from "@/lib/services/rules/time";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const STUDENT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER_STUDENT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PAYMENT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function renderDialog(balance = "10000.00") {
  return render(
    <RecordPaymentDialog studentId={STUDENT_ID} studentName="Tanvir Hasan" balance={balance} />,
  );
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Record payment/ }));
  return screen.findByRole("dialog", { name: "Record payment" });
}

async function fill(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  values: { amount?: string; method?: string; reference?: string },
) {
  if (values.amount !== undefined) {
    await user.type(within(dialog).getByLabelText("Amount (BDT)"), values.amount);
  }
  if (values.method) {
    await user.click(within(dialog).getByRole("combobox", { name: "Method" }));
    await user.click(screen.getByRole("option", { name: values.method }));
  }
  if (values.reference !== undefined) {
    await user.type(
      within(dialog).getByLabelText(/^(Reference|Receipt number)$/),
      values.reference,
    );
  }
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

const PAYMENT = {
  id: PAYMENT_ID,
  studentId: STUDENT_ID,
  amount: "4000.00",
  method: "BKASH",
  paidAt: "2026-10-11",
  reference: "TRX-1",
  recordedBy: { id: "s", fullName: "Kamrul Hasan" },
  recordedAt: "2026-10-11T10:00:00.000Z",
  voidedAt: null,
  voidReason: null,
};
const SUMMARY = { balance: "6000.00" };

beforeEach(() => {
  refresh.mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.warning).mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("RecordPaymentDialog", () => {
  it("opens with the date set to today in Dhaka, blank amount and reference, and states what is owed", async () => {
    const user = userEvent.setup();
    renderDialog("160000.00");
    const dialog = await open(user);
    expect((within(dialog).getByLabelText("Payment date") as HTMLInputElement).value).toBe(
      todayIn(new Date()),
    );
    expect((within(dialog).getByLabelText("Amount (BDT)") as HTMLInputElement).value).toBe("");
    expect(dialog.textContent).toContain("owes ৳1,60,000.00");
    expect(within(dialog).getByRole("combobox", { name: "Method" }).textContent).toContain(
      "Choose a method",
    );
  });

  it("asks for a receipt number when the method is cash, and a reference otherwise", async () => {
    const user = userEvent.setup();
    renderDialog();
    const dialog = await open(user);
    expect(within(dialog).getByLabelText("Reference")).toBeTruthy();
    await user.click(within(dialog).getByRole("combobox", { name: "Method" }));
    await user.click(screen.getByRole("option", { name: "Cash" }));
    expect(within(dialog).getByLabelText("Receipt number")).toBeTruthy();
    expect(dialog.textContent).toContain("CASH-RCPT-0012");
    await user.click(within(dialog).getByRole("combobox", { name: "Method" }));
    await user.click(screen.getByRole("option", { name: "bKash" }));
    expect(within(dialog).getByLabelText("Reference")).toBeTruthy();
    expect(dialog.textContent).not.toContain("CASH-RCPT-0012");
  });

  it("offers every payment method, including bKash and Nagad", async () => {
    const user = userEvent.setup();
    renderDialog();
    const dialog = await open(user);
    await user.click(within(dialog).getByRole("combobox", { name: "Method" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Bank transfer",
      "Cash",
      "bKash",
      "Nagad",
      "Card",
    ]);
  });

  it("describes a credit instead of a negative balance", async () => {
    const user = userEvent.setup();
    renderDialog("-5000.00");
    const dialog = await open(user);
    expect(dialog.textContent).toContain("has a credit of ৳5,000.00");
    expect(dialog.textContent).not.toContain("-৳");
  });

  it("shows field errors and sends nothing for an empty or invalid form", async () => {
    const user = userEvent.setup();
    mockFetch();
    renderDialog();
    const dialog = await open(user);
    await user.click(within(dialog).getByRole("button", { name: "Record payment" }));
    expect(await within(dialog).findByText("Enter the amount.")).toBeTruthy();
    expect(within(dialog).getByText("Choose how the payment was made.")).toBeTruthy();
    expect(within(dialog).getByText("Enter the payment reference.")).toBeTruthy();
    expect(requests).toEqual([]);

    await user.type(within(dialog).getByLabelText("Amount (BDT)"), "10.123");
    await user.click(within(dialog).getByRole("button", { name: "Record payment" }));
    expect(await within(dialog).findByText("Use at most two decimal places.")).toBeTruthy();
  });

  it("blocks a future payment date", async () => {
    const user = userEvent.setup();
    mockFetch();
    renderDialog();
    const dialog = await open(user);
    await fill(user, dialog, { amount: "100", method: "Cash", reference: "R1" });
    const date = within(dialog).getByLabelText("Payment date");
    await user.clear(date);
    await user.type(date, "2999-01-01");
    await user.click(within(dialog).getByRole("button", { name: "Record payment" }));
    expect(
      await within(dialog).findByText("A payment cannot be dated in the future."),
    ).toBeTruthy();
    expect(requests).toEqual([]);
  });

  it("warns before saving when the amount is more than the balance, and not when it is not", async () => {
    const user = userEvent.setup();
    renderDialog("10000.00");
    const dialog = await open(user);
    const amount = within(dialog).getByLabelText("Amount (BDT)");

    await user.type(amount, "10000");
    expect(within(dialog).queryByRole("status")).toBeNull(); // exactly the balance: no warning

    await user.type(amount, ".01");
    const warning = await within(dialog).findByRole("status");
    expect(warning.textContent).toContain("৳0.01 more than the balance of ৳10,000.00");

    await user.clear(amount);
    await user.type(amount, "12,500");
    expect((await within(dialog).findByRole("status")).textContent).toContain(
      "৳2,500.00 more than the balance",
    );
    await user.clear(amount);
    await user.type(amount, "9,999");
    await waitFor(() => expect(within(dialog).queryByRole("status")).toBeNull());
  });

  it("says the student owes nothing when any payment would be credit", async () => {
    const user = userEvent.setup();
    renderDialog("0.00");
    const dialog = await open(user);
    await user.type(within(dialog).getByLabelText("Amount (BDT)"), "500");
    expect((await within(dialog).findByRole("status")).textContent).toContain("owes nothing");
  });

  it("posts the payment, toasts the server's warnings, closes and refreshes", async () => {
    const user = userEvent.setup();
    mockFetch(
      jsonResponse(
        {
          payment: PAYMENT,
          summary: SUMMARY,
          warnings: [{ code: "OVERPAYMENT", message: "This payment is more than the balance." }],
        },
        201,
      ),
    );
    renderDialog();
    const dialog = await open(user);
    await fill(user, dialog, { amount: "4,000", method: "bKash", reference: "trx-1" });
    await user.click(within(dialog).getByRole("button", { name: "Record payment" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe(`/api/students/${STUDENT_ID}/payments`);
    expect(requests[0]!.init?.method).toBe("POST");
    expect(JSON.parse(String(requests[0]!.init?.body))).toEqual({
      amount: "4000.00", // typed with grouping, sent as the API's two-decimal string
      method: "BKASH",
      paidAt: todayIn(new Date()),
      reference: "TRX-1", // normalised the way the server stores it
    });
    expect(vi.mocked(toast.success).mock.calls[0]![0]).toContain("৳4,000.00");
    expect(vi.mocked(toast.warning).mock.calls[0]![0]).toBe(
      "This payment is more than the balance.",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("cannot be submitted twice by a double click", async () => {
    const user = userEvent.setup();
    let release!: (response: Response) => void;
    requests = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        requests.push({ url, init });
        return new Promise<Response>((resolve) => (release = resolve));
      }),
    );
    renderDialog();
    const dialog = await open(user);
    await fill(user, dialog, { amount: "100", method: "Cash", reference: "ONCE" });
    const submit = within(dialog).getByRole("button", { name: "Record payment" });
    await user.dblClick(submit);
    await waitFor(() => expect(requests).toHaveLength(1));
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    release(jsonResponse({ payment: PAYMENT, summary: SUMMARY }, 201));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(requests).toHaveLength(1);
  });

  it("explains a duplicate reference inline and links to the existing payment", async () => {
    const user = userEvent.setup();
    mockFetch(
      jsonResponse(
        apiErrorBody("CONFLICT", "A payment with the reference TRX-1 is already recorded.", {
          field: "reference",
          existing: {
            id: PAYMENT_ID,
            reference: "TRX-1",
            student: {
              id: OTHER_STUDENT_ID,
              studentNumber: "SMS-2026-0009",
              fullName: "Ayesha Rahman",
            },
            amount: "7500.00",
            paidAt: "2026-10-02",
          },
        }),
        409,
      ),
    );
    renderDialog();
    const dialog = await open(user);
    await fill(user, dialog, { amount: "100", method: "Cash", reference: "TRX-1" });
    await user.click(within(dialog).getByRole("button", { name: "Record payment" }));

    const alert = (await within(dialog).findByText("That reference is already in use")).closest(
      '[data-slot="alert"]',
    ) as HTMLElement;
    expect(alert.textContent).toContain("That reference is already in use");
    expect(alert.textContent).toContain("৳7,500.00");
    expect(alert.textContent).toContain("2 Oct 2026");
    expect(alert.textContent).toContain("Ayesha Rahman (SMS-2026-0009)");
    const link = within(alert).getByRole("link", { name: "View the existing payment" });
    expect(link.getAttribute("href")).toBe(
      `/staff/students/${OTHER_STUDENT_ID}#payment-${PAYMENT_ID}`,
    );
    expect(within(dialog).getByText("This reference is already in use.")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy(); // stays open so the reference can be corrected

    // Typing a different reference clears the explanation.
    await user.type(within(dialog).getByLabelText(/^(Reference|Receipt number)$/), "-2");
    await waitFor(() =>
      expect(within(dialog).queryByText("That reference is already in use")).toBeNull(),
    );
  });

  it("maps server field errors onto the fields", async () => {
    const user = userEvent.setup();
    mockFetch(
      jsonResponse(
        apiErrorBody("VALIDATION_ERROR", "Some fields are invalid.", {
          fieldErrors: { paidAt: ["A payment cannot be dated in the future."] },
        }),
        400,
      ),
    );
    renderDialog();
    const dialog = await open(user);
    await fill(user, dialog, { amount: "100", method: "Cash", reference: "R2" });
    await user.click(within(dialog).getByRole("button", { name: "Record payment" }));
    expect(
      await within(dialog).findByText("A payment cannot be dated in the future."),
    ).toBeTruthy();
  });
});
