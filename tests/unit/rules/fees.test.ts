import { describe, expect, it } from "vitest";
import {
  AGEING_BUCKETS,
  ageingBucketFor,
  feeSummary,
  overdueNotice,
  type FeeChargeInput,
  type PaymentInput,
} from "@/lib/services/rules/fees";
import { toApiString } from "@/lib/services/rules/money";
import type { DateOnly } from "@/lib/services/rules/types";

const TODAY: DateOnly = "2026-10-12";

/** A calendar date `days` away from TODAY (negative = in the past). */
function offset(days: number): DateOnly {
  const d = new Date(Date.UTC(2026, 9, 12 + days));
  return d.toISOString().slice(0, 10);
}

const fee = (amount: string, dueDate: DateOnly | Date): FeeChargeInput => ({
  kind: "PROGRAMME_FEE",
  amount,
  dueDate,
});
const adjustment = (amount: string, dueDate: DateOnly): FeeChargeInput => ({
  kind: "ADJUSTMENT",
  amount,
  dueDate,
});
const waiver = (amount: string, dueDate: DateOnly): FeeChargeInput => ({
  kind: "WAIVER",
  amount: `-${amount}`,
  dueDate,
});
const pay = (amount: string, voided = false): PaymentInput => ({
  amount,
  voidedAt: voided ? new Date("2026-10-01T00:00:00Z") : null,
});

function money(summary: ReturnType<typeof feeSummary>) {
  return {
    charged: toApiString(summary.charged),
    waived: toApiString(summary.waived),
    paid: toApiString(summary.paid),
    balance: toApiString(summary.balance),
    credit: toApiString(summary.credit),
    overdue: toApiString(summary.overdueAmount),
  };
}

describe("ageingBucketFor", () => {
  it.each([
    [-5, null],
    [0, null],
    [1, "1-30"],
    [30, "1-30"],
    [31, "31-60"],
    [60, "31-60"],
    [61, "60+"],
    [400, "60+"],
  ])("%d days -> %s", (days, bucket) => {
    expect(ageingBucketFor(days)).toBe(bucket);
  });

  it("lists the buckets in order", () => {
    expect(AGEING_BUCKETS).toEqual(["1-30", "31-60", "60+"]);
  });
});

describe("feeSummary: empty and simple cases", () => {
  it("is all zero with no charges or payments", () => {
    const s = feeSummary([], [], TODAY);
    expect(money(s)).toEqual({
      charged: "0.00",
      waived: "0.00",
      paid: "0.00",
      balance: "0.00",
      credit: "0.00",
      overdue: "0.00",
    });
    expect(s.oldestOverdueDays).toBeNull();
    expect(s.ageingBucket).toBeNull();
    expect(s.nextDueDate).toBeNull();
    expect(s.feeState).toBe("paid");
  });

  it("charges not yet due are outstanding, not overdue", () => {
    const s = feeSummary([fee("160000", offset(80))], [], TODAY);
    expect(money(s)).toMatchObject({
      charged: "160000.00",
      paid: "0.00",
      balance: "160000.00",
      overdue: "0.00",
    });
    expect(s.oldestOverdueDays).toBeNull();
    expect(s.ageingBucket).toBeNull();
    expect(s.nextDueDate).toBe(offset(80));
    expect(s.feeState).toBe("outstanding");
  });

  it("accepts Date values for due dates, as Prisma returns them", () => {
    const s = feeSummary([fee("100", new Date("2026-10-01T00:00:00Z"))], [], TODAY);
    expect(s.oldestOverdueDays).toBe(11);
  });

  it("throws on an invalid due date rather than guessing", () => {
    expect(() => feeSummary([fee("100", "2026-02-30")], [], TODAY)).toThrow(RangeError);
  });
});

describe("feeSummary: payments against the balance", () => {
  const charges = [fee("100000", offset(-20))];

  it("payment less than the balance leaves the remainder overdue", () => {
    const s = feeSummary(charges, [pay("60000")], TODAY);
    expect(money(s)).toMatchObject({
      paid: "60000.00",
      balance: "40000.00",
      credit: "0.00",
      overdue: "40000.00",
    });
    expect(s.feeState).toBe("overdue");
  });

  it("payment exactly equal to the balance clears it", () => {
    const s = feeSummary(charges, [pay("100000")], TODAY);
    expect(money(s)).toMatchObject({ balance: "0.00", credit: "0.00", overdue: "0.00" });
    expect(s.oldestOverdueDays).toBeNull();
    expect(s.ageingBucket).toBeNull();
    expect(s.feeState).toBe("paid");
  });

  it("payment greater than the balance is a credit, shown as a positive amount", () => {
    const s = feeSummary(charges, [pay("100000"), pay("2500.50")], TODAY);
    expect(money(s)).toMatchObject({ balance: "-2500.50", credit: "2500.50", overdue: "0.00" });
    expect(s.feeState).toBe("credit");
  });

  it("sums several payments exactly", () => {
    const s = feeSummary(charges, [pay("33333.33"), pay("33333.33"), pay("33333.34")], TODAY);
    expect(money(s)).toMatchObject({ paid: "100000.00", balance: "0.00" });
  });

  it("uses exact decimals (no float drift)", () => {
    const s = feeSummary([fee("0.30", offset(-1))], [pay("0.10"), pay("0.20")], TODAY);
    expect(money(s).balance).toBe("0.00");
    expect(s.feeState).toBe("paid");
  });

  it("a prepaid student with nothing due is in credit", () => {
    const s = feeSummary([fee("100000", offset(30))], [pay("120000")], TODAY);
    expect(money(s)).toMatchObject({ balance: "-20000.00", credit: "20000.00", overdue: "0.00" });
    expect(s.nextDueDate).toBeNull();
    expect(s.feeState).toBe("credit");
  });
});

describe("feeSummary: voided payments are ignored", () => {
  it("does not count a voided payment toward paid, balance or overdue", () => {
    const s = feeSummary([fee("100000", offset(-5))], [pay("100000", true)], TODAY);
    expect(money(s)).toMatchObject({ paid: "0.00", balance: "100000.00", overdue: "100000.00" });
    expect(s.oldestOverdueDays).toBe(5);
  });

  it("counts only the non-voided payments", () => {
    const s = feeSummary([fee("100000", offset(-5))], [pay("30000"), pay("70000", true)], TODAY);
    expect(money(s)).toMatchObject({ paid: "30000.00", balance: "70000.00", overdue: "70000.00" });
  });

  it("voiding an overpayment removes the credit", () => {
    const s = feeSummary([fee("100", offset(-5))], [pay("100"), pay("50", true)], TODAY);
    expect(money(s)).toMatchObject({ balance: "0.00", credit: "0.00" });
  });
});

describe("feeSummary: waivers and adjustments (DB-018)", () => {
  it("reports waived as a positive figure and reduces the balance", () => {
    const s = feeSummary([fee("160000", offset(-10)), waiver("40000", offset(-10))], [], TODAY);
    expect(money(s)).toMatchObject({
      charged: "160000.00",
      waived: "40000.00",
      balance: "120000.00",
    });
    expect(s.feeState).toBe("overdue");
    expect(money(s).overdue).toBe("120000.00");
  });

  it("a fully waived charge owes nothing and is not overdue", () => {
    const s = feeSummary([fee("50000", offset(-10)), waiver("50000", offset(-10))], [], TODAY);
    expect(money(s)).toMatchObject({ balance: "0.00", overdue: "0.00" });
    expect(s.oldestOverdueDays).toBeNull();
    expect(s.feeState).toBe("paid");
  });

  it("adjustments add to charged", () => {
    const s = feeSummary(
      [fee("100000", offset(-10)), adjustment("5000", offset(-2))],
      [pay("100000")],
      TODAY,
    );
    expect(money(s)).toMatchObject({
      charged: "105000.00",
      balance: "5000.00",
      overdue: "5000.00",
    });
    // The payment settles the older fee first, so what is left is the adjustment due 2 days ago.
    expect(s.oldestOverdueDays).toBe(2);
  });

  it("a waiver that exceeds what is charged leaves a credit", () => {
    const s = feeSummary([fee("1000", offset(-1)), waiver("1500", offset(-1))], [], TODAY);
    expect(money(s)).toMatchObject({ balance: "-500.00", credit: "500.00", overdue: "0.00" });
    expect(s.feeState).toBe("credit");
  });

  it("does not report an overdue age for a fee cancelled by a later waiver", () => {
    const s = feeSummary([fee("1000", offset(-30)), waiver("1000", offset(-1))], [], TODAY);
    expect(money(s).overdue).toBe("0.00");
    expect(s.oldestOverdueDays).toBeNull();
    expect(s.ageingBucket).toBeNull();
  });
});

describe("feeSummary: ageing after waivers clear an older debt (code review 2026-10-12, #3)", () => {
  // The review's case: 1,000 due 1 Jul, fully waived on 1 Aug, then 500 due 1 Oct. Today is 12 Oct.
  it("measures age from the charge still owed, not from a charge a waiver cleared", () => {
    const s = feeSummary(
      [fee("1000", "2026-07-01"), waiver("1000", "2026-08-01"), fee("500", "2026-10-01")],
      [],
      TODAY,
    );
    expect(money(s).overdue).toBe("500.00");
    expect(s.oldestOverdueDays).toBe(11);
    expect(s.ageingBucket).toBe("1-30");
  });

  it("keeps the older charge when a waiver only reduces it", () => {
    const s = feeSummary(
      [fee("1000", "2026-07-01"), waiver("400", "2026-08-01"), fee("500", "2026-10-01")],
      [],
      TODAY,
    );
    expect(money(s).overdue).toBe("1100.00");
    expect(s.oldestOverdueDays).toBe(103);
    expect(s.ageingBucket).toBe("60+");
  });

  it("applies a payment on top of a waiver: the waiver clears one charge, the payment the next", () => {
    const s = feeSummary(
      [
        fee("1000", "2026-07-01"),
        waiver("1000", "2026-08-01"),
        fee("500", "2026-09-01"),
        fee("500", "2026-10-01"),
      ],
      [pay("500")],
      TODAY,
    );
    expect(money(s).overdue).toBe("500.00");
    expect(s.oldestOverdueDays).toBe(11);
    expect(s.ageingBucket).toBe("1-30");
  });

  it("recomputes more than once when several waivers clear several debts", () => {
    const s = feeSummary(
      [
        fee("100", "2026-05-01"),
        waiver("100", "2026-05-15"),
        fee("200", "2026-07-01"),
        waiver("200", "2026-07-15"),
        fee("300", "2026-10-10"),
      ],
      [],
      TODAY,
    );
    expect(money(s).overdue).toBe("300.00");
    expect(s.oldestOverdueDays).toBe(2);
  });

  it("a waiver dated before the charge it clears leaves nothing overdue", () => {
    const s = feeSummary([waiver("1000", "2026-06-01"), fee("1000", "2026-07-01")], [], TODAY);
    expect(money(s).overdue).toBe("0.00");
    expect(s.oldestOverdueDays).toBeNull();
    expect(s.feeState).toBe("paid");
  });

  it("still reports nothing overdue when a payment covers what a waiver left", () => {
    const s = feeSummary(
      [fee("1000", "2026-07-01"), waiver("400", "2026-08-01"), fee("500", "2026-10-01")],
      [pay("1100")],
      TODAY,
    );
    expect(money(s).overdue).toBe("0.00");
    expect(s.oldestOverdueDays).toBeNull();
    expect(s.ageingBucket).toBeNull();
  });

  it("does not let a future-dated waiver hide an overdue charge", () => {
    const s = feeSummary([fee("1000", "2026-07-01"), waiver("1000", "2026-11-01")], [], TODAY);
    expect(money(s).overdue).toBe("1000.00");
    expect(s.oldestOverdueDays).toBe(103);
  });
});

describe("feeSummary: next due date after waivers (same pattern as code review #3)", () => {
  it("skips a future charge that a later-dated waiver clears entirely", () => {
    const s = feeSummary(
      [fee("1000", offset(10)), waiver("1000", offset(20)), fee("500", offset(30))],
      [],
      TODAY,
    );
    expect(s.nextDueDate).toBe(offset(30));
  });

  it("keeps the earlier charge when a later-dated waiver only covers part of it", () => {
    const s = feeSummary(
      [fee("1000", offset(10)), waiver("400", offset(20)), fee("500", offset(30))],
      [],
      TODAY,
    );
    expect(s.nextDueDate).toBe(offset(10));
  });

  it("has no next due date when everything still to fall due is waived", () => {
    const s = feeSummary([fee("1000", offset(10)), waiver("1000", offset(20))], [], TODAY);
    expect(s.nextDueDate).toBeNull();
  });

  it("combines with payments: the payment and the waiver together clear the first charge", () => {
    const s = feeSummary(
      [fee("1000", offset(10)), waiver("600", offset(20)), fee("500", offset(30))],
      [pay("400")],
      TODAY,
    );
    expect(s.nextDueDate).toBe(offset(30));
  });

  it("is unaffected by an overdue charge that a waiver cleared", () => {
    const s = feeSummary(
      [fee("1000", offset(-20)), waiver("1000", offset(-10)), fee("500", offset(5))],
      [],
      TODAY,
    );
    expect(s.nextDueDate).toBe(offset(5));
    expect(money(s).overdue).toBe("0.00");
  });
});

describe("feeSummary: overdue age boundaries (days past the due date)", () => {
  it.each([
    [0, null, null],
    [1, 1, "1-30"],
    [30, 30, "1-30"],
    [31, 31, "31-60"],
    [60, 60, "31-60"],
    [61, 61, "60+"],
    [365, 365, "60+"],
  ])("due %d days ago -> age %s, bucket %s", (daysAgo, age, bucket) => {
    const s = feeSummary([fee("1000", offset(-daysAgo))], [], TODAY);
    expect(s.oldestOverdueDays).toBe(age);
    expect(s.ageingBucket).toBe(bucket);
    expect(money(s).overdue).toBe(daysAgo === 0 ? "0.00" : "1000.00");
    expect(s.feeState).toBe(daysAgo === 0 ? "outstanding" : "overdue");
  });

  it("a charge due today is not yet overdue but is the next due date", () => {
    const s = feeSummary([fee("1000", TODAY)], [], TODAY);
    expect(s.nextDueDate).toBe(TODAY);
    expect(money(s).overdue).toBe("0.00");
  });

  it("a charge due tomorrow is the next due date", () => {
    expect(feeSummary([fee("1000", offset(1))], [], TODAY).nextDueDate).toBe(offset(1));
  });
});

describe("feeSummary: payments settle the oldest due charges first", () => {
  // Instalment 1 due 70 days ago, instalment 2 due 10 days ago, instalment 3 due in 80 days.
  const charges = [fee("40000", offset(-70)), fee("40000", offset(-10)), fee("40000", offset(80))];

  it("with nothing paid, age is measured from the oldest charge", () => {
    const s = feeSummary(charges, [], TODAY);
    expect(money(s).overdue).toBe("80000.00");
    expect(s.oldestOverdueDays).toBe(70);
    expect(s.ageingBucket).toBe("60+");
    expect(s.nextDueDate).toBe(offset(80));
  });

  it("paying the oldest instalment in full moves the age to the next one", () => {
    const s = feeSummary(charges, [pay("40000")], TODAY);
    expect(money(s).overdue).toBe("40000.00");
    expect(s.oldestOverdueDays).toBe(10);
    expect(s.ageingBucket).toBe("1-30");
  });

  it("a part payment leaves the oldest charge overdue, and its age is unchanged", () => {
    const s = feeSummary(charges, [pay("15000")], TODAY);
    expect(money(s).overdue).toBe("65000.00");
    expect(s.oldestOverdueDays).toBe(70);
  });

  it("paying both overdue instalments leaves only the future one", () => {
    const s = feeSummary(charges, [pay("80000")], TODAY);
    expect(money(s)).toMatchObject({ overdue: "0.00", balance: "40000.00" });
    expect(s.oldestOverdueDays).toBeNull();
    expect(s.nextDueDate).toBe(offset(80));
    expect(s.feeState).toBe("outstanding");
  });

  it("overpaying into the future instalment moves the next due date past it", () => {
    const s = feeSummary(charges, [pay("120000")], TODAY);
    expect(money(s)).toMatchObject({ balance: "0.00", overdue: "0.00" });
    expect(s.nextDueDate).toBeNull();
  });

  it("a payment that covers one future instalment only advances the next due date", () => {
    const two = [fee("40000", offset(20)), fee("40000", offset(120))];
    expect(feeSummary(two, [], TODAY).nextDueDate).toBe(offset(20));
    expect(feeSummary(two, [pay("40000")], TODAY).nextDueDate).toBe(offset(120));
    expect(feeSummary(two, [pay("80000")], TODAY).nextDueDate).toBeNull();
  });

  it("charges are ordered by due date, not by the order given", () => {
    const shuffled = [charges[2]!, charges[0]!, charges[1]!];
    const s = feeSummary(shuffled, [pay("40000")], TODAY);
    expect(s.oldestOverdueDays).toBe(10);
    expect(money(s).overdue).toBe("40000.00");
  });

  it("charges sharing a due date are settled together", () => {
    const s = feeSummary(
      [fee("30000", offset(-5)), adjustment("10000", offset(-5))],
      [pay("30000")],
      TODAY,
    );
    expect(money(s).overdue).toBe("10000.00");
    expect(s.oldestOverdueDays).toBe(5);
  });

  it("applies a payment to the oldest charge, not to the one the student meant", () => {
    // 40,000 from last session (200 days ago), 160,000 instalment (40 days ago), 160,000 paid in total. Oldest-first
    // allocation clears the old 40,000 and 120,000 of the instalment, so 40,000 is still overdue - and it is the
    // instalment's age (40 days) that counts, not the old session's.
    const s = feeSummary(
      [fee("40000", offset(-200)), fee("160000", offset(-40)), fee("160000", offset(80))],
      [pay("160000")],
      TODAY,
    );
    expect(money(s).overdue).toBe("40000.00");
    expect(s.oldestOverdueDays).toBe(40);
    expect(s.ageingBucket).toBe("31-60");
  });

  it("keeps the old age while the old charge is still not covered", () => {
    const s = feeSummary(
      [fee("40000", offset(-200)), fee("160000", offset(-40)), fee("160000", offset(80))],
      [pay("30000")],
      TODAY,
    );
    expect(money(s).overdue).toBe("170000.00");
    expect(s.oldestOverdueDays).toBe(200);
    expect(s.ageingBucket).toBe("60+");
  });
});

describe("feeSummary: fee state", () => {
  it("prefers overdue over the other states", () => {
    expect(feeSummary([fee("100", offset(-1))], [], TODAY).feeState).toBe("overdue");
  });

  it("is outstanding when a balance exists but nothing is due yet", () => {
    expect(feeSummary([fee("100", offset(1))], [], TODAY).feeState).toBe("outstanding");
  });

  it("is credit when overpaid and paid when exactly settled", () => {
    expect(feeSummary([fee("100", offset(-1))], [pay("101")], TODAY).feeState).toBe("credit");
    expect(feeSummary([fee("100", offset(-1))], [pay("100")], TODAY).feeState).toBe("paid");
  });
});

describe("overdueNotice", () => {
  it("states the days and sends the student to the Registry office", () => {
    expect(overdueNotice(12)).toBe("Overdue by 12 days. Please contact the Registry office.");
  });

  it("uses the singular for one day", () => {
    expect(overdueNotice(1)).toBe("Overdue by 1 day. Please contact the Registry office.");
  });
});
