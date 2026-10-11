import { describe, expect, it } from "vitest";
import { Decimal } from "@/lib/services/rules/money";
import { classify, roundMark, validateMark } from "@/lib/services/rules/marks";
import type { Classification } from "@/lib/services/rules/types";

describe("validateMark", () => {
  it.each([
    "0",
    "100",
    "39.4",
    "39.5",
    "40",
    "59.4",
    "59.5",
    "69.4",
    "69.5",
    "70",
    "67.5",
    "0.1",
    "99.9",
    "100.0",
  ])("accepts %s", (input) => {
    const result = validateMark(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.equals(new Decimal(input))).toBe(true);
  });

  it("accepts numbers too", () => {
    expect(validateMark(67.5)).toEqual({ ok: true, value: new Decimal("67.5") });
    expect(validateMark(0)).toEqual({ ok: true, value: new Decimal(0) });
    expect(validateMark(100)).toEqual({ ok: true, value: new Decimal(100) });
  });

  it("trims, accepts a trailing zero, a bare point and a leading plus", () => {
    expect(validateMark(" 67.5 ")).toEqual({ ok: true, value: new Decimal("67.5") });
    expect(validateMark("67.50")).toEqual({ ok: true, value: new Decimal("67.5") });
    expect(validateMark("70.")).toEqual({ ok: true, value: new Decimal(70) });
    expect(validateMark(".5")).toEqual({ ok: true, value: new Decimal("0.5") });
    expect(validateMark("+5")).toEqual({ ok: true, value: new Decimal(5) });
  });

  it("treats -0 as plain zero", () => {
    const result = validateMark("-0");
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.is(result.value.toNumber(), 0)).toBe(true);
  });

  it.each(["100.1", "101", "-1", "-0.1", "1000", "100.01"])(
    "rejects %s as out of range",
    (input) => {
      expect(validateMark(input)).toEqual({ ok: false, code: "OUT_OF_RANGE" });
    },
  );

  it("rejects -1 and 100.1 as numbers", () => {
    expect(validateMark(-1)).toEqual({ ok: false, code: "OUT_OF_RANGE" });
    expect(validateMark(100.1)).toEqual({ ok: false, code: "OUT_OF_RANGE" });
  });

  it.each(["40.25", "0.05", "39.55", "99.99", "12.345"])(
    "rejects %s for more than one decimal",
    (input) => {
      expect(validateMark(input)).toEqual({ ok: false, code: "TOO_MANY_DECIMALS" });
    },
  );

  it("reports out of range before too many decimals", () => {
    expect(validateMark("100.25")).toEqual({ ok: false, code: "OUT_OF_RANGE" });
    expect(validateMark("-0.25")).toEqual({ ok: false, code: "OUT_OF_RANGE" });
  });

  it.each(["", "  ", "abc", "1,5", "1e1", "NaN", "Infinity", "--5", "5 5", "0x10", "."])(
    "rejects %j as not a number",
    (input) => {
      expect(validateMark(input)).toEqual({ ok: false, code: "NOT_A_NUMBER" });
    },
  );

  it("rejects non-finite and exponent-form numbers", () => {
    expect(validateMark(Number.NaN)).toEqual({ ok: false, code: "NOT_A_NUMBER" });
    expect(validateMark(Number.POSITIVE_INFINITY)).toEqual({ ok: false, code: "NOT_A_NUMBER" });
    expect(validateMark(1e-7)).toEqual({ ok: false, code: "NOT_A_NUMBER" });
  });
});

describe("roundMark (half-up to a whole number)", () => {
  it.each([
    ["39.4", "39"],
    ["39.5", "40"],
    ["59.4", "59"],
    ["59.5", "60"],
    ["69.4", "69"],
    ["69.5", "70"],
    ["0", "0"],
    ["0.4", "0"],
    ["0.5", "1"],
    ["99.5", "100"],
    ["100", "100"],
    ["40.25", "40"],
    ["40.5", "41"],
  ])("%s -> %s", (input, expected) => {
    expect(roundMark(input).toString()).toBe(expected);
  });

  it("accepts Decimals", () => {
    expect(roundMark(new Decimal("2.5")).toString()).toBe("3");
  });
});

describe("classify (DB-019)", () => {
  const mark = (value: string | number) => classify({ mark: value, isNonSubmission: false });

  it.each<[string | number, Classification]>([
    ["0", "FAIL"],
    ["0.1", "FAIL"],
    ["39", "FAIL"],
    ["39.4", "FAIL"], // rounds down to 39
    ["39.5", "PASS"], // rounds up to 40
    ["40", "PASS"],
    ["40.25", "PASS"], // not a valid stored mark, but rounding still behaves
    ["59", "PASS"],
    ["59.4", "PASS"],
    ["59.5", "MERIT"], // rounds up to 60
    ["60", "MERIT"],
    ["69", "MERIT"],
    ["69.4", "MERIT"], // rounds down to 69
    ["69.5", "DISTINCTION"], // rounds up to 70
    ["70", "DISTINCTION"],
    ["85.3", "DISTINCTION"],
    ["100", "DISTINCTION"],
    [67.5, "MERIT"],
  ])("%s -> %s", (value, expected) => {
    expect(mark(value)).toBe(expected);
  });

  it("classifies Decimal values", () => {
    expect(mark(new Decimal("70") as unknown as string)).toBe("DISTINCTION");
  });

  it("treats a non-submission as Fail", () => {
    expect(classify({ mark: null, isNonSubmission: true })).toBe("FAIL");
    expect(classify({ mark: "80", isNonSubmission: true })).toBe("FAIL"); // the flag wins
  });

  it("throws when there is neither a mark nor a non-submission flag", () => {
    expect(() => classify({ mark: null, isNonSubmission: false })).toThrow();
  });
});
