import { describe, expect, it } from "vitest";
import {
  MAX_MARK_IDS,
  parseMarkText,
  publishSchema,
  publishScopeOf,
  putMarkSchema,
  releaseChangeSchema,
} from "@/lib/validation/marks";

const ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function messages(result: {
  success: boolean;
  error?: { issues: { path: (string | number)[]; message: string }[] };
}) {
  return result.success
    ? {}
    : Object.fromEntries((result.error?.issues ?? []).map((i) => [i.path.join("."), i.message]));
}

describe("putMarkSchema", () => {
  it("accepts a mark (text or number), or a non-submission", () => {
    expect(putMarkSchema.safeParse({ mark: "67.5" }).success).toBe(true);
    expect(putMarkSchema.safeParse({ mark: 67.5, version: 2 }).success).toBe(true);
    expect(putMarkSchema.safeParse({ isNonSubmission: true }).success).toBe(true);
    expect(putMarkSchema.safeParse({ mark: "50", isNonSubmission: false }).success).toBe(true);
  });

  it.each(["100.1", "-1", "40.25", "", "abc", "1e2", "NaN"])("rejects the mark %j", (mark) => {
    expect(putMarkSchema.safeParse({ mark }).success).toBe(false);
  });

  it("needs exactly one of a mark or isNonSubmission: true", () => {
    expect(messages(putMarkSchema.safeParse({}))).toHaveProperty("mark");
    expect(messages(putMarkSchema.safeParse({ isNonSubmission: false }))).toHaveProperty("mark");
    expect(messages(putMarkSchema.safeParse({ mark: "50", isNonSubmission: true }))).toHaveProperty(
      "mark",
    );
  });

  it("checks the shape of version and reason", () => {
    expect(putMarkSchema.safeParse({ mark: "50", version: 0 }).success).toBe(false);
    expect(putMarkSchema.safeParse({ mark: "50", version: 1.5 }).success).toBe(false);
    expect(putMarkSchema.safeParse({ mark: "50", reason: "  " }).success).toBe(false);
    const ok = putMarkSchema.safeParse({ mark: "50", reason: "  Appeal  " });
    expect(ok.success && ok.data.reason).toBe("Appeal");
  });
});

describe("publishSchema", () => {
  it("takes exactly one scope and defaults dryRun to false", () => {
    const a = publishSchema.parse({ assessmentId: ID_A });
    expect(a.dryRun).toBe(false);
    expect(publishScopeOf(a)).toEqual({ assessmentId: ID_A });
    expect(publishScopeOf(publishSchema.parse({ studentId: ID_B, dryRun: true }))).toEqual({
      studentId: ID_B,
    });
    expect(publishScopeOf(publishSchema.parse({ markIds: [ID_A, ID_A, ID_B] }))).toEqual({
      markIds: [ID_A, ID_B],
    });
  });

  it("rejects none, or more than one, and bad ids", () => {
    expect(publishSchema.safeParse({}).success).toBe(false);
    expect(publishSchema.safeParse({ assessmentId: ID_A, markIds: [ID_B] }).success).toBe(false);
    expect(publishSchema.safeParse({ markIds: [] }).success).toBe(false);
    expect(publishSchema.safeParse({ markIds: ["x"] }).success).toBe(false);
    expect(publishSchema.safeParse({ assessmentId: "x" }).success).toBe(false);
  });
});

describe("releaseChangeSchema", () => {
  it("needs mark ids and a reason, and caps the list", () => {
    expect(releaseChangeSchema.safeParse({ markIds: [ID_A], reason: "Fees" }).success).toBe(true);
    expect(messages(releaseChangeSchema.safeParse({ markIds: [ID_A] }))).toHaveProperty("reason");
    expect(releaseChangeSchema.safeParse({ markIds: [], reason: "x" }).success).toBe(false);
    const many = Array.from(
      { length: MAX_MARK_IDS + 1 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    expect(releaseChangeSchema.safeParse({ markIds: many, reason: "x" }).success).toBe(false);
  });
});

describe("parseMarkText", () => {
  it("reads empty, NS in any case, valid marks and invalid text", () => {
    expect(parseMarkText("  ")).toEqual({ kind: "empty" });
    expect(parseMarkText("ns")).toEqual({ kind: "ns" });
    expect(parseMarkText(" NS ")).toEqual({ kind: "ns" });
    expect(parseMarkText("67.5")).toEqual({ kind: "mark", value: "67.5" });
    expect(parseMarkText("101")).toMatchObject({ kind: "invalid" });
    expect(parseMarkText("40.25")).toMatchObject({ kind: "invalid" });
    expect(parseMarkText("n")).toMatchObject({ kind: "invalid" });
  });
});
