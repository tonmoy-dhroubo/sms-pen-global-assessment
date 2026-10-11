import { describe, expect, it } from "vitest";
import { isProbableDuplicate, normaliseName } from "@/lib/services/rules/duplicates";

describe("normaliseName", () => {
  it.each([
    ["Ayesha Rahman", "ayesha rahman"],
    ["AYESHA RAHMAN", "ayesha rahman"],
    ["  Ayesha    Rahman  ", "ayesha rahman"],
    ["Ayesha\tRahman\n", "ayesha rahman"],
    ["José García", "jose garcia"],
    ["JOSÉ   GARCÍA", "jose garcia"],
    ["Zoë Müller", "zoe muller"],
    ["Núñez", "nunez"],
    ["Ａｙｅｓｈａ", "ayesha"], // full-width letters fold to plain ones (NFKD)
    ["", ""],
    ["   ", ""],
  ])("%j -> %j", (input, expected) => {
    expect(normaliseName(input)).toBe(expected);
  });

  it("leaves Bengali names intact apart from case and spacing", () => {
    expect(normaliseName("  আয়েশা   রহমান ")).toBe("আয়েশা রহমান");
  });

  it("is idempotent", () => {
    const once = normaliseName("  JOSÉ   García ");
    expect(normaliseName(once)).toBe(once);
  });
});

describe("isProbableDuplicate", () => {
  const base = { fullName: "José García", dateOfBirth: "2004-03-09" };

  it("matches the same person typed differently", () => {
    expect(
      isProbableDuplicate(base, { fullName: "  jose   GARCIA ", dateOfBirth: "2004-03-09" }),
    ).toBe(true);
  });

  it("does not match a different date of birth", () => {
    expect(isProbableDuplicate(base, { ...base, dateOfBirth: "2004-03-10" })).toBe(false);
  });

  it("does not match a different name", () => {
    expect(isProbableDuplicate(base, { ...base, fullName: "Jose Garcia Lopez" })).toBe(false);
  });
});
