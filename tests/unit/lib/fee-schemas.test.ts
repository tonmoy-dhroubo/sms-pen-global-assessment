import { describe, expect, it } from "vitest";
import { todayIn } from "@/lib/services/rules/time";
import {
  balancesQuerySchema,
  createChargeSchema,
  normalisePaymentReference,
  recordPaymentSchema,
  voidPaymentSchema,
} from "@/lib/validation/fees";
import { feeScheduleSchema } from "@/lib/validation/programmes";

// The schemas shared by the fee forms and the Route Handlers (api.md "Fees and payments", "Programmes and modules").

const TODAY = todayIn(new Date());

function messages(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.success ? [] : result.error!.issues.map((i) => i.message);
}

const payment = (overrides: Record<string, unknown> = {}) => ({
  amount: "5000",
  method: "CASH",
  paidAt: TODAY,
  reference: "ref-1",
  ...overrides,
});

describe("amounts", () => {
  it.each([
    ["5000", "5000.00"],
    ["5000.5", "5000.50"],
    ["1,25,000", "125000.00"],
    ["125,000.25", "125000.25"],
    ["৳5,000", "5000.00"],
    ["0.01", "0.01"],
    ["9999999999.99", "9999999999.99"],
  ])("accepts %s as %s", (input, output) => {
    const parsed = recordPaymentSchema.safeParse(payment({ amount: input }));
    expect(parsed.success && parsed.data.amount).toBe(output);
  });

  it.each([
    ["", "Enter the amount."],
    ["0", "The amount must be more than zero."],
    ["0.00", "The amount must be more than zero."],
    ["-5", "The amount must be more than zero."],
    ["1.234", "Use at most two decimal places."],
    ["abc", "Enter an amount such as 5000 or 5,000.50."],
    ["10000000000", "That amount is too large."],
  ])("rejects %j with %j", (input, message) => {
    expect(messages(recordPaymentSchema.safeParse(payment({ amount: input })))).toEqual([message]);
  });

  it("rejects a JSON number: money travels as a string", () => {
    expect(messages(recordPaymentSchema.safeParse(payment({ amount: 5000 })))).toEqual([
      'Send the amount as a string such as "5000.00".',
    ]);
  });
});

describe("payment date", () => {
  it("allows today and earlier, blocks tomorrow", () => {
    expect(recordPaymentSchema.safeParse(payment({ paidAt: TODAY })).success).toBe(true);
    expect(recordPaymentSchema.safeParse(payment({ paidAt: "2019-01-01" })).success).toBe(true);
    expect(messages(recordPaymentSchema.safeParse(payment({ paidAt: "2999-01-01" })))).toEqual([
      "A payment cannot be dated in the future.",
    ]);
  });

  it.each([
    ["", "Enter the payment date."],
    ["12/10/2026", "Enter the date as YYYY-MM-DD."],
    ["2026-02-30", "Enter a real calendar date."],
  ])("rejects %j", (input, message) => {
    expect(messages(recordPaymentSchema.safeParse(payment({ paidAt: input })))).toEqual([message]);
  });
});

describe("payment reference", () => {
  it("is trimmed, collapsed and upper-cased so references that differ only in case or spacing clash", () => {
    expect(normalisePaymentReference("  trx   9f3 ")).toBe("TRX 9F3");
    const parsed = recordPaymentSchema.parse(payment({ reference: "  bkash-ab12  " }));
    expect(parsed.reference).toBe("BKASH-AB12");
  });

  it("is required and at most 64 characters", () => {
    expect(messages(recordPaymentSchema.safeParse(payment({ reference: "   " })))).toEqual([
      "Enter the payment reference.",
    ]);
    expect(recordPaymentSchema.safeParse(payment({ reference: "x".repeat(64) })).success).toBe(
      true,
    );
    expect(recordPaymentSchema.safeParse(payment({ reference: "x".repeat(65) })).success).toBe(
      false,
    );
  });
});

describe("payment method", () => {
  it.each(["BANK_TRANSFER", "CASH", "BKASH", "NAGAD", "CARD"])("accepts %s", (method) => {
    expect(recordPaymentSchema.safeParse(payment({ method })).success).toBe(true);
  });
  it("rejects anything else", () => {
    expect(messages(recordPaymentSchema.safeParse(payment({ method: "CHEQUE" })))).toEqual([
      "Choose how the payment was made.",
    ]);
  });
});

describe("charges", () => {
  const charge = (overrides: Record<string, unknown> = {}) => ({
    kind: "WAIVER",
    description: "  Merit scholarship ",
    amount: "20,000",
    dueDate: "2026-09-01",
    ...overrides,
  });

  it("takes a positive amount for both kinds, trims the description, and allows any real due date", () => {
    expect(createChargeSchema.parse(charge())).toEqual({
      kind: "WAIVER",
      description: "Merit scholarship",
      amount: "20000.00",
      dueDate: "2026-09-01",
    });
    expect(
      createChargeSchema.safeParse(charge({ kind: "ADJUSTMENT", dueDate: "2019-01-01" })).success,
    ).toBe(true);
  });

  it.each([
    [{ kind: "PROGRAMME_FEE" }, "Choose adjustment or waiver."],
    [{ description: " " }, "Enter a description."],
    [{ amount: "-1" }, "The amount must be more than zero."],
    [{ dueDate: "2026-13-01" }, "Enter a real calendar date."],
  ])("rejects %j", (override, message) => {
    expect(messages(createChargeSchema.safeParse(charge(override)))).toEqual([message]);
  });
});

describe("void reason", () => {
  it("is required, trimmed and at most 500 characters", () => {
    expect(voidPaymentSchema.parse({ reason: "  Entered twice " })).toEqual({
      reason: "Entered twice",
    });
    expect(voidPaymentSchema.safeParse({ reason: " " }).success).toBe(false);
    expect(voidPaymentSchema.safeParse({ reason: "x".repeat(501) }).success).toBe(false);
  });
});

describe("balances query", () => {
  it("defaults the paging and accepts the filters", () => {
    expect(balancesQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25 });
    expect(
      balancesQuerySchema.parse({
        feeState: "overdue",
        ageingBucket: "31-60",
        sort: "-overdueAmount",
      }),
    ).toMatchObject({
      feeState: "overdue",
      ageingBucket: "31-60",
      sort: { field: "overdueAmount", direction: "desc" },
    });
  });

  it("understands a hand-typed 60+ that arrived as '60 '", () => {
    expect(balancesQuerySchema.parse({ ageingBucket: "60 " }).ageingBucket).toBe("60+");
    expect(balancesQuerySchema.parse({ ageingBucket: "60+" }).ageingBucket).toBe("60+");
  });

  it.each([
    { feeState: "paid" },
    { ageingBucket: "90" },
    { sort: "email" },
    { pageSize: "500" },
    { programmeId: "x" },
  ])("rejects %j", (query) => {
    expect(balancesQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe("fee schedule", () => {
  const row = (instalment: number, amount = "1000", dueDate = "2026-09-01") => ({
    instalment,
    amount,
    dueDate,
  });

  it("sorts the instalments and normalises the amounts", () => {
    const parsed = feeScheduleSchema.parse({ instalments: [row(2, "2,000"), row(1)] });
    expect(parsed.instalments.map((i) => [i.instalment, i.amount])).toEqual([
      [1, "1000.00"],
      [2, "2000.00"],
    ]);
  });

  it.each([
    ["a gap", [row(1), row(3)]],
    ["a repeat", [row(1), row(1)]],
    ["a start above 1", [row(2)]],
    ["no rows", []],
  ])("rejects %s", (_name, instalments) => {
    expect(feeScheduleSchema.safeParse({ instalments }).success).toBe(false);
  });

  it("rejects an amount that is not positive and a due date that is not real, on the right row", () => {
    const result = feeScheduleSchema.safeParse({
      instalments: [row(1, "0"), row(2, "5", "2026-02-30")],
    });
    expect(result.success).toBe(false);
    const paths = result.success ? [] : result.error.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(["instalments.0.amount", "instalments.1.dueDate"]);
  });
});
