import type {
  EnrolmentStatus,
  PaymentMethod,
  ReleaseStatus,
} from "@/lib/generated/prisma/client";

// The seed plan (db/seed-plan.md) as data. Nothing here reads the clock or touches the database; offsets such as
// `dueDay: -40` mean "T-40 days" and are resolved against the seed moment by build.ts. The persona numbers (`n`) are
// the row numbers of the plan's student table.

// --- Staff -----------------------------------------------------------------------------------------------------------

export type StaffKey = "kamrul" | "shirin" | "fatema";

export const STAFF: { key: StaffKey; fullName: string; email: string; jobTitle: string }[] = [
  {
    key: "kamrul",
    fullName: "Kamrul Hasan",
    email: "kamrul.hasan@registry.example.edu",
    jobTitle: "Registry Officer",
  },
  {
    key: "shirin",
    fullName: "Dr. Shirin Akhter",
    email: "shirin.akhter@registry.example.edu",
    jobTitle: "Senior Lecturer",
  },
  {
    key: "fatema",
    fullName: "Fatema Begum",
    email: "fatema.begum@registry.example.edu",
    jobTitle: "Finance Officer",
  },
];

// --- Programmes and fee schedules ---------------------------------------------------------------------------------------

export type ProgrammeCode = "BSC-CSE" | "BBA" | "BA-ENG";

export interface InstalmentPlan {
  amount: number;
  /** Days from T on which the current session's instalment falls due (negative = in the past). */
  dueDay: number;
}

export const PROGRAMMES: {
  code: ProgrammeCode;
  name: string;
  durationYears: number;
  instalments: InstalmentPlan[];
}[] = [
  {
    code: "BSC-CSE",
    name: "BSc in Computer Science & Engineering",
    durationYears: 4,
    instalments: [
      { amount: 160_000, dueDay: -40 },
      { amount: 160_000, dueDay: 80 },
    ],
  },
  {
    code: "BBA",
    name: "Bachelor of Business Administration",
    durationYears: 4,
    instalments: [{ amount: 260_000, dueDay: -20 }],
  },
  {
    code: "BA-ENG",
    name: "BA (Hons) in English",
    durationYears: 4,
    instalments: [{ amount: 180_000, dueDay: -10 }],
  },
];

/** Earlier sessions use the same amounts (fee rises are out of scope) with due dates a year apart. */
export const DAYS_PER_SESSION = 365;

// --- Modules ----------------------------------------------------------------------------------------------------------

export const MODULES: { code: string; title: string; programmes: ProgrammeCode[] }[] = [
  { code: "CSE101", title: "Structured Programming", programmes: ["BSC-CSE"] },
  { code: "CSE201", title: "Data Structures", programmes: ["BSC-CSE"] },
  { code: "MAT101", title: "Calculus I", programmes: ["BSC-CSE", "BBA"] },
  { code: "BBA101", title: "Principles of Management", programmes: ["BBA"] },
  { code: "BBA102", title: "Financial Accounting", programmes: ["BBA"] },
  { code: "ENG101", title: "English Composition", programmes: ["BSC-CSE", "BBA", "BA-ENG"] },
  { code: "ENG201", title: "Introduction to Literature", programmes: ["BA-ENG"] },
  { code: "ENG210", title: "Academic Writing", programmes: ["BA-ENG"] },
];

// --- Students ---------------------------------------------------------------------------------------------------------

export type SessionPay = "full" | "none" | PaySpec[];

export interface PaySpec {
  amount: number;
  /** Which instalment of the session the payment is for (decides its date). Default 1. */
  instalment?: number;
  method?: PaymentMethod;
  by?: StaffKey;
  /** The payment was entered wrongly and voided with this reason; a later spec re-records it. */
  voidReason?: string;
}

export interface Persona {
  n: number;
  name: string;
  programme: ProgrammeCode;
  year: number;
  status: EnrolmentStatus;
  /** The change out of ENROLLED (not applicable to Enrolled students). `day` is days from T (negative = past). */
  leave?: { day: number; reason?: string };
  /** Which sessions are charged, as "sessions before the current one". Default: from the first session to now. */
  sessions?: number[];
  /** Only the first N instalments of the current session were billed (a student who left before the rest). */
  billedInstalments?: number;
  /** What was paid, per session offset (0 = current). Sessions not listed are paid in full. */
  pay?: Record<number, SessionPay>;
  /** Method used for every payment that does not name its own. */
  method?: PaymentMethod;
  /** A tuition waiver on instalment 1 of the current session, in BDT (stored as a negative charge). */
  waiver?: { amount: number; description: string };
  /** A fixed date of birth (YYYY-MM-DD) instead of a generated one: used by the duplicate-check demo. */
  dateOfBirth?: string;
  /** The student's record shows an earlier session than the current one (they left in that session). */
  academicYearOffset?: number;
}

export const PERSONAS: Persona[] = [
  {
    n: 1,
    name: "Ayesha Rahman",
    programme: "BSC-CSE",
    year: 1,
    status: "ENROLLED",
    pay: { 0: [{ amount: 160_000, instalment: 1 }] },
  },
  {
    n: 2,
    name: "Tanvir Hasan",
    programme: "BSC-CSE",
    year: 1,
    status: "ENROLLED",
    pay: { 0: [{ amount: 60_000, instalment: 1 }] },
  },
  {
    n: 3,
    name: "Nusrat Jahan",
    programme: "BSC-CSE",
    year: 1,
    status: "ENROLLED",
    pay: {
      0: [
        { amount: 160_000, instalment: 1, method: "BKASH" },
        { amount: 165_000, instalment: 2, method: "BKASH" },
      ],
    },
  },
  {
    n: 4,
    name: "Arif Hossain",
    programme: "BSC-CSE",
    year: 2,
    status: "ENROLLED",
    // Session S-1: instalment 1 paid, instalment 2 short by 40,000. Nothing paid this session. Payments settle the
    // oldest charge first (D-028), so the unpaid S-1 instalment 2 sets the age: 60+ days.
    pay: {
      1: [
        { amount: 160_000, instalment: 1 },
        { amount: 120_000, instalment: 2 },
      ],
      0: "none",
    },
  },
  { n: 5, name: "Farhana Akter", programme: "BSC-CSE", year: 2, status: "ENROLLED" },
  {
    n: 6,
    name: "Rakib Islam",
    programme: "BSC-CSE",
    year: 1,
    status: "DEFERRED",
    leave: { day: -30, reason: "Medical leave; returns next session" },
    pay: { 0: [{ amount: 160_000, instalment: 1 }] },
  },
  {
    n: 7,
    name: "Sadia Chowdhury",
    programme: "BSC-CSE",
    year: 3,
    status: "ENROLLED",
    pay: {
      0: [
        { amount: 106_000, instalment: 1, by: "fatema", voidReason: "Wrong amount entered" },
        { amount: 160_000, instalment: 1, by: "fatema" },
        { amount: 160_000, instalment: 2 },
      ],
    },
  },
  {
    n: 8,
    name: "Mahmud Karim",
    programme: "BSC-CSE",
    year: 1,
    status: "WITHDRAWN",
    leave: { day: -12, reason: "Transferred to another university" },
    // He left before instalment 2 was billed, so the whole debt is the unpaid 1,10,000 of instalment 1.
    billedInstalments: 1,
    pay: { 0: [{ amount: 50_000, instalment: 1 }] },
  },
  {
    n: 9,
    name: "Tasnim Ahmed",
    programme: "BSC-CSE",
    year: 2,
    status: "ENROLLED",
    waiver: { amount: 40_000, description: "Merit scholarship" },
  },
  {
    n: 10,
    name: "Imran Kabir",
    programme: "BSC-CSE",
    year: 4,
    status: "COMPLETED",
    leave: { day: -2 },
  },
  {
    n: 11,
    name: "Sumaiya Haque",
    programme: "BSC-CSE",
    year: 1,
    status: "ENROLLED",
    method: "NAGAD",
  },
  { n: 12, name: "Fahim Rahman", programme: "BSC-CSE", year: 3, status: "ENROLLED" },
  {
    n: 13,
    name: "Jannatul Ferdous",
    programme: "BBA",
    year: 1,
    status: "ENROLLED",
    pay: { 0: "none" },
  },
  {
    n: 14,
    name: "Shakil Ahmed",
    programme: "BBA",
    year: 1,
    status: "ENROLLED",
    method: "BANK_TRANSFER",
  },
  {
    n: 15,
    name: "Mehjabin Sultana",
    programme: "BBA",
    year: 2,
    status: "ENROLLED",
    pay: { 0: [{ amount: 245_000, instalment: 1 }] },
  },
  {
    n: 16,
    name: "Rafiqul Alam",
    programme: "BBA",
    year: 1,
    status: "ENROLLED",
    dateOfBirth: "2006-04-18",
  },
  {
    n: 17,
    name: "Nadia Islam",
    programme: "BBA",
    year: 3,
    status: "DEFERRED",
    leave: { day: -18, reason: "Family reasons" },
  },
  {
    n: 18,
    name: "Sabbir Hossain",
    programme: "BBA",
    year: 2,
    status: "WITHDRAWN",
    leave: { day: -15, reason: "Withdrew at the student's request" },
  },
  { n: 19, name: "Lamia Khan", programme: "BBA", year: 1, status: "ENROLLED" },
  {
    n: 20,
    name: "Ashraful Haque",
    programme: "BBA",
    year: 4,
    status: "COMPLETED",
    leave: { day: -2 },
  },
  {
    n: 21,
    name: "Raisa Mahmud",
    programme: "BBA",
    year: 1,
    status: "ENROLLED",
    pay: { 0: [{ amount: 100_000, instalment: 1 }] },
  },
  { n: 22, name: "Tahmid Chowdhury", programme: "BBA", year: 2, status: "ENROLLED" },
  { n: 23, name: "Anika Tabassum", programme: "BA-ENG", year: 1, status: "ENROLLED" },
  {
    n: 24,
    name: "Zubair Hasan",
    programme: "BA-ENG",
    year: 1,
    status: "ENROLLED",
    pay: { 0: "none" },
  },
  { n: 25, name: "Tahsin Rahman", programme: "BA-ENG", year: 2, status: "ENROLLED" },
  { n: 26, name: "Moumita Das", programme: "BA-ENG", year: 1, status: "ENROLLED" },
  { n: 27, name: "Arnab Saha", programme: "BA-ENG", year: 3, status: "ENROLLED" },
  {
    n: 28,
    name: "Priyanka Roy",
    programme: "BA-ENG",
    year: 1,
    status: "DEFERRED",
    leave: { day: -8, reason: "Personal reasons; returns next session" },
  },
  {
    n: 29,
    name: "Habib Ullah",
    programme: "BA-ENG",
    year: 2,
    status: "WITHDRAWN",
    // Left during session S-1 owing 90,000 of that session's fee; never charged for the current session.
    leave: { day: -330, reason: "Left the programme during the session" },
    sessions: [1],
    pay: { 1: [{ amount: 90_000, instalment: 1 }] },
    academicYearOffset: 1,
  },
  {
    n: 30,
    name: "Samira Siddiqui",
    programme: "BA-ENG",
    year: 4,
    status: "COMPLETED",
    leave: { day: -2 },
  },
];

/** `firstname.lastname@student.example.edu` (seed-plan rule 7). */
export function studentEmail(name: string): string {
  return `${name.toLowerCase().replace(/\s+/g, ".")}@student.example.edu`;
}

export function personaByName(name: string): Persona {
  const persona = PERSONAS.find((p) => p.name === name);
  if (!persona) throw new Error(`No persona named ${name}`);
  return persona;
}

// --- Assessments, submissions and marks ----------------------------------------------------------------------------------

/** How a student's file arrived, relative to the assessment's deadline. */
export type Outcome =
  | { kind: "onTime" }
  | { kind: "late"; afterMs: number }
  | { kind: "resubmitted" }; // two versions, both before the deadline

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// "Late by 5 hours" and the like: a little over the stated amount, so it still reads as that amount rounded down.
export const LATE_1_HOUR = HOUR + 14 * MIN;
export const LATE_5_HOURS = 5 * HOUR + 12 * MIN;
export const LATE_2_DAYS = 2 * DAY + 3 * HOUR + 25 * MIN;

export interface MarkSpec {
  n: number;
  /** A mark, "NS" (non-submission) or "AUTO" (filler 45-85 from the seeded generator). */
  mark: number | "NS" | "AUTO";
  release: ReleaseStatus;
  reason?: string;
  /** Overrides the assessment's publish day for this mark. */
  publishedDay?: number;
}

export interface AssessmentSpec {
  code: string; // A1 ... A10
  module: string;
  title: string;
  /** Days from T of the 23:59 deadline. */
  deadlineDay: number;
  /** The deadline must be at least this many hours before T, so late files can be dated before T. */
  deadlineMinAgeHours?: number;
  /** Days from T on which staff closed the assessment (no uploads at all after). */
  closedDay?: number;
  /** Persona number -> how their file arrived. Anyone not listed has not submitted. */
  submissions: Record<number, Outcome>;
  /** Days from T on which marks were entered and (for released ones) published. */
  enteredDay?: number;
  publishedDay?: number;
  marks?: MarkSpec[];
}

const onTime = (...ns: number[]): Record<number, Outcome> =>
  Object.fromEntries(ns.map((n) => [n, { kind: "onTime" } as Outcome]));

const autoMarks = (release: ReleaseStatus, ns: number[]): MarkSpec[] =>
  ns.map((n) => ({ n, mark: "AUTO" as const, release }));

export const ASSESSMENTS: AssessmentSpec[] = [
  {
    code: "A1",
    module: "CSE101",
    title: "Lab Assignment 1",
    deadlineDay: -21,
    closedDay: -14,
    submissions: onTime(1, 2, 3, 4, 5, 7, 8, 9, 10, 12),
    enteredDay: -13,
    publishedDay: -12,
    marks: [
      { n: 1, mark: 91.5, release: "PUBLISHED" },
      { n: 12, mark: 57.0, release: "PUBLISHED" }, // raised after an appeal, see APPEAL
      { n: 11, mark: "NS", release: "PUBLISHED" },
      ...autoMarks("PUBLISHED", [2, 3, 4, 5, 7, 8, 9, 10]),
    ],
  },
  {
    code: "A2",
    module: "MAT101",
    title: "Quiz 1",
    deadlineDay: -14,
    submissions: onTime(1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 19, 20, 21, 22),
    enteredDay: -11,
    marks: [
      { n: 1, mark: 84.5, release: "DRAFT" },
      { n: 11, mark: 39.5, release: "DRAFT" }, // boundary: rounds to 40, Pass
      { n: 14, mark: 69.5, release: "DRAFT" }, // boundary: rounds to 70, Distinction
      { n: 19, mark: 59.4, release: "DRAFT" }, // boundary: rounds to 59, stays Pass
      ...autoMarks("DRAFT", [2, 3, 4, 5, 7, 8, 9, 12, 13, 15, 16, 21, 22]),
      // The Completed students' marksheets are complete and published.
      { n: 10, mark: "AUTO", release: "PUBLISHED", publishedDay: -10 },
      { n: 20, mark: "AUTO", release: "PUBLISHED", publishedDay: -10 },
    ],
  },
  {
    code: "A3",
    module: "ENG101",
    title: "Essay 1",
    deadlineDay: -7,
    submissions: {
      ...onTime(1, 3, 4, 5, 7, 9, 10, 11, 12, 13, 14, 15, 19, 20, 21, 23, 26, 27, 30),
      2: { kind: "late", afterMs: LATE_2_DAYS },
      25: { kind: "late", afterMs: LATE_2_DAYS },
      16: { kind: "late", afterMs: LATE_5_HOURS },
      22: { kind: "resubmitted" },
      // #24 never submitted.
    },
    enteredDay: -4,
    publishedDay: -3,
    marks: [
      { n: 1, mark: 88.0, release: "PUBLISHED" },
      { n: 2, mark: "AUTO", release: "WITHHELD", reason: "Outstanding fees" },
      ...autoMarks("PUBLISHED", [10, 20, 21, 23, 26, 30]), // #21 is published despite overdue fees
      ...autoMarks("DRAFT", [3, 5, 7, 9, 13, 14, 15, 22, 25, 27]),
      // #4, #11, #12, #16 and #19 are not marked yet; #24 has nothing to mark.
    ],
  },
  {
    code: "A4",
    module: "BBA101",
    title: "Case Study",
    deadlineDay: -3,
    submissions: { ...onTime(13, 15, 16, 21, 22), 14: { kind: "late", afterMs: LATE_1_HOUR } },
  },
  {
    code: "A5",
    module: "CSE201",
    title: "Project Proposal",
    deadlineDay: 5,
    submissions: { ...onTime(1, 3, 5, 9), 7: { kind: "resubmitted" } },
  },
  { code: "A6", module: "BBA102", title: "Assignment 1", deadlineDay: 10, submissions: {} },
  {
    code: "A7",
    module: "ENG201",
    title: "Reading Response",
    deadlineDay: -30,
    closedDay: -25,
    submissions: onTime(23, 24, 25, 26, 27, 30),
    enteredDay: -27,
    publishedDay: -24,
    marks: [
      { n: 26, mark: 82.5, release: "PUBLISHED" },
      { n: 27, mark: 62.0, release: "WITHHELD", reason: "Academic misconduct investigation" },
      ...autoMarks("PUBLISHED", [23, 24, 25, 30]),
    ],
  },
  {
    code: "A8",
    module: "ENG210",
    title: "Portfolio",
    deadlineDay: 2,
    submissions: onTime(23, 26),
  },
  {
    code: "A9",
    module: "CSE101",
    title: "Lab Assignment 2",
    deadlineDay: -1,
    deadlineMinAgeHours: 6,
    submissions: { ...onTime(1, 3, 7, 9), 5: { kind: "late", afterMs: LATE_5_HOURS } },
  },
  {
    code: "A10",
    module: "MAT101",
    title: "Quiz 2",
    deadlineDay: 14,
    submissions: onTime(1, 14),
  },
];

/** The published A1 mark of #12 was raised after an appeal (seed-plan: "changed after appeal"). */
export const APPEAL = {
  assessment: "A1",
  n: 12,
  newMark: 62.5,
  day: -6,
  reason: "Appeal upheld: question 3 re-marked by a second examiner",
};

/** Upload that keeps a Bengali original file name, to show non-ASCII names survive downloads (D-030). */
export const BENGALI_FILE = { assessment: "A8", n: 26, name: "পোর্টফোলিও.pdf" };
