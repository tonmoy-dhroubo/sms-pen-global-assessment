import { describe, expect, it } from "vitest";
import { allowedTransitions, checkTransition, transitionRule } from "@/lib/services/rules/status";
import type { EnrolmentStatus } from "@/lib/services/rules/types";

const ALL: EnrolmentStatus[] = ["ENROLLED", "DEFERRED", "WITHDRAWN", "COMPLETED"];

// The table in docs/api.md, cell by cell: "allowed", "reason" (reason required) or "no".
const MATRIX: Record<EnrolmentStatus, Record<EnrolmentStatus, "allowed" | "reason" | "no">> = {
  ENROLLED: { ENROLLED: "no", DEFERRED: "reason", WITHDRAWN: "reason", COMPLETED: "allowed" },
  DEFERRED: { ENROLLED: "allowed", DEFERRED: "no", WITHDRAWN: "reason", COMPLETED: "no" },
  WITHDRAWN: { ENROLLED: "reason", DEFERRED: "no", WITHDRAWN: "no", COMPLETED: "no" },
  COMPLETED: { ENROLLED: "no", DEFERRED: "no", WITHDRAWN: "no", COMPLETED: "no" },
};

describe("transitionRule", () => {
  for (const from of ALL) {
    for (const to of ALL) {
      const expected = MATRIX[from][to];
      it(`${from} -> ${to}: ${expected}`, () => {
        const rule = transitionRule(from, to);
        if (expected === "no") {
          expect(rule.allowed).toBe(false);
        } else {
          expect(rule).toEqual({ allowed: true, reasonRequired: expected === "reason" });
        }
      });
    }
  }

  it("distinguishes a no-op from a forbidden move", () => {
    expect(transitionRule("ENROLLED", "ENROLLED")).toEqual({ allowed: false, code: "NO_CHANGE" });
    expect(transitionRule("COMPLETED", "ENROLLED")).toEqual({
      allowed: false,
      code: "NOT_ALLOWED",
    });
    expect(transitionRule("ENROLLED", "COMPLETED")).toEqual({
      allowed: true,
      reasonRequired: false,
    });
  });

  it("treats Completed as final", () => {
    for (const to of ALL) expect(transitionRule("COMPLETED", to).allowed).toBe(false);
    expect(allowedTransitions("COMPLETED")).toEqual([]);
  });
});

describe("allowedTransitions", () => {
  it("lists what the status dialog should offer", () => {
    expect(allowedTransitions("ENROLLED")).toEqual([
      { to: "DEFERRED", reasonRequired: true },
      { to: "WITHDRAWN", reasonRequired: true },
      { to: "COMPLETED", reasonRequired: false },
    ]);
    expect(allowedTransitions("DEFERRED")).toEqual([
      { to: "ENROLLED", reasonRequired: false },
      { to: "WITHDRAWN", reasonRequired: true },
    ]);
    expect(allowedTransitions("WITHDRAWN")).toEqual([{ to: "ENROLLED", reasonRequired: true }]);
  });
});

describe("checkTransition", () => {
  it("accepts an allowed move with no reason where none is needed", () => {
    expect(checkTransition("ENROLLED", "COMPLETED")).toEqual({ ok: true });
    expect(checkTransition("DEFERRED", "ENROLLED", null)).toEqual({ ok: true });
  });

  it("requires a non-blank reason for deferral, withdrawal and re-admission", () => {
    expect(checkTransition("ENROLLED", "DEFERRED")).toEqual({ ok: false, code: "REASON_REQUIRED" });
    expect(checkTransition("ENROLLED", "WITHDRAWN", "")).toEqual({
      ok: false,
      code: "REASON_REQUIRED",
    });
    expect(checkTransition("DEFERRED", "WITHDRAWN", "   ")).toEqual({
      ok: false,
      code: "REASON_REQUIRED",
    });
    expect(checkTransition("WITHDRAWN", "ENROLLED", null)).toEqual({
      ok: false,
      code: "REASON_REQUIRED",
    });
    expect(checkTransition("WITHDRAWN", "ENROLLED", "Re-admitted after appeal")).toEqual({
      ok: true,
    });
    expect(checkTransition("ENROLLED", "DEFERRED", "Medical leave")).toEqual({ ok: true });
  });

  it("refuses a forbidden move before looking at the reason", () => {
    expect(checkTransition("COMPLETED", "ENROLLED", "Because")).toEqual({
      ok: false,
      code: "NOT_ALLOWED",
    });
    expect(checkTransition("DEFERRED", "COMPLETED", "Because")).toEqual({
      ok: false,
      code: "NOT_ALLOWED",
    });
    expect(checkTransition("ENROLLED", "ENROLLED", "Because")).toEqual({
      ok: false,
      code: "NO_CHANGE",
    });
  });
});
