import { describe, expect, it } from "vitest";
import { ASSESSMENTS, MODULES, PERSONAS, PROGRAMMES, STAFF, studentEmail } from "@/db/seed/plan";

// The seed plan as data must agree with db/seed-plan.md before any database is involved. (The real check, against
// the seeded rows and the rule functions, is db/seed/check.ts; this catches typos in the plan quickly.)

const moduleOf = (code: string) => MODULES.find((m) => m.code === code)!;
const NEVER_SUBMIT = new Set([6, 17, 28, 18, 29]);
const programmeOfPersona = (n: number) => PERSONAS.find((p) => p.n === n)!.programme;

describe("seed plan data", () => {
  it("has the counts the plan states", () => {
    expect(STAFF).toHaveLength(3);
    expect(PROGRAMMES).toHaveLength(3);
    expect(MODULES).toHaveLength(8);
    expect(ASSESSMENTS).toHaveLength(10);
    expect(PERSONAS).toHaveLength(30);
    expect(PERSONAS.map((p) => p.n)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });

  it("has the status totals 21 / 3 / 3 / 3", () => {
    const totals = { ENROLLED: 0, DEFERRED: 0, WITHDRAWN: 0, COMPLETED: 0 };
    for (const persona of PERSONAS) totals[persona.status]++;
    expect(totals).toEqual({ ENROLLED: 21, DEFERRED: 3, WITHDRAWN: 3, COMPLETED: 3 });
  });

  it("gives every student who left a change date, and no one else", () => {
    for (const persona of PERSONAS) {
      expect(Boolean(persona.leave), persona.name).toBe(persona.status !== "ENROLLED");
      if (persona.status === "DEFERRED" || persona.status === "WITHDRAWN") {
        expect(persona.leave?.reason, `${persona.name} needs a reason`).toBeTruthy();
      }
    }
  });

  it("has unique, well-formed e-mail addresses on the reserved domain", () => {
    const emails = PERSONAS.map((p) => studentEmail(p.name));
    expect(new Set(emails).size).toBe(30);
    for (const email of emails) expect(email).toMatch(/^[a-z]+\.[a-z]+@student\.example\.edu$/);
  });

  it("links the shared modules as the plan says", () => {
    expect(moduleOf("MAT101").programmes).toEqual(["BSC-CSE", "BBA"]);
    expect(moduleOf("ENG101").programmes).toEqual(["BSC-CSE", "BBA", "BA-ENG"]);
    expect(moduleOf("BBA101").programmes).toEqual(["BBA"]);
  });

  it("bills the programme fees from the plan", () => {
    expect(PROGRAMMES.map((p) => [p.code, p.instalments.map((i) => [i.amount, i.dueDay])])).toEqual(
      [
        [
          "BSC-CSE",
          [
            [160_000, -40],
            [160_000, 80],
          ],
        ],
        ["BBA", [[260_000, -20]]],
        ["BA-ENG", [[180_000, -10]]],
      ],
    );
  });

  it("only lets students whose programme teaches the module submit, and never deferred or withdrawn ones", () => {
    for (const assessment of ASSESSMENTS) {
      for (const nText of Object.keys(assessment.submissions)) {
        const persona = PERSONAS.find((p) => p.n === Number(nText))!;
        expect(
          moduleOf(assessment.module).programmes,
          `${assessment.code} #${persona.n}`,
        ).toContain(persona.programme);
        // Deferred students and the two who withdrew long ago have no submissions; only Mahmud (#8, withdrew
        // on T-12d) has submissions from before he left.
        expect(
          NEVER_SUBMIT.has(persona.n),
          `#${persona.n} ${persona.name} ${assessment.code}`,
        ).toBe(false);
      }
    }
  });

  it("only marks students who submitted, apart from the explicit non-submission", () => {
    for (const assessment of ASSESSMENTS) {
      const marked = (assessment.marks ?? []).map((m) => m.n);
      expect(new Set(marked).size, `${assessment.code} marks a student twice`).toBe(marked.length);
      for (const mark of assessment.marks ?? []) {
        const submitted = mark.n in assessment.submissions;
        expect(submitted || mark.mark === "NS", `${assessment.code} #${mark.n}`).toBe(true);
        expect(programmeOfPersona(mark.n)).toBeTruthy();
        if (mark.release === "WITHHELD") expect(mark.reason).toBeTruthy();
      }
    }
  });

  it("keeps the fixed boundary marks the plan calls for", () => {
    const quiz = ASSESSMENTS.find((a) => a.code === "A2")!.marks!;
    const markOf = (n: number) => quiz.find((m) => m.n === n)?.mark;
    expect(markOf(11)).toBe(39.5);
    expect(markOf(14)).toBe(69.5);
    expect(markOf(19)).toBe(59.4);
  });
});
