import type {
  PaymentMethod,
  Prisma,
  PrismaClient,
  ReleaseStatus,
} from "@/lib/generated/prisma/client";
import { allocateStudentNumber } from "@/lib/services/student-number";
import { daysBetween, sessionLabel } from "@/lib/services/rules/time";
import type { DateOnly } from "@/lib/services/rules/types";
import { buildSubmissionKey, type Storage } from "@/lib/storage-core";
import type { Fixture } from "./fixtures";
import {
  APPEAL,
  ASSESSMENTS,
  BENGALI_FILE,
  DAYS_PER_SESSION,
  MODULES,
  PERSONAS,
  PROGRAMMES,
  STAFF,
  studentEmail,
  type AssessmentSpec,
  type MarkSpec,
  type Outcome,
  type PaySpec,
  type Persona,
  type StaffKey,
} from "./plan";
import type { Rng } from "./rng";
import { addDays, dateColumn, DAY_MS, HOUR_MS, MINUTE_MS, type Timeline } from "./timeline";

// Builds exactly the data in db/seed-plan.md. Everything is dated from the Timeline (seed moment `T`, Asia/Dhaka) and
// every filler value comes from the seeded generator, so two runs produce the same data.
//
// Timestamps in the database are the source of truth for seeded data: a submission's `uploadedAt` is set to the
// moment the plan says it arrived (e.g. 5 hours after the deadline). The objects themselves are real files in the
// bucket, but their storage `LastModified` is simply the seed run time.

export interface BuildContext {
  prisma: PrismaClient;
  storage: Storage;
  timeline: Timeline;
  rng: Rng;
  fixtures: { pdf: Fixture; docx: Fixture };
  log: (message: string) => void;
}

export interface BuildSummary {
  staff: number;
  programmes: number;
  modules: number;
  assessments: number;
  students: number;
  charges: number;
  payments: number;
  submissions: number;
  files: number;
  marks: number;
  markChanges: number;
}

type StudentRef = { id: string; enrolledAt: Date };
type FeeRow = { id: string; amount: number; dueDate: DateOnly; createdAt: Date };

const slug = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/** The persona with plan number `n`. */
const personaN = (n: number): Persona => {
  const persona = PERSONAS.find((p) => p.n === n);
  if (!persona) throw new Error(`Seed plan refers to unknown persona #${n}`);
  return persona;
};

export async function buildSeed(ctx: BuildContext): Promise<BuildSummary> {
  const { prisma, timeline: tl, rng, log } = ctx;
  const summary: BuildSummary = {
    staff: 0,
    programmes: 0,
    modules: 0,
    assessments: 0,
    students: 0,
    charges: 0,
    payments: 0,
    submissions: 0,
    files: 0,
    marks: 0,
    markChanges: 0,
  };

  // --- Staff ---------------------------------------------------------------------------------------------------------
  const staff = {} as Record<StaffKey, string>;
  for (const member of STAFF) {
    const row = await prisma.staff.create({
      data: { fullName: member.fullName, email: member.email, jobTitle: member.jobTitle },
    });
    staff[member.key] = row.id;
    summary.staff++;
  }
  log(`staff: ${summary.staff}`);

  // --- Programmes, fee schedules (current and the three earlier sessions) ----------------------------------------------
  const programmeIds = new Map<string, string>();
  const feeRows = new Map<string, FeeRow>(); // `${code}|${k}|${instalment}`
  for (const programme of PROGRAMMES) {
    const row = await prisma.programme.create({
      data: {
        code: programme.code,
        name: programme.name,
        durationYears: programme.durationYears,
      },
    });
    programmeIds.set(programme.code, row.id);
    summary.programmes++;
    for (let k = 3; k >= 0; k--) {
      for (const [index, instalment] of programme.instalments.entries()) {
        const dueDate = tl.day(instalment.dueDay - DAYS_PER_SESSION * k);
        const fee = await prisma.programmeFee.create({
          data: {
            programmeId: row.id,
            academicYear: sessionLabel(tl.sessionYear - k),
            instalment: index + 1,
            amount: instalment.amount.toFixed(2),
            dueDate: dateColumn(dueDate),
          },
        });
        const createdAt = new Date(tl.sessionStart(k).getTime() + 2 * DAY_MS + 9 * HOUR_MS);
        feeRows.set(`${programme.code}|${k}|${index + 1}`, {
          id: fee.id,
          amount: instalment.amount,
          dueDate,
          createdAt: createdAt.getTime() < tl.now.getTime() ? createdAt : tl.at(-1, 9),
        });
      }
    }
  }
  log(`programmes: ${summary.programmes}, fee schedules: 4 sessions each`);

  // --- Modules and the programme links -----------------------------------------------------------------------------------
  const moduleIds = new Map<string, string>();
  for (const moduleSpec of MODULES) {
    const row = await prisma.module.create({
      data: {
        code: moduleSpec.code,
        title: moduleSpec.title,
        programmes: {
          create: moduleSpec.programmes.map((code) => ({ programmeId: programmeIds.get(code)! })),
        },
      },
    });
    moduleIds.set(moduleSpec.code, row.id);
    summary.modules++;
  }
  log(`modules: ${summary.modules}`);

  // --- Assessments -----------------------------------------------------------------------------------------------------------
  const assessments = new Map<string, { id: string; spec: AssessmentSpec; deadline: Date }>();
  for (const spec of ASSESSMENTS) {
    let day = spec.deadlineDay;
    let deadline = tl.at(day, 23, 59);
    // A deadline that must be well in the past (so a late file can be dated before T) moves back a day at a time.
    while (
      spec.deadlineMinAgeHours !== undefined &&
      tl.now.getTime() - deadline.getTime() < spec.deadlineMinAgeHours * HOUR_MS
    ) {
      day -= 1;
      deadline = tl.at(day, 23, 59);
    }
    const row = await prisma.assessment.create({
      data: {
        moduleId: moduleIds.get(spec.module)!,
        title: spec.title,
        deadline,
        closedAt: spec.closedDay === undefined ? null : tl.at(spec.closedDay, 12, 0),
        createdById: staff.shirin,
      },
    });
    assessments.set(spec.code, { id: row.id, spec, deadline });
    summary.assessments++;
  }
  log(`assessments: ${summary.assessments}`);

  // --- Students: number, history, fee charges, payments -----------------------------------------------------------------------
  const students = new Map<number, StudentRef>();
  const chargeRows: Prisma.FeeChargeCreateManyInput[] = [];
  const paymentRows: Prisma.PaymentCreateManyInput[] = [];
  let paymentSeq = 0;

  const pickMethod = (): PaymentMethod => {
    const roll = rng.int(1, 100);
    if (roll <= 60) return "BANK_TRANSFER";
    if (roll <= 80) return "CASH";
    if (roll <= 92) return "BKASH";
    return "CARD";
  };
  const REFERENCE_PREFIX: Record<PaymentMethod, string> = {
    BANK_TRANSFER: "TRF",
    CASH: "CSH",
    BKASH: "BKS",
    NAGAD: "NGD",
    CARD: "CRD",
  };

  for (const persona of PERSONAS) {
    const sessions = (
      persona.sessions ?? Array.from({ length: persona.year }, (_, i) => persona.year - 1 - i)
    ).sort((a, b) => b - a); // oldest session first
    const firstK = sessions[0]!;
    // Enrolled a week or three into the first session, but always before today and before any later status change
    // (matters only when the seed runs very early in a session).
    const enrolledAt = new Date(
      Math.min(
        tl.sessionStart(firstK).getTime() + rng.int(8, 25) * DAY_MS + 10 * HOUR_MS,
        tl.at(-1, 10).getTime(),
        persona.leave ? tl.at(persona.leave.day - 1, 10).getTime() : Infinity,
      ),
    );
    const birthYear = tl.sessionYear - 18 - persona.year - rng.int(0, 1);
    const generatedDob = `${birthYear}-${String(rng.int(1, 12)).padStart(2, "0")}-${String(rng.int(1, 28)).padStart(2, "0")}`;
    const dateOfBirth = persona.dateOfBirth ?? generatedDob;

    const history: Prisma.StatusChangeCreateWithoutStudentInput[] = [
      {
        fromStatus: null,
        toStatus: "ENROLLED",
        reason: null,
        changedBy: { connect: { id: staff.kamrul } },
        changedAt: enrolledAt,
      },
    ];
    let lastChange = enrolledAt;
    if (persona.status !== "ENROLLED") {
      const leave = persona.leave!;
      lastChange = tl.at(leave.day, rng.int(9, 16), rng.int(0, 59));
      history.push({
        fromStatus: "ENROLLED",
        toStatus: persona.status,
        reason: leave.reason ?? null,
        changedBy: { connect: { id: staff.kamrul } },
        changedAt: lastChange,
      });
    }

    // The ID year is the start year of the student's first session (DB-015): pass a date inside that session.
    const numberDate = new Date(tl.sessionStart(firstK).getTime() + 14 * DAY_MS + 6 * HOUR_MS);
    const student = await prisma.$transaction(async (tx) => {
      const studentNumber = await allocateStudentNumber(tx, numberDate);
      return tx.student.create({
        data: {
          studentNumber,
          fullName: persona.name,
          email: studentEmail(persona.name),
          dateOfBirth: dateColumn(dateOfBirth),
          programmeId: programmeIds.get(persona.programme)!,
          academicYear: sessionLabel(tl.sessionYear - (persona.academicYearOffset ?? 0)),
          yearOfStudy: persona.year,
          status: persona.status,
          version: history.length, // one per status change after creation
          createdAt: enrolledAt,
          updatedAt: lastChange,
          statusChanges: { create: history },
        },
      });
    });
    students.set(persona.n, { id: student.id, enrolledAt });
    summary.students++;

    // Charges ---------------------------------------------------------------------------------------------------------
    const programme = PROGRAMMES.find((p) => p.code === persona.programme)!;
    const billed = (k: number) =>
      k === 0 && persona.billedInstalments !== undefined
        ? programme.instalments.slice(0, persona.billedInstalments)
        : programme.instalments;
    for (const k of sessions) {
      const label = sessionLabel(tl.sessionYear - k);
      for (const [index] of billed(k).entries()) {
        const fee = feeRows.get(`${persona.programme}|${k}|${index + 1}`)!;
        const multi = programme.instalments.length > 1;
        const createdAt = k === firstK ? new Date(enrolledAt.getTime() + 5 * MINUTE_MS) : fee.createdAt;
        chargeRows.push({
          studentId: student.id,
          programmeFeeId: fee.id,
          kind: "PROGRAMME_FEE",
          academicYear: label,
          description: multi ? `Tuition ${label}, instalment ${index + 1}` : `Tuition ${label}`,
          amount: fee.amount.toFixed(2),
          dueDate: dateColumn(fee.dueDate),
          createdAt,
          createdById: staff.kamrul, // billed when the student was enrolled
        });
        if (k === 0 && index === 0 && persona.waiver) {
          chargeRows.push({
            studentId: student.id,
            programmeFeeId: null,
            kind: "WAIVER",
            academicYear: label,
            description: `${persona.waiver.description} ${label}`,
            createdById: staff.fatema, // the Finance Officer grants waivers
            amount: (-persona.waiver.amount).toFixed(2),
            dueDate: dateColumn(fee.dueDate),
            createdAt: new Date(createdAt.getTime() + 3 * HOUR_MS),
          });
        }
      }
    }

    // Payments --------------------------------------------------------------------------------------------------------
    for (const k of sessions) {
      const plan = persona.pay?.[k] ?? "full";
      if (plan === "none") continue;
      const specs: PaySpec[] =
        plan === "full"
          ? billed(k).map((instalment, index) => ({
              amount:
                instalment.amount - (k === 0 && index === 0 ? (persona.waiver?.amount ?? 0) : 0),
              instalment: index + 1,
            }))
          : plan;

      let previous: { instalment: number; paidOn: DateOnly; voided: boolean } | undefined;
      for (const spec of specs) {
        const instalment = spec.instalment ?? 1;
        const fee = feeRows.get(`${persona.programme}|${k}|${instalment}`);
        if (!fee) throw new Error(`#${persona.n}: no instalment ${instalment} in session -${k}`);

        // Random draws are unconditional so the stream does not depend on which fields a spec sets.
        const daysBefore = rng.int(2, 9);
        const prepayDays = rng.int(3, 12);
        const method = pickMethod();
        const hour = rng.int(9, 16);
        const minute = rng.int(0, 59);
        const lateStaff = rng.next() < 0.3;

        // Paid shortly before the due date, but never later than a few days ago (instalments that are not due yet
        // are pre-paid). A re-recorded payment keeps the date of the voided one it replaces.
        const early = addDays(fee.dueDate, -daysBefore);
        const prepay = tl.day(-prepayDays);
        const paidOn: DateOnly =
          previous?.voided && previous.instalment === instalment
            ? previous.paidOn
            : early < prepay
              ? early
              : prepay;

        const afterVoid = previous?.voided && previous.instalment === instalment;
        const recordedAt = spec.voidReason
          ? tl.at(daysBetween(tl.today, paidOn), 11, 5)
          : afterVoid
            ? tl.at(daysBetween(tl.today, paidOn), 15, 35)
            : tl.at(daysBetween(tl.today, paidOn), hour, minute);
        const chosenMethod = spec.method ?? persona.method ?? method;
        const recordedBy = spec.by ?? (lateStaff ? "fatema" : "kamrul");

        paymentSeq++;
        paymentRows.push({
          studentId: student.id,
          amount: spec.amount.toFixed(2),
          method: chosenMethod,
          paidAt: dateColumn(paidOn),
          reference: `${REFERENCE_PREFIX[chosenMethod]}-${paidOn.replaceAll("-", "")}-${String(paymentSeq).padStart(5, "0")}`,
          recordedById: staff[recordedBy],
          recordedAt,
          voidedAt: spec.voidReason ? tl.at(daysBetween(tl.today, paidOn), 15, 20) : null,
          voidedById: spec.voidReason ? staff[recordedBy] : null, // voided by whoever recorded it
          voidReason: spec.voidReason ?? null,
        });
        previous = { instalment, paidOn, voided: Boolean(spec.voidReason) };
      }
    }
  }
  await prisma.feeCharge.createMany({ data: chargeRows });
  await prisma.payment.createMany({ data: paymentRows });
  summary.charges = chargeRows.length;
  summary.payments = paymentRows.length;
  log(
    `students: ${summary.students}, fee charges: ${summary.charges}, payments: ${summary.payments}`,
  );

  // --- Submissions: real files in the bucket, rows dated as the plan says --------------------------------------------------
  interface Upload {
    key: string;
    fixture: Fixture;
    persona: number;
  }
  const uploads: Upload[] = [];
  const submissionRows: Prisma.SubmissionCreateInput[] = [];

  for (const { id: assessmentId, spec, deadline } of assessments.values()) {
    for (const [nText, outcome] of Object.entries(spec.submissions)) {
      const n = Number(nText);
      const persona = personaN(n);
      const student = students.get(n)!;
      const arrivals = arrivalTimes(outcome, deadline);

      const files = arrivals.map((uploadedAt, index) => {
        // The first file is a PDF or a DOCX (60/40); a resubmission is PDF then DOCX, so the two versions differ.
        const pick = rng.int(1, 100) <= 60 ? "pdf" : "docx";
        const fixture = ctx.fixtures[arrivals.length > 1 ? (index === 0 ? "pdf" : "docx") : pick];
        const key = buildSubmissionKey(assessmentId, student.id, fixture.extension);
        uploads.push({ key, fixture, persona: n });
        const bengali = spec.code === BENGALI_FILE.assessment && n === BENGALI_FILE.n;
        const base = `${slug(persona.name)}_${slug(spec.title)}`;
        return {
          version: index + 1,
          objectKey: key,
          originalName: bengali
            ? BENGALI_FILE.name
            : `${base}${arrivals.length > 1 ? `_v${index + 1}` : ""}.${fixture.extension}`,
          mimeType: fixture.mimeType,
          sizeBytes: fixture.body.length,
          sha256: fixture.sha256,
          uploadedAt,
        };
      });

      submissionRows.push({
        assessment: { connect: { id: assessmentId } },
        student: { connect: { id: student.id } },
        firstSubmittedAt: arrivals[0]!,
        lastSubmittedAt: arrivals[arrivals.length - 1]!,
        files: { create: files },
      });
      summary.files += files.length;
    }
  }

  // Upload the files first (a few at a time), then write the rows that point at them.
  await mapInBatches(uploads, 8, (upload) =>
    ctx.storage.putObject(upload.key, upload.fixture.body, upload.fixture.mimeType),
  );
  for (const data of submissionRows) await prisma.submission.create({ data });
  summary.submissions = submissionRows.length;
  log(`submissions: ${summary.submissions}, files uploaded: ${summary.files}`);

  // --- Marks and their audit trail ----------------------------------------------------------------------------------------
  for (const { id: assessmentId, spec } of assessments.values()) {
    for (const mark of spec.marks ?? []) {
      const student = students.get(mark.n)!;
      const created = await createMark(assessmentId, spec, mark, student.id);
      summary.marks++;
      summary.markChanges += created;
    }
  }
  log(`marks: ${summary.marks}, mark changes: ${summary.markChanges}`);

  return summary;

  // --- helpers that close over the context ---------------------------------------------------------------------------------

  function arrivalTimes(outcome: Outcome, deadline: Date): Date[] {
    // Both draws are unconditional (see the payment loop).
    const minutesBefore = rng.int(150, 4200);
    const hoursAgo = rng.int(180, 5400);
    const versionGap = rng.int(14 * 60, 24 * 60);
    const onTimeAt =
      deadline.getTime() > tl.now.getTime()
        ? new Date(tl.now.getTime() - hoursAgo * MINUTE_MS) // still open: submitted some hours or days ago
        : new Date(deadline.getTime() - minutesBefore * MINUTE_MS);
    switch (outcome.kind) {
      case "onTime":
        return [onTimeAt];
      case "late":
        return [new Date(deadline.getTime() + outcome.afterMs)];
      case "resubmitted":
        return [new Date(onTimeAt.getTime() - versionGap * MINUTE_MS), onTimeAt];
    }
  }

  async function createMark(
    assessmentId: string,
    spec: AssessmentSpec,
    mark: MarkSpec,
    studentId: string,
  ): Promise<number> {
    const enteredAt = tl.at(spec.enteredDay!, rng.int(9, 16), rng.int(0, 59));
    const releasedAt = tl.at(mark.publishedDay ?? spec.publishedDay ?? spec.enteredDay!, rng.int(10, 16), rng.int(0, 59));
    const autoValue = (45 + rng.int(0, 400) / 10).toFixed(1);

    const isNs = mark.mark === "NS";
    const value = mark.mark === "NS" ? null : mark.mark === "AUTO" ? autoValue : mark.mark.toFixed(1);
    const appeal =
      spec.code === APPEAL.assessment && mark.n === APPEAL.n ? APPEAL : undefined;
    const appealAt = appeal ? tl.at(appeal.day, 11, 30) : undefined;

    const changes: Prisma.MarkChangeCreateWithoutMarkInput[] = [];
    const release: ReleaseStatus = mark.release;
    if (release === "PUBLISHED") {
      changes.push({ change: "PUBLISH", changedBy: { connect: { id: staff.shirin } }, changedAt: releasedAt });
    } else if (release === "WITHHELD") {
      changes.push({
        change: "WITHHOLD",
        reason: mark.reason ?? null,
        changedBy: { connect: { id: staff.shirin } },
        changedAt: releasedAt,
      });
    }
    if (appeal && appealAt) {
      changes.push({
        change: "MARK",
        oldMark: value,
        newMark: appeal.newMark.toFixed(1),
        reason: appeal.reason,
        changedBy: { connect: { id: staff.shirin } },
        changedAt: appealAt,
      });
    }

    await prisma.mark.create({
      data: {
        assessmentId,
        studentId,
        mark: appeal ? appeal.newMark.toFixed(1) : value,
        isNonSubmission: isNs,
        releaseStatus: release,
        withheldReason: release === "WITHHELD" ? (mark.reason ?? null) : null,
        publishedAt: release === "PUBLISHED" ? releasedAt : null,
        version: appeal ? 2 : 1,
        enteredById: staff.shirin,
        updatedAt: appealAt ?? (release === "DRAFT" ? enteredAt : releasedAt),
        changes: { create: changes },
      },
    });
    return changes.length;
  }
}

/** Runs `task` over `items`, at most `size` at a time. */
async function mapInBatches<T>(items: T[], size: number, task: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(task));
  }
}
