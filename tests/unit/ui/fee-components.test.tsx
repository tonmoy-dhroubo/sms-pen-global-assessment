// @vitest-environment jsdom
import { apiErrorBody, jsonResponse } from "@/tests/support/dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChargesTable } from "@/components/fees/charges-table";
import { ChargeDialog } from "@/components/fees/charge-dialog";
import { FeeSummaryStrip } from "@/components/fees/fee-summary-strip";
import { PaymentsTable } from "@/components/fees/payments-table";
import { VoidPaymentButton } from "@/components/fees/void-payment-button";
import { FeeScheduleDialog } from "@/components/programmes/fee-schedule-dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { FeeSummaryDto } from "@/lib/services/fee-summary";
import type { ChargeDto, PaymentDto } from "@/lib/services/fees";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const STUDENT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PROGRAMME_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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
  vi.mocked(toast.warning).mockClear();
});
afterEach(() => vi.unstubAllGlobals());

const SUMMARY: FeeSummaryDto = {
  charged: "320000.00",
  waived: "0.00",
  paid: "60000.00",
  balance: "260000.00",
  credit: "0.00",
  overdueAmount: "100000.00",
  oldestOverdueDays: 40,
  ageingBucket: "31-60",
  nextDueDate: "2999-01-01",
  feeState: "overdue",
};

describe("FeeSummaryStrip", () => {
  it("shows an overdue student's amount, age and ageing bucket, and what is next due", () => {
    render(<FeeSummaryStrip summary={SUMMARY} today="2998-12-30" />);
    expect(screen.getByText("40 days overdue")).toBeTruthy();
    expect(screen.getByText("Ageing: 31-60 days")).toBeTruthy();
    expect(screen.getByText("in 2 days")).toBeTruthy();
    expect(screen.getByText("Overdue", { selector: '[data-slot="status-badge"]' })).toBeTruthy();
  });

  it("shows outstanding-but-not-due differently from overdue", () => {
    render(
      <FeeSummaryStrip
        today="2026-10-01"
        summary={{
          ...SUMMARY,
          overdueAmount: "0.00",
          oldestOverdueDays: null,
          ageingBucket: null,
          feeState: "outstanding",
          nextDueDate: "2026-10-21",
        }}
      />,
    );
    expect(
      screen.getByText("Outstanding", { selector: '[data-slot="status-badge"]' }),
    ).toBeTruthy();
    expect(screen.queryByText("Overdue", { selector: '[data-slot="status-badge"]' })).toBeNull();
    expect(screen.getByText(/is outstanding, but nothing is due yet/)).toBeTruthy();
    expect(screen.getByText("in 20 days")).toBeTruthy();
  });

  it("shows a credit as a credit, never as a negative balance", () => {
    const { container } = render(
      <FeeSummaryStrip
        today="2026-10-01"
        summary={{
          ...SUMMARY,
          balance: "-5000.00",
          credit: "5000.00",
          overdueAmount: "0.00",
          oldestOverdueDays: null,
          ageingBucket: null,
          nextDueDate: null,
          feeState: "credit",
        }}
      />,
    );
    expect(screen.getByText("Credit", { selector: "dt" })).toBeTruthy();
    expect(container.textContent).toContain("৳5,000.00");
    expect(container.textContent).not.toContain("-৳");
    expect(screen.getByText("Nothing due")).toBeTruthy();
  });
});

describe("PaymentsTable", () => {
  const base: PaymentDto = {
    id: "p1",
    studentId: STUDENT_ID,
    amount: "5000.00",
    method: "NAGAD",
    paidAt: "2026-10-01",
    reference: "NG-1",
    recordedBy: { id: "s1", fullName: "Kamrul Hasan" },
    recordedAt: "2026-10-01T09:00:00.000Z",
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
  };

  it("strikes voided payments through, keeps the row, and offers Void only on live ones", async () => {
    render(
      <TooltipProvider>
        <PaymentsTable
          payments={[
            base,
            {
              ...base,
              id: "p2",
              reference: "NG-2",
              voidedAt: "2026-10-02T09:00:00.000Z",
              voidedBy: { id: "s2", fullName: "Fatema Begum" },
              voidReason: "Entered twice",
            },
          ]}
        />
      </TooltipProvider>,
    );
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.id).toBe("payment-p1");
    expect(rows[1]!.id).toBe("payment-p2");
    expect(within(rows[0]!).getByRole("button", { name: /Void/ })).toBeTruthy();
    expect(within(rows[1]!).queryByRole("button", { name: /Void/ })).toBeNull();

    const voidedCells = within(rows[1]!)
      .getAllByRole("cell")
      .filter((cell) => cell.className.includes("line-through"));
    expect(voidedCells.map((c) => c.textContent)).toEqual([
      "1 Oct 2026",
      "৳5,000.00",
      "Nagad",
      "NG-2",
    ]);
    expect(
      within(rows[0]!)
        .getAllByRole("cell")
        .some((c) => c.className.includes("line-through")),
    ).toBe(false);

    const badge = within(rows[1]!).getByLabelText("Voided by Fatema Begum. Reason: Entered twice");
    badge.focus();
    expect((await screen.findAllByText("Entered twice")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Voided by Fatema Begum")).length).toBeGreaterThan(0);
  });

  it("shows an empty state with guidance", () => {
    render(<PaymentsTable payments={[]} />);
    expect(screen.getByText("No payments recorded")).toBeTruthy();
  });
});

describe("VoidPaymentButton", () => {
  it("requires a reason, posts it, and refreshes", async () => {
    const user = userEvent.setup();
    mockFetch(jsonResponse({ payment: {}, summary: { balance: "10000.00" } }));
    render(<VoidPaymentButton paymentId="p1" amount="5000.00" reference="NG-1" />);
    await user.click(screen.getByRole("button", { name: /Void/ }));
    const dialog = await screen.findByRole("dialog", { name: "Void payment" });
    await user.click(within(dialog).getByRole("button", { name: "Void payment" }));
    expect(await within(dialog).findByText("Enter a reason.")).toBeTruthy();
    expect(requests).toEqual([]);

    await user.type(within(dialog).getByLabelText("Why is it being voided?"), "Wrong student");
    await user.click(within(dialog).getByRole("button", { name: "Void payment" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(requests[0]!.url).toBe("/api/payments/p1/void");
    expect(JSON.parse(String(requests[0]!.init?.body))).toEqual({ reason: "Wrong student" });
  });

  it("shows the server's message when the payment was already voided", async () => {
    const user = userEvent.setup();
    mockFetch(
      jsonResponse(
        apiErrorBody("BUSINESS_RULE", "This payment has already been voided.", {
          rule: "PAYMENT_ALREADY_VOIDED",
        }),
        422,
      ),
    );
    render(<VoidPaymentButton paymentId="p1" amount="5000.00" reference="NG-1" />);
    await user.click(screen.getByRole("button", { name: /Void/ }));
    const dialog = await screen.findByRole("dialog", { name: "Void payment" });
    await user.type(within(dialog).getByLabelText("Why is it being voided?"), "x");
    await user.click(within(dialog).getByRole("button", { name: "Void payment" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("This payment has already been voided."),
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("ChargeDialog", () => {
  async function open(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Add adjustment or waiver" }));
    return screen.findByRole("dialog", { name: "Add adjustment or waiver" });
  }

  it("requires a type, description and amount", async () => {
    const user = userEvent.setup();
    mockFetch();
    render(<ChargeDialog studentId={STUDENT_ID} studentName="Tanvir Hasan" balance="1000.00" />);
    const dialog = await open(user);
    await user.click(within(dialog).getByRole("button", { name: /^Add/ }));
    expect(await within(dialog).findByText("Choose adjustment or waiver.")).toBeTruthy();
    expect(within(dialog).getByText("Enter a description.")).toBeTruthy();
    expect(within(dialog).getByText("Enter the amount.")).toBeTruthy();
    expect(requests).toEqual([]);
  });

  it("posts a waiver as a positive amount and refreshes", async () => {
    const user = userEvent.setup();
    mockFetch(
      jsonResponse({ charge: { amount: "-20000.00" }, summary: { balance: "240000.00" } }, 201),
    );
    render(<ChargeDialog studentId={STUDENT_ID} studentName="Tanvir Hasan" balance="260000.00" />);
    const dialog = await open(user);
    await user.click(within(dialog).getByRole("radio", { name: /Waiver/ }));
    await user.type(within(dialog).getByLabelText("Description"), "Merit scholarship");
    await user.type(within(dialog).getByLabelText("Amount (BDT)"), "20,000");
    await user.click(within(dialog).getByRole("button", { name: "Add waiver" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(requests[0]!.url).toBe(`/api/students/${STUDENT_ID}/charges`);
    const body = JSON.parse(String(requests[0]!.init?.body));
    expect(body).toMatchObject({
      kind: "WAIVER",
      description: "Merit scholarship",
      amount: "20000.00",
    });
    expect(vi.mocked(toast.success).mock.calls[0]![0]).toBe("Waiver of ৳20,000.00 added.");
  });
});

describe("ChargeDialog waiver warning", () => {
  async function openWaiver(balance: string) {
    const user = userEvent.setup();
    render(<ChargeDialog studentId={STUDENT_ID} studentName="Tanvir Hasan" balance={balance} />);
    await user.click(screen.getByRole("button", { name: "Add adjustment or waiver" }));
    const dialog = await screen.findByRole("dialog", { name: "Add adjustment or waiver" });
    await user.click(within(dialog).getByRole("radio", { name: /Waiver/ }));
    return { user, dialog };
  }

  it("warns inline when a waiver is more than the balance, and not otherwise", async () => {
    const { user, dialog } = await openWaiver("10000.00");
    const amount = within(dialog).getByLabelText("Amount (BDT)");
    await user.type(amount, "10000");
    expect(within(dialog).queryByRole("status")).toBeNull();
    await user.type(amount, "1");
    expect((await within(dialog).findByRole("status")).textContent).toContain(
      "more than the balance of ৳10,000.00",
    );
  });

  it("says the student owes nothing when there is no balance, and never warns for an adjustment", async () => {
    const { user, dialog } = await openWaiver("0.00");
    await user.type(within(dialog).getByLabelText("Amount (BDT)"), "500");
    expect((await within(dialog).findByRole("status")).textContent).toContain("owes nothing");
    await user.click(within(dialog).getByRole("radio", { name: /Adjustment/ }));
    await waitFor(() => expect(within(dialog).queryByRole("status")).toBeNull());
  });

  it("toasts the server's WAIVER_EXCEEDS_BALANCE warning after saving", async () => {
    const { user, dialog } = await openWaiver("100.00");
    mockFetch(
      jsonResponse(
        {
          charge: { amount: "-500.00" },
          summary: { balance: "-400.00" },
          warnings: [{ code: "WAIVER_EXCEEDS_BALANCE", message: "More than the balance." }],
        },
        201,
      ),
    );
    await user.type(within(dialog).getByLabelText("Description"), "Scholarship");
    await user.type(within(dialog).getByLabelText("Amount (BDT)"), "500");
    await user.click(within(dialog).getByRole("button", { name: "Add waiver" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(vi.mocked(toast.warning).mock.calls[0]![0]).toBe("More than the balance.");
  });
});

describe("ChargesTable", () => {
  const charge = (overrides: Partial<ChargeDto>): ChargeDto => ({
    id: "c1",
    kind: "PROGRAMME_FEE",
    academicYear: "2026-27",
    description: "Tuition 2026-27",
    amount: "160000.00",
    dueDate: "2026-09-02",
    createdAt: "2026-08-01T00:00:00.000Z",
    createdBy: { id: "s1", fullName: "Kamrul Hasan" },
    ...overrides,
  });

  it("shows who added an adjustment or waiver, but not on the automatic programme fee", () => {
    render(
      <ChargesTable
        charges={[
          charge({}),
          charge({
            id: "c2",
            kind: "WAIVER",
            description: "Merit scholarship",
            amount: "-20000.00",
            createdBy: { id: "s2", fullName: "Fatema Begum" },
          }),
          charge({ id: "c3", kind: "ADJUSTMENT", description: "Old", createdBy: null }),
        ]}
      />,
    );
    expect(screen.getAllByText(/^Added by /).map((e) => e.textContent)).toEqual([
      "Added by Fatema Begum",
    ]);
    expect(screen.getByText("Waiver")).toBeTruthy();
    expect(screen.getByText("-৳20,000.00")).toBeTruthy();
  });
});

describe("FeeScheduleDialog", () => {
  const schedule = {
    academicYear: "2026-27",
    instalments: [
      { instalment: 1, amount: "160000.00", dueDate: "2026-09-02" },
      { instalment: 2, amount: "160000.00", dueDate: "2026-12-31" },
    ],
    total: "320000.00",
    billedStudents: 12,
  };

  it("says existing charges will not change, with how many students were billed", async () => {
    const user = userEvent.setup();
    render(
      <FeeScheduleDialog
        mode="edit"
        programmeId={PROGRAMME_ID}
        programmeName="BSc CSE"
        schedule={schedule}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Edit schedule/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Existing charges will not change.")).toBeTruthy();
    expect(dialog.textContent).toContain("12 students have already been billed");
    expect(
      (within(dialog).getByLabelText("Amount for instalment 2") as HTMLInputElement).value,
    ).toBe("160000.00");
    expect(dialog.textContent).toContain("৳3,20,000.00");
  });

  it("numbers rows by position and sends the instalments", async () => {
    const user = userEvent.setup();
    mockFetch(
      jsonResponse({
        ...schedule,
        instalments: [schedule.instalments[0]],
        warnings: [
          { code: "EXISTING_CHARGES_UNCHANGED", message: "12 students were already billed." },
        ],
      }),
    );
    render(
      <FeeScheduleDialog
        mode="edit"
        programmeId={PROGRAMME_ID}
        programmeName="BSc CSE"
        schedule={schedule}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Edit schedule/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove instalment 2" }));
    const amount = within(dialog).getByLabelText("Amount for instalment 1");
    await user.clear(amount);
    await user.type(amount, "170000");
    await user.click(within(dialog).getByRole("button", { name: "Save schedule" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(requests[0]!.url).toBe(`/api/programmes/${PROGRAMME_ID}/fees/2026-27`);
    expect(requests[0]!.init?.method).toBe("PUT");
    expect(JSON.parse(String(requests[0]!.init?.body))).toEqual({
      instalments: [{ instalment: 1, amount: "170000.00", dueDate: "2026-09-02" }],
    });
    expect(vi.mocked(toast.warning).mock.calls[0]![0]).toBe("12 students were already billed.");
  });

  it("validates rows before sending, and keeps at least one instalment", async () => {
    const user = userEvent.setup();
    mockFetch();
    render(
      <FeeScheduleDialog
        mode="add"
        programmeId={PROGRAMME_ID}
        programmeName="BSc CSE"
        sessions={["2027-28", "2026-27"]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Add a session schedule" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      (within(dialog).getByRole("button", { name: "Remove instalment 1" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await user.click(within(dialog).getByRole("button", { name: "Save schedule" }));
    expect(await within(dialog).findByText("Choose a session such as 2026-27.")).toBeTruthy();
    expect(within(dialog).getByText("Enter the amount.")).toBeTruthy();
    expect(within(dialog).getByText("Enter the due date.")).toBeTruthy();
    expect(requests).toEqual([]);
  });

  it("shows the server's refusal to remove a billed instalment inline", async () => {
    const user = userEvent.setup();
    mockFetch(
      jsonResponse(
        apiErrorBody("BUSINESS_RULE", "Instalment 2 has already been billed to students.", {
          rule: "FEE_INSTALMENT_IN_USE",
        }),
        422,
      ),
    );
    render(
      <FeeScheduleDialog
        mode="edit"
        programmeId={PROGRAMME_ID}
        programmeName="BSc CSE"
        schedule={schedule}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Edit schedule/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove instalment 2" }));
    await user.click(within(dialog).getByRole("button", { name: "Save schedule" }));
    expect(
      await within(dialog).findByText("Instalment 2 has already been billed to students."),
    ).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });
});
