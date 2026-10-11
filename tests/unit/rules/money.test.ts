import { describe, expect, it } from "vitest";
import {
  Decimal,
  ZERO,
  formatBdt,
  parseMoneyInput,
  sum,
  toApiString,
  toDecimal,
} from "@/lib/services/rules/money";

describe("decimal arithmetic", () => {
  it("is exact where floats are not", () => {
    expect(0.1 + 0.2).not.toBe(0.3); // the reason we never use floats
    expect(sum(["0.1", "0.2"]).equals(new Decimal("0.3"))).toBe(true);
    expect(sum(["19.99", "0.01", "0.10"]).toFixed(2)).toBe("20.10");
  });

  it("sums nothing to zero", () => {
    expect(sum([])).toBe(ZERO);
  });

  it("accepts strings, numbers, Decimals and Prisma-style decimal-like values", () => {
    const prismaLike = { toFixed: () => "160000.50" }; // stands in for Prisma.Decimal
    expect(toDecimal("12.30").toFixed(2)).toBe("12.30");
    expect(toDecimal(12.5).toFixed(2)).toBe("12.50");
    expect(toDecimal(new Decimal("7")).toFixed(2)).toBe("7.00");
    expect(toDecimal(prismaLike).toFixed(2)).toBe("160000.50");
    expect(sum([prismaLike, "0.50", 1]).toFixed(2)).toBe("160002.00");
  });

  it("returns the same Decimal instance when given one", () => {
    const value = new Decimal(5);
    expect(toDecimal(value)).toBe(value);
  });

  it("throws on text that is not a number", () => {
    expect(() => toDecimal("abc")).toThrow();
  });
});

describe("toApiString", () => {
  it("always has two decimals", () => {
    expect(toApiString("160000")).toBe("160000.00");
    expect(toApiString(new Decimal("0.5"))).toBe("0.50");
    expect(toApiString("-250")).toBe("-250.00");
  });

  it("rounds half-up beyond two decimals", () => {
    expect(toApiString("1.005")).toBe("1.01");
    expect(toApiString("1.004")).toBe("1.00");
  });
});

describe("formatBdt", () => {
  it("renders the spec example exactly", () => {
    expect(formatBdt("125000")).toBe("৳1,25,000.00");
  });

  it.each([
    ["0", "৳0.00"],
    ["5", "৳5.00"],
    ["999.99", "৳999.99"],
    ["1000", "৳1,000.00"],
    ["12345.6", "৳12,345.60"],
    ["99999", "৳99,999.00"],
    ["100000", "৳1,00,000.00"],
    ["320000", "৳3,20,000.00"],
    ["1234567.89", "৳12,34,567.89"],
    ["10000000", "৳1,00,00,000.00"],
    ["9999999999.99", "৳9,99,99,99,999.99"],
  ])("groups %s in lakhs and crores", (input, expected) => {
    expect(formatBdt(input)).toBe(expected);
  });

  it("puts the minus sign before the symbol", () => {
    expect(formatBdt("-125000")).toBe("-৳1,25,000.00");
    expect(formatBdt("-0.5")).toBe("-৳0.50");
  });

  it("rounds to two decimals half-up", () => {
    expect(formatBdt("1.005")).toBe("৳1.01");
    expect(formatBdt("0.001")).toBe("৳0.00");
  });

  it("accepts numbers and Decimals", () => {
    expect(formatBdt(160000)).toBe("৳1,60,000.00");
    expect(formatBdt(new Decimal("40000"))).toBe("৳40,000.00");
  });

  it("agrees with the ICU en-IN digit grouping", () => {
    const icu = new Intl.NumberFormat("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    for (const value of [
      0, 7, 999.5, 1000, 25000, 125000, 999999.99, 1234567.89, 12500000, 987654321.12,
    ]) {
      expect(formatBdt(String(value))).toBe(`৳${icu.format(value)}`);
    }
  });
});

describe("parseMoneyInput", () => {
  it.each([
    ["125000", "125000"],
    ["125000.5", "125000.5"],
    ["1,25,000", "125000"],
    ["1,25,000.50", "125000.5"],
    ["125,000", "125000"],
    ["1,234,567", "1234567"],
    ["৳1,25,000", "125000"],
    ["৳ 5,000", "5000"],
    ["BDT 5000", "5000"],
    ["bdt5000", "5000"],
    ["Tk. 750", "750"],
    ["Tk750.25", "750.25"],
    ["  42  ", "42"],
    ["0", "0"],
    ["0.00", "0"],
    ["12.50", "12.5"],
    ["5.100", "5.1"],
    ["9999999999.99", "9999999999.99"],
  ])("parses %j", (text, expected) => {
    const result = parseMoneyInput(text);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.toString()).toBe(expected);
  });

  it.each([
    ["", "EMPTY"],
    ["   ", "EMPTY"],
    ["abc", "INVALID"],
    ["12abc", "INVALID"],
    ["1.2.3", "INVALID"],
    ["1,2,3", "INVALID"],
    ["12,34", "INVALID"],
    ["1,2345", "INVALID"],
    [",100", "INVALID"],
    ["৳", "INVALID"],
    ["1e5", "INVALID"],
    ["৳-5", "INVALID"],
    ["-5", "NEGATIVE"],
    ["- 5", "NEGATIVE"],
    ["-৳1,000", "NEGATIVE"],
    ["10.123", "TOO_MANY_DECIMALS"],
    ["0.001", "TOO_MANY_DECIMALS"],
    ["10000000000", "TOO_LARGE"],
    ["9999999999.999", "TOO_MANY_DECIMALS"],
  ])("rejects %j as %s", (text, code) => {
    expect(parseMoneyInput(text)).toEqual({ ok: false, code });
  });
});
