import { createHash } from "node:crypto";
import type { PrismaClient } from "@/lib/generated/prisma/client";
import { lateBy, effectiveDeadline } from "@/lib/services/rules/deadlines";
import { feeSummary, type FeeSummary } from "@/lib/services/rules/fees";
import { classify } from "@/lib/services/rules/marks";
import { canUpload } from "@/lib/services/rules/submission-rules";
import { parseStudentNumber } from "@/lib/services/rules/student-number";
import { sessionLabel, sessionStartYear } from "@/lib/services/rules/time";
import type { Storage } from "@/lib/storage-core";
import { ASSESSMENTS, PERSONAS, studentEmail } from "./plan";
import type { Timeline } from "./timeline";

// The seed's self-check (seed-plan rule 5). It reads the database back and recomputes every key fact with the real
// rule functions (fees, deadlines, marks, upload rules), then compares them with what db/seed-plan.md promises. A
// difference is a bug in the seed or in a rule, so it fails loudly with an expected/actual listing.
//
// It also produces a fingerprint of the seeded content (no ids, no timestamps): two resets on the same day must print
// the same one, which is how "db:reset twice gives identical data" is checked.

export interface SelfCheckResult {
  /** Human-readable facts that were verified (printed after seeding). */
  lines: string[];
  /** SHA-256 (first 16 hex characters) of the seeded content, without ids or timestamps. */
  fingerprint: string;
}

export class SeedCheckError extends Error {
  constructor(readonly problems: string[]) {
    super(
      [
        `Seed self-check failed: ${problems.length} problem${problems.length === 1 ? "" : "s"}`,
        "  (- = what db/seed-plan.md expects, + = what the database holds)",
        "",
        ...problems,
      ].join("\n"),
    );
    this.name = "SeedCheckError";
  }
}

const byName = new Map(PERSONAS.map((p) => [p.name, p]));
const OVERDUE_EXPECTED: Record<string, string> = {
  "Jannatul Ferdous": "1-30",
  "Mehjabin Sultana": "1-30",
  "Raisa Mahmud": "1-30",
  "Zubair Hasan": "1-30",
  "Tanvir Hasan": "31-60",
  "Mahmud Karim": "31-60",
  "Arif Hossain": "60+",
  "Habib Ullah": "60+",
};
const OVERDUE_AMOUNTS: Record<string, string> = {
  "Jannatul Ferdous": "260000.00",
  "Mehjabin Sultana": "15000.00",
  "Raisa Mahmud": "160000.00",
  "Zubair Hasan": "180000.00",
  "Tanvir Hasan": "100000.00",
  "Mahmud Karim": "110000.00",
  "Arif Hossain": "200000.00",
  "Habib Ullah": "90000.00",
};

export async function selfCheck(input: {
  prisma: PrismaClient;
  storage: Storage;
  timeline: Timeline;
}): Promise<SelfCheckResult> {
  const { prisma, storage, timeline: tl } = input;
  const now = tl.now;
  const problems: string[] = [];
  const lines: string[] = [];

  const show = (value: unknown) => JSON.stringify(value);
  function expectEqual(label: string, expected: unknown, actual: unknown): boolean {
    if (show(expected) === show(actual)) return true;
    problems.push(`${label}\n  - ${show(expected)}\n  + ${show(actual)}`);
    return false;
  }
  function verified(label: string, expected: unknown, actual: unknown, text: string) {
    if (expectEqual(label, expected, actual)) lines.push(text);
  }

  // --- Load everything once -------------------------------------------------------------------------------------------
  const [staff, programmes, feeScheduleCount, modules, assessmentRows, students, marks, sequences] =
    await Promise.all([
      prisma.staff.findMany(),
      prisma.programme.findMany({ include: { modules: true } }),
      prisma.programmeFee.count(),
      prisma.module.findMany({ include: { programmes: true } }),
      prisma.assessment.findMany({ include: { module: true } }),
      prisma.student.findMany({
        include: {
          programme: true,
          feeCharges: true,
          payments: true,
          statusChanges: true,
          submissions: { include: { files: true } },
        },
        orderBy: { studentNumber: "asc" },
      }),
      prisma.mark.findMany({ include: { changes: true } }),
      prisma.studentIdSequence.findMany(),
    ]);

  const codeOfAssessment = new Map<string, string>(); // assessment id -> A1 ... A10
  for (const row of assessmentRows) {
    const spec = ASSESSMENTS.find((a) => a.module === row.module.code && a.title === row.title);
    if (spec) codeOfAssessment.set(row.id, spec.code);
  }
  const assessmentByCode = new Map(
    assessmentRows.map((row) => [codeOfAssessment.get(row.id) ?? row.id, row]),
  );
  const studentByName = new Map(students.map((s) => [s.fullName, s]));
  const nameOf = new Map(students.map((s) => [s.id, s.fullName]));
  const programmeModuleIds = new Map(
    programmes.map((p) => [p.id, p.modules.map((link) => link.moduleId)]),
  );

  // --- Counts and structure ---------------------------------------------------------------------------------------------
  verified(
    "record counts",
    { staff: 3, programmes: 3, feeSchedules: 16, modules: 8, assessments: 10, students: 30 },
    {
      staff: staff.length,
      programmes: programmes.length,
      feeSchedules: feeScheduleCount,
      modules: modules.length,
      assessments: assessmentRows.length,
      students: students.length,
    },
    "3 staff, 3 programmes (16 fee schedules over 4 sessions), 8 modules, 10 assessments, 30 students",
  );
  verified(
    "assessments are all recognised",
    ASSESSMENTS.map((a) => a.code).sort(),
    [...codeOfAssessment.values()].sort(),
    "the 10 assessments match the plan by module and title",
  );
  const links = Object.fromEntries(
    modules.map((m) => [
      m.code,
      m.programmes
        .map((link) => programmes.find((p) => p.id === link.programmeId)!.code)
        .sort(),
    ]),
  );
  verified(
    "module-programme links",
    {
      CSE101: ["BSC-CSE"],
      CSE201: ["BSC-CSE"],
      MAT101: ["BBA", "BSC-CSE"],
      BBA101: ["BBA"],
      BBA102: ["BBA"],
      ENG101: ["BA-ENG", "BBA", "BSC-CSE"],
      ENG201: ["BA-ENG"],
      ENG210: ["BA-ENG"],
    },
    links,
    "shared modules link to several programmes (MAT101 x2, ENG101 x3)",
  );

  // --- Status totals ----------------------------------------------------------------------------------------------------------
  const statusTotals = { ENROLLED: 0, DEFERRED: 0, WITHDRAWN: 0, COMPLETED: 0 };
  for (const s of students) statusTotals[s.status]++;
  verified(
    "status totals",
    { ENROLLED: 21, DEFERRED: 3, WITHDRAWN: 3, COMPLETED: 3 },
    statusTotals,
    "status totals: 21 Enrolled, 3 Deferred, 3 Withdrawn, 3 Completed",
  );
  for (const persona of PERSONAS) {
    const student = studentByName.get(persona.name);
    if (!student) {
      problems.push(`student #${persona.n} ${persona.name} is missing`);
      continue;
    }
    expectEqual(`#${persona.n} ${persona.name}: status`, persona.status, student.status);
    expectEqual(`#${persona.n} ${persona.name}: email`, studentEmail(persona.name), student.email);
    expectEqual(`#${persona.n} ${persona.name}: programme`, persona.programme, student.programme.code);
    const history = [...student.statusChanges].sort(
      (x, y) => x.changedAt.getTime() - y.changedAt.getTime(),
    );
    expectEqual(
      `#${persona.n} ${persona.name}: status history`,
      [[null, "ENROLLED"], ...(persona.status === "ENROLLED" ? [] : [["ENROLLED", persona.status]])],
      history.map((h) => [h.fromStatus, h.toStatus]),
    );
  }
  for (const name of ["Rakib Islam", "Nadia Islam", "Priyanka Roy", "Mahmud Karim", "Habib Ullah"]) {
    const reason = studentByName
      .get(name)
      ?.statusChanges.find((c) => c.toStatus !== "ENROLLED")?.reason;
    if (!reason) problems.push(`${name}: the status change needs a reason (api.md)`);
  }

  // --- Student numbers (DB-004, DB-015) -------------------------------------------------------------------------------------------
  const perYear = new Map<number, number[]>();
  for (const s of students) {
    const parsed = parseStudentNumber(s.studentNumber);
    if (!parsed) {
      problems.push(`${s.fullName}: "${s.studentNumber}" is not a valid student number`);
      continue;
    }
    perYear.set(parsed.year, [...(perYear.get(parsed.year) ?? []), parsed.sequence]);
    const persona = byName.get(s.fullName)!;
    const firstSessionYear = tl.sessionYear - (persona.sessions ? Math.max(...persona.sessions) : persona.year - 1);
    expectEqual(`${s.fullName}: ID year is the start year of the first session`, firstSessionYear, parsed.year);
  }
  const gapFree = [...perYear.entries()].every(([, seq]) =>
    seq.sort((a, b) => a - b).every((value, index) => value === index + 1),
  );
  const sequenceRows = Object.fromEntries(sequences.map((row) => [row.year, row.lastValue]));
  const expectedSequences = Object.fromEntries([...perYear.entries()].map(([y, seq]) => [y, seq.length]));
  expectEqual("student numbers are gap-free in every year", true, gapFree);
  verified(
    "student ID sequences",
    expectedSequences,
    sequenceRows,
    `student IDs: ${[...perYear.entries()].map(([y, s]) => `SMS-${y} x${s.length}`).join(", ")} (gap-free)`,
  );

  // --- Fees (real rule: feeSummary, oldest charge settled first, D-028) ------------------------------------------------------------
  const fees = new Map<string, FeeSummary>();
  for (const s of students) {
    fees.set(
      s.fullName,
      feeSummary(
        s.feeCharges.map((c) => ({ kind: c.kind, amount: c.amount, dueDate: c.dueDate })),
        s.payments.map((p) => ({ amount: p.amount, voidedAt: p.voidedAt })),
        tl.today,
      ),
    );
  }
  const overdue = [...fees.entries()].filter(([, f]) => f.overdueAmount.greaterThan(0));
  verified(
    "overdue students and ageing buckets",
    Object.entries(OVERDUE_EXPECTED).sort(),
    overdue.map(([name, f]) => [name, f.ageingBucket]).sort(),
    "8 overdue: 1-30 x4 (Jannatul, Mehjabin, Raisa, Zubair), 31-60 x2 (Tanvir, Mahmud), 60+ x2 (Arif, Habib)",
  );
  verified(
    "overdue amounts",
    Object.entries(OVERDUE_AMOUNTS).sort(),
    overdue.map(([name, f]) => [name, f.overdueAmount.toFixed(2)]).sort(),
    "overdue amounts: Jannatul 2,60,000; Mehjabin 15,000; Raisa 1,60,000; Zubair 1,80,000; Tanvir 1,00,000; Mahmud 1,10,000; Arif 2,00,000; Habib 90,000",
  );
  const ageing = { "1-30": 0, "31-60": 0, "60+": 0 };
  for (const [, f] of overdue) if (f.ageingBucket) ageing[f.ageingBucket]++;
  expectEqual("ageing bucket totals", { "1-30": 4, "31-60": 2, "60+": 2 }, ageing);
  const credit = [...fees.entries()].filter(([, f]) => f.credit.greaterThan(0));
  verified(
    "students in credit",
    [["Nusrat Jahan", "5000.00"]],
    credit.map(([name, f]) => [name, f.credit.toFixed(2)]),
    "1 credit: Nusrat Jahan, 5,000 (paid via bKash)",
  );
  const feeStateOf = (name: string) => fees.get(name)?.feeState;
  expectEqual("fee state: Ayesha Rahman (instalment 2 outstanding, not due)", "outstanding", feeStateOf("Ayesha Rahman"));
  expectEqual("fee state: Sabbir Hossain (withdrawn with no debt)", "paid", feeStateOf("Sabbir Hossain"));
  expectEqual("fee state: Tasnim Ahmed (waiver, rest paid)", "paid", feeStateOf("Tasnim Ahmed"));
  expectEqual("waiver: Tasnim Ahmed", "40000.00", fees.get("Tasnim Ahmed")?.waived.toFixed(2));
  expectEqual("fee state: Sadia Chowdhury (voided payment excluded)", "paid", feeStateOf("Sadia Chowdhury"));
  const notPaid = new Set([...Object.keys(OVERDUE_EXPECTED), "Nusrat Jahan", "Ayesha Rahman", "Rakib Islam"]);
  const unexpected = [...fees.entries()]
    .filter(([name, f]) => !notPaid.has(name) && f.feeState !== "paid")
    .map(([name, f]) => `${name}: ${f.feeState}`);
  verified(
    "everyone else is fully paid",
    [],
    unexpected,
    "all other 19 students are fully paid (balance 0)",
  );

  // --- Payments ---------------------------------------------------------------------------------------------------------------
  const allPayments = students.flatMap((s) => s.payments.map((p) => ({ ...p, student: s.fullName })));
  const voided = allPayments.filter((p) => p.voidedAt);
  verified(
    "voided payments",
    [["Sadia Chowdhury", "Wrong amount entered"]],
    voided.map((p) => [p.student, p.voidReason]),
    "1 voided payment (Sadia Chowdhury, wrong amount entered), re-recorded",
  );
  const methodsByStudent = (name: string) => [
    ...new Set(studentByName.get(name)!.payments.map((p) => p.method)),
  ];
  expectEqual("Nusrat pays via bKash", ["BKASH"], methodsByStudent("Nusrat Jahan"));
  expectEqual("Sumaiya pays via Nagad", ["NAGAD"], methodsByStudent("Sumaiya Haque"));
  expectEqual("Shakil pays by bank transfer", ["BANK_TRANSFER"], methodsByStudent("Shakil Ahmed"));
  const references = allPayments.filter((p) => !p.voidedAt).map((p) => p.reference);
  expectEqual(
    "payment references are unique among payments that are not voided",
    references.length,
    new Set(references).size,
  );
  // Audit columns (DB-024): a voided payment has a voider, a payment that is not voided has none, every charge has
  // the staff member who added it, and waivers are the Finance Officer's.
  expectEqual(
    "every voided payment names who voided it, and no other payment does",
    allPayments.map((p) => p.voidedAt !== null),
    allPayments.map((p) => p.voidedById !== null),
  );
  const allCharges = students.flatMap((s) => s.feeCharges);
  expectEqual(
    "every fee charge records who created it",
    0,
    allCharges.filter((c) => c.createdById === null).length,
  );
  const financeOfficer = staff.find((member) => member.jobTitle === "Finance Officer");
  expectEqual(
    "waivers were added by the Finance Officer",
    true,
    allCharges.filter((c) => c.kind === "WAIVER").every((c) => c.createdById === financeOfficer?.id),
  );
  lines.push(
    `payments: ${allPayments.length} (${voided.length} voided); methods in use: ${[...new Set(allPayments.map((p) => p.method))].sort().join(", ")}`,
  );

  // --- Marks and classification (real rule: classify, DB-019) --------------------------------------------------------------------
  const markOf = (name: string, code: string) => {
    const student = studentByName.get(name)!;
    const assessment = assessmentByCode.get(code)!;
    return marks.find((m) => m.studentId === student.id && m.assessmentId === assessment.id);
  };
  const classOf = (name: string, code: string) => {
    const m = markOf(name, code);
    return m ? [m.mark?.toFixed(1) ?? "NS", classify({ mark: m.mark, isNonSubmission: m.isNonSubmission })] : null;
  };
  verified(
    "boundary classifications",
    {
      "Sumaiya Haque A1": [ "NS", "FAIL" ],
      "Sumaiya Haque A2": ["39.5", "PASS"],
      "Shakil Ahmed A2": ["69.5", "DISTINCTION"],
      "Lamia Khan A2": ["59.4", "PASS"],
    },
    {
      "Sumaiya Haque A1": classOf("Sumaiya Haque", "A1"),
      "Sumaiya Haque A2": classOf("Sumaiya Haque", "A2"),
      "Shakil Ahmed A2": classOf("Shakil Ahmed", "A2"),
      "Lamia Khan A2": classOf("Lamia Khan", "A2"),
    },
    "boundaries: NS -> Fail; 39.5 -> Pass; 69.5 -> Distinction; 59.4 -> Pass",
  );
  // Marks the plan fixes by hand; everything else is filler in 45-85.
  const fixedMarks = new Set(
    ASSESSMENTS.flatMap((a) =>
      (a.marks ?? [])
        .filter((m) => m.mark !== "AUTO")
        .map((m) => `${PERSONAS.find((p) => p.n === m.n)!.name}|${a.code}`),
    ),
  );
  const outOfRange = marks
    .filter((m) => !m.isNonSubmission && m.mark)
    .filter(
      (m) =>
        !fixedMarks.has(`${nameOf.get(m.studentId)}|${codeOfAssessment.get(m.assessmentId)}`) &&
        (Number(m.mark) < 45 || Number(m.mark) > 85),
    );
  expectEqual("filler marks stay in 45-85", [], outOfRange.map((m) => `${nameOf.get(m.studentId)} ${m.mark}`));
  expectEqual(
    "Ayesha has Distinction marks, published",
    [["DISTINCTION", "PUBLISHED"], ["DISTINCTION", "PUBLISHED"]],
    ["A1", "A3"].map((code) => {
      const m = markOf("Ayesha Rahman", code);
      return [m ? classify({ mark: m.mark, isNonSubmission: m.isNonSubmission }) : null, m?.releaseStatus];
    }),
  );
  expectEqual(
    "Moumita has a published Distinction on A7",
    ["DISTINCTION", "PUBLISHED"],
    (() => {
      const m = markOf("Moumita Das", "A7");
      return [m ? classify({ mark: m.mark, isNonSubmission: m.isNonSubmission }) : null, m?.releaseStatus];
    })(),
  );

  // --- Release states --------------------------------------------------------------------------------------------------------------
  const withheld = marks.filter((m) => m.releaseStatus === "WITHHELD");
  verified(
    "withheld results and reasons",
    [
      ["Arnab Saha", "A7", "Academic misconduct investigation"],
      ["Tanvir Hasan", "A3", "Outstanding fees"],
    ],
    withheld
      .map((m) => [nameOf.get(m.studentId), codeOfAssessment.get(m.assessmentId), m.withheldReason])
      .sort(),
    "2 withheld results: Tanvir (outstanding fees, A3) and Arnab (academic misconduct investigation, A7)",
  );
  const countBy = (code: string) => {
    const rows = marks.filter((m) => codeOfAssessment.get(m.assessmentId) === code);
    const tally: Record<string, number> = {};
    for (const row of rows) tally[row.releaseStatus] = (tally[row.releaseStatus] ?? 0) + 1;
    return tally;
  };
  verified(
    "release states per assessment",
    {
      A1: { PUBLISHED: 11 },
      A2: { DRAFT: 17, PUBLISHED: 2 },
      A3: { PUBLISHED: 7, WITHHELD: 1, DRAFT: 10 },
      A7: { PUBLISHED: 5, WITHHELD: 1 },
    },
    { A1: countBy("A1"), A2: countBy("A2"), A3: countBy("A3"), A7: countBy("A7") },
    "A1 fully published; A2 17 draft (+2 published for the Completed students); A3 10 draft, 7 published, 1 withheld; A7 5 published, 1 withheld",
  );
  const raisa = markOf("Raisa Mahmud", "A3");
  expectEqual(
    "Raisa's result is published although fees are overdue",
    ["PUBLISHED", true],
    [raisa?.releaseStatus, (fees.get("Raisa Mahmud")?.overdueAmount.toNumber() ?? 0) > 0],
  );
  const fahim = markOf("Fahim Rahman", "A1");
  const fahimChange = fahim?.changes.find((c) => c.change === "MARK");
  verified(
    "post-publish mark change",
    { mark: "62.5", version: 2, old: "57.0", new: "62.5", hasReason: true, releaseStatus: "PUBLISHED" },
    {
      mark: fahim?.mark?.toFixed(1),
      version: fahim?.version,
      old: fahimChange?.oldMark?.toFixed(1),
      new: fahimChange?.newMark?.toFixed(1),
      hasReason: Boolean(fahimChange?.reason),
      releaseStatus: fahim?.releaseStatus,
    },
    "Fahim's published A1 mark changed 57.0 -> 62.5 after appeal (MARK_CHANGE row with reason)",
  );
  const missingAudit = marks
    .filter((m) => m.releaseStatus !== "DRAFT" && !m.changes.some((c) => c.change === (m.releaseStatus === "PUBLISHED" ? "PUBLISH" : "WITHHOLD")))
    .map((m) => nameOf.get(m.studentId));
  expectEqual("every published or withheld mark has its audit row", [], missingAudit);

  // --- Submissions: late, resubmitted, missing (real rules: effectiveDeadline, lateBy) ---------------------------------------------------
  const late: string[][] = [];
  const checkedFiles: { key: string; size: number }[] = [];
  let versions = 0;
  for (const s of students) {
    for (const sub of s.submissions) {
      const code = codeOfAssessment.get(sub.assessmentId)!;
      const assessment = assessmentRows.find((a) => a.id === sub.assessmentId)!;
      const files = [...sub.files].sort((a, b) => a.uploadedAt.getTime() - b.uploadedAt.getTime());
      versions += files.length;
      for (const f of files) checkedFiles.push({ key: f.objectKey, size: f.sizeBytes });
      const deadline = effectiveDeadline(assessment.deadline, null);
      const latest = files[files.length - 1]!;
      const label = lateBy(latest.uploadedAt, deadline);
      if (label) late.push([s.fullName, code, label]);
      expectEqual(
        `${s.fullName} ${code}: first/last submitted match the files`,
        [files[0]!.uploadedAt.toISOString(), latest.uploadedAt.toISOString()],
        [sub.firstSubmittedAt.toISOString(), sub.lastSubmittedAt.toISOString()],
      );
    }
  }
  verified(
    "late submissions",
    [
      ["Farhana Akter", "A9", "5 hours"],
      ["Rafiqul Alam", "A3", "5 hours"],
      ["Shakil Ahmed", "A4", "1 hour"],
      ["Tahsin Rahman", "A3", "2 days"],
      ["Tanvir Hasan", "A3", "2 days"],
    ],
    late.sort(),
    "5 late submissions: A3 (Tanvir 2 days, Tahsin 2 days, Rafiqul 5 hours), A4 (Shakil 1 hour), A9 (Farhana 5 hours)",
  );
  const filesOf = (name: string, code: string) =>
    studentByName
      .get(name)!
      .submissions.find((sub) => codeOfAssessment.get(sub.assessmentId) === code)?.files.length ?? 0;
  verified(
    "resubmissions and missing work",
    { "Tahmid A3": 2, "Sadia A5": 2, "Zubair A3": 0, "Sumaiya A1": 0 },
    {
      "Tahmid A3": filesOf("Tahmid Chowdhury", "A3"),
      "Sadia A5": filesOf("Sadia Chowdhury", "A5"),
      "Zubair A3": filesOf("Zubair Hasan", "A3"),
      "Sumaiya A1": filesOf("Sumaiya Haque", "A1"),
    },
    "Tahmid resubmitted A3 (2 file versions); Zubair never submitted A3; Sumaiya has no A1 file (NS)",
  );
  const submissionsPerAssessment = Object.fromEntries(
    ASSESSMENTS.map((a) => [
      a.code,
      students.filter((s) => s.submissions.some((sub) => codeOfAssessment.get(sub.assessmentId) === a.code)).length,
    ]),
  );
  verified(
    "submissions per assessment",
    Object.fromEntries(ASSESSMENTS.map((a) => [a.code, Object.keys(a.submissions).length])),
    submissionsPerAssessment,
    `submissions per assessment: ${Object.entries(submissionsPerAssessment).map(([c, n]) => `${c}=${n}`).join(" ")}`,
  );

  // --- Assessment states -----------------------------------------------------------------------------------------------------------------
  const state = (code: string) => {
    const a = assessmentByCode.get(code)!;
    return {
      closed: a.closedAt !== null,
      deadlinePassed: a.deadline.getTime() < now.getTime(),
    };
  };
  verified(
    "assessment states",
    {
      A1: { closed: true, deadlinePassed: true },
      A7: { closed: true, deadlinePassed: true },
      A9: { closed: false, deadlinePassed: true },
      A5: { closed: false, deadlinePassed: false },
      A6: { closed: false, deadlinePassed: false },
      A8: { closed: false, deadlinePassed: false },
      A10: { closed: false, deadlinePassed: false },
    },
    Object.fromEntries(["A1", "A7", "A9", "A5", "A6", "A8", "A10"].map((c) => [c, state(c)])),
    "A1 and A7 closed; A9 past its deadline but still open; A5, A6, A8, A10 open with future deadlines",
  );

  // --- Who can upload (real rule: canUpload) -------------------------------------------------------------------------------------------------------
  const decision = (name: string, code: string) => {
    const s = studentByName.get(name)!;
    const a = assessmentByCode.get(code)!;
    const existing = s.submissions.find((sub) => sub.assessmentId === a.id);
    const result = canUpload(
      { status: s.status, programmeModuleIds: programmeModuleIds.get(s.programmeId) ?? [] },
      { moduleId: a.moduleId, deadline: a.deadline, closedAt: a.closedAt },
      existing ? { lastSubmittedAt: existing.lastSubmittedAt } : null,
      now,
    );
    return result.allowed ? (result.late ? "allowed (late)" : "allowed") : result.reason;
  };
  verified(
    "upload rules for non-enrolled students",
    {
      "Rakib Islam A5": "NOT_ENROLLED",
      "Nadia Islam A6": "NOT_ENROLLED",
      "Priyanka Roy A8": "NOT_ENROLLED",
      "Mahmud Karim A5": "NOT_ENROLLED",
      "Sabbir Hossain A6": "NOT_ENROLLED",
      "Habib Ullah A8": "NOT_ENROLLED",
    },
    {
      "Rakib Islam A5": decision("Rakib Islam", "A5"),
      "Nadia Islam A6": decision("Nadia Islam", "A6"),
      "Priyanka Roy A8": decision("Priyanka Roy", "A8"),
      "Mahmud Karim A5": decision("Mahmud Karim", "A5"),
      "Sabbir Hossain A6": decision("Sabbir Hossain", "A6"),
      "Habib Ullah A8": decision("Habib Ullah", "A8"),
    },
    "Deferred and Withdrawn students are blocked from uploading (NOT_ENROLLED)",
  );
  verified(
    "upload rules for enrolled students",
    {
      "Ayesha Rahman A5 (replace before deadline)": "allowed",
      "Tanvir Hasan A9 (late, still open)": "allowed (late)",
      "Farhana Akter A9 (replace a late file)": "allowed (late)",
      "Ayesha Rahman A1 (closed)": "CLOSED",
      "Anika Tabassum A1 (module not in programme)": "MODULE_NOT_IN_PROGRAMME",
    },
    {
      "Ayesha Rahman A5 (replace before deadline)": decision("Ayesha Rahman", "A5"),
      "Tanvir Hasan A9 (late, still open)": decision("Tanvir Hasan", "A9"),
      "Farhana Akter A9 (replace a late file)": decision("Farhana Akter", "A9"),
      "Ayesha Rahman A1 (closed)": decision("Ayesha Rahman", "A1"),
      "Anika Tabassum A1 (module not in programme)": decision("Anika Tabassum", "A1"),
    },
    "Enrolled students: can replace before the deadline, upload late while A9 is open, blocked on closed A1",
  );

  // --- Nothing dated in the future, and the files really exist ------------------------------------------------------------------------------------------
  const future: string[] = [];
  const check = (what: string, when: Date | null | undefined) => {
    if (when && when.getTime() > now.getTime()) future.push(`${what} ${when.toISOString()}`);
  };
  for (const s of students) {
    check(`${s.fullName} created`, s.createdAt);
    for (const c of s.statusChanges) check(`${s.fullName} status change`, c.changedAt);
    for (const p of s.payments) {
      check(`${s.fullName} payment recorded`, p.recordedAt);
      check(`${s.fullName} payment voided`, p.voidedAt);
      check(`${s.fullName} payment date`, p.paidAt);
    }
    for (const c of s.feeCharges) check(`${s.fullName} charge created`, c.createdAt);
    for (const sub of s.submissions) for (const f of sub.files) check(`${s.fullName} upload`, f.uploadedAt);
  }
  for (const m of marks) {
    check(`${nameOf.get(m.studentId)} mark updated`, m.updatedAt);
    check(`${nameOf.get(m.studentId)} mark published`, m.publishedAt);
    for (const c of m.changes) check(`${nameOf.get(m.studentId)} mark change`, c.changedAt);
  }
  verified("no event is dated after T", [], future, "no event timestamp lies after the seed moment");

  const missingObjects: string[] = [];
  for (let i = 0; i < checkedFiles.length; i += 8) {
    await Promise.all(
      checkedFiles.slice(i, i + 8).map(async (file) => {
        const info = await storage.headObject(file.key);
        if (!info) missingObjects.push(`${file.key}: missing`);
        else if (info.sizeBytes !== file.size) missingObjects.push(`${file.key}: ${info.sizeBytes} bytes, expected ${file.size}`);
      }),
    );
  }
  verified(
    "uploaded files exist in the bucket",
    [],
    missingObjects,
    `${checkedFiles.length} submission files (${versions} versions) exist in the bucket with the recorded sizes`,
  );

  if (problems.length > 0) throw new SeedCheckError(problems);

  // --- Fingerprint: content only, no ids and no timestamps -----------------------------------------------------------------------------------------------
  const content = students.map((s) => {
    const fee = fees.get(s.fullName)!;
    return {
      number: s.studentNumber,
      name: s.fullName,
      email: s.email,
      dob: s.dateOfBirth.toISOString().slice(0, 10),
      programme: s.programme.code,
      session: s.academicYear,
      year: s.yearOfStudy,
      status: s.status,
      version: s.version,
      fee: {
        charged: fee.charged.toFixed(2),
        waived: fee.waived.toFixed(2),
        paid: fee.paid.toFixed(2),
        balance: fee.balance.toFixed(2),
        overdue: fee.overdueAmount.toFixed(2),
        bucket: fee.ageingBucket,
        state: fee.feeState,
        days: fee.oldestOverdueDays,
      },
      payments: s.payments
        .map((p) => `${p.amount.toFixed(2)}/${p.method}/${p.voidedAt ? "void" : "ok"}`)
        .sort(),
      marks: marks
        .filter((m) => m.studentId === s.id)
        .map((m) => `${codeOfAssessment.get(m.assessmentId)}:${m.mark?.toFixed(1) ?? "NS"}:${m.releaseStatus}:${m.withheldReason ?? ""}:v${m.version}:${m.changes.length}`)
        .sort(),
      submissions: s.submissions
        .map((sub) => {
          const assessment = assessmentRows.find((a) => a.id === sub.assessmentId)!;
          const last = [...sub.files].sort((a, b) => a.uploadedAt.getTime() - b.uploadedAt.getTime()).pop()!;
          return `${codeOfAssessment.get(sub.assessmentId)}:${sub.files.length}:${lateBy(last.uploadedAt, assessment.deadline) ?? "on time"}:${sub.files.map((f) => f.originalName).sort().join("+")}`;
        })
        .sort(),
    };
  });
  const fingerprint = createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 16);
  lines.push(`session ${sessionLabel(sessionStartYear(now))}; seed moment ${now.toISOString()}`);

  return { lines, fingerprint };
}
