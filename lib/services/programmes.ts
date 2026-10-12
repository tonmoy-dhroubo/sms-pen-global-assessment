import { db } from "@/lib/db";
import { BusinessRuleError, NotFoundError } from "@/lib/api/errors";
import { assertKnownId, dateColumn } from "@/lib/services/ids";
import { sum, toApiString } from "@/lib/services/rules/money";
import { toDateOnly } from "@/lib/services/rules/time";
import type { DateOnly } from "@/lib/services/rules/types";
import type { FeeScheduleInput } from "@/lib/validation/programmes";

// Programmes, their modules and their fee schedules (api.md "Programmes and modules").
//
// A fee schedule is the list of instalments a student is billed when enrolled into a session (M09 `createStudent`).
// Charges copy the amount and due date at that moment, so changing a schedule affects only students enrolled
// afterwards: existing FeeCharge rows are never read for update or written here.

export interface ModuleRef {
  id: string;
  code: string;
  title: string;
}

export interface ProgrammeSummary {
  id: string;
  code: string;
  name: string;
  durationYears: number;
  modules: ModuleRef[];
}

export interface Instalment {
  instalment: number;
  amount: string;
  dueDate: DateOnly;
}

/** One session's schedule. */
export interface FeeSchedule {
  academicYear: string;
  instalments: Instalment[];
  /** Sum of the instalments. */
  total: string;
  /** Students already billed from this schedule; their charges do not change when the schedule does. */
  billedStudents: number;
}

export interface ProgrammeDetail extends ProgrammeSummary {
  /** Newest session first. */
  feeSchedules: FeeSchedule[];
}

export interface ModuleWithProgrammes extends ModuleRef {
  programmes: { id: string; code: string; name: string }[];
}

const MODULE_REF = { id: true, code: true, title: true } as const;

type ProgrammeRow = {
  id: string;
  code: string;
  name: string;
  durationYears: number;
  modules: { module: ModuleRef }[];
};

function toSummary(row: ProgrammeRow): ProgrammeSummary {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    durationYears: row.durationYears,
    modules: row.modules.map((link) => link.module).sort((a, b) => a.code.localeCompare(b.code)),
  };
}

const WITH_MODULES = { modules: { select: { module: { select: MODULE_REF } } } } as const;

/** Programmes (by name) with the modules each includes. */
export async function listProgrammes(): Promise<ProgrammeSummary[]> {
  const rows = await db.programme.findMany({ orderBy: [{ name: "asc" }], include: WITH_MODULES });
  return rows.map(toSummary);
}

/** Every module with the programmes that include it. */
export async function listModules(): Promise<ModuleWithProgrammes[]> {
  const rows = await db.module.findMany({
    orderBy: [{ code: "asc" }],
    include: {
      programmes: { select: { programme: { select: { id: true, code: true, name: true } } } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    title: row.title,
    programmes: row.programmes
      .map((link) => link.programme)
      .sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

type FeeRow = {
  id: string;
  academicYear: string;
  instalment: number;
  amount: { toFixed(dp?: number): string };
  dueDate: Date;
};

/** Students with at least one charge copied from each of the programme's schedule rows, per session. */
async function billedStudentCounts(programmeId: string): Promise<Map<string, number>> {
  const rows = await db.$queryRaw<{ academic_year: string; students: bigint }[]>`
    SELECT pf.academic_year, count(DISTINCT c.student_id) AS students
    FROM programme_fees pf JOIN fee_charges c ON c.programme_fee_id = pf.id
    WHERE pf.programme_id = ${programmeId}::uuid
    GROUP BY pf.academic_year`;
  return new Map(rows.map((row) => [row.academic_year, Number(row.students)]));
}

/** The same counts for every programme in one query, for the Programmes page: programme id, then session. */
async function billedStudentCountsByProgramme(): Promise<Map<string, Map<string, number>>> {
  const rows = await db.$queryRaw<{ programme_id: string; academic_year: string; students: bigint }[]>`
    SELECT pf.programme_id::text AS programme_id, pf.academic_year, count(DISTINCT c.student_id) AS students
    FROM programme_fees pf JOIN fee_charges c ON c.programme_fee_id = pf.id
    GROUP BY pf.programme_id, pf.academic_year`;
  const result = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const bySession = result.get(row.programme_id) ?? new Map<string, number>();
    bySession.set(row.academic_year, Number(row.students));
    result.set(row.programme_id, bySession);
  }
  return result;
}

function toSchedules(fees: FeeRow[], billed: Map<string, number>): FeeSchedule[] {
  const bySession = new Map<string, FeeRow[]>();
  for (const fee of fees) {
    const list = bySession.get(fee.academicYear) ?? [];
    list.push(fee);
    bySession.set(fee.academicYear, list);
  }
  return [...bySession.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([academicYear, rows]) => {
      const instalments = rows
        .sort((a, b) => a.instalment - b.instalment)
        .map((fee) => ({
          instalment: fee.instalment,
          amount: toApiString(fee.amount),
          dueDate: toDateOnly(fee.dueDate),
        }));
      return {
        academicYear,
        instalments,
        total: toApiString(sum(instalments.map((i) => i.amount))),
        billedStudents: billed.get(academicYear) ?? 0,
      };
    });
}

/** A programme with its modules and its fee schedule for every session that has one. */
export async function getProgramme(id: string): Promise<ProgrammeDetail> {
  assertKnownId(id, "Programme");
  const row = await db.programme.findUnique({
    where: { id },
    include: { ...WITH_MODULES, fees: true },
  });
  if (!row) throw new NotFoundError("Programme not found.");
  return {
    ...toSummary(row),
    feeSchedules: toSchedules(row.fees, await billedStudentCounts(id)),
  };
}

/** Every programme with its modules and fee schedules, for the Programmes page. */
export async function listProgrammeDetails(): Promise<ProgrammeDetail[]> {
  const [rows, billed] = await Promise.all([
    db.programme.findMany({
      orderBy: [{ name: "asc" }],
      include: { ...WITH_MODULES, fees: true },
    }),
    billedStudentCountsByProgramme(),
  ]);
  // Two queries however many programmes there are (the counts used to be one query per programme).
  return rows.map((row) => ({
    ...toSummary(row),
    feeSchedules: toSchedules(row.fees, billed.get(row.id) ?? new Map()),
  }));
}

export interface ScheduleResult {
  schedule: FeeSchedule;
  warnings: { code: string; message: string }[];
}

/**
 * Replaces one session's schedule for a programme. Instalments are matched by number: a number in the new list is
 * updated in place (or added), a number that is no longer listed is removed. Charges already created from an
 * instalment keep their own copy of the amount and date and are not touched, so a number that students have already
 * been billed for cannot be removed (422 `FEE_INSTALMENT_IN_USE`): the database also refuses, because those charges
 * reference the row. Edits to one programme's schedules are serialised on the programme row.
 */
export async function replaceFeeSchedule(
  programmeId: string,
  academicYear: string,
  input: FeeScheduleInput,
): Promise<ScheduleResult> {
  assertKnownId(programmeId, "Programme");

  const changed = await db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM programmes WHERE id = ${programmeId}::uuid FOR UPDATE`;
    if (locked.length === 0) throw new NotFoundError("Programme not found.");

    const existing = await tx.programmeFee.findMany({ where: { programmeId, academicYear } });
    const keep = new Set(input.instalments.map((row) => row.instalment));

    const removed = existing.filter((fee) => !keep.has(fee.instalment));
    if (removed.length > 0) {
      const used = await tx.feeCharge.groupBy({
        by: ["programmeFeeId"],
        where: { programmeFeeId: { in: removed.map((fee) => fee.id) } },
        _count: { _all: true },
      });
      if (used.length > 0) {
        const numbers = removed
          .filter((fee) => used.some((u) => u.programmeFeeId === fee.id))
          .map((fee) => fee.instalment)
          .sort((a, b) => a - b);
        throw new BusinessRuleError(
          "FEE_INSTALMENT_IN_USE",
          `Instalment ${numbers.join(", ")} has already been billed to students, so it cannot be removed from the ${academicYear} schedule. Keep ${numbers.length === 1 ? "it" : "them"} and change the amount or date instead.`,
          { instalments: numbers },
        );
      }
      await tx.programmeFee.deleteMany({ where: { id: { in: removed.map((fee) => fee.id) } } });
    }

    let changedAnything = removed.length > 0;
    for (const row of input.instalments) {
      const current = existing.find((fee) => fee.instalment === row.instalment);
      if (
        current &&
        toApiString(current.amount) === row.amount &&
        toDateOnly(current.dueDate) === row.dueDate
      ) {
        continue;
      }
      changedAnything = true;
      await tx.programmeFee.upsert({
        where: {
          programmeId_academicYear_instalment: {
            programmeId,
            academicYear,
            instalment: row.instalment,
          },
        },
        create: {
          programmeId,
          academicYear,
          instalment: row.instalment,
          amount: row.amount,
          dueDate: dateColumn(row.dueDate),
        },
        update: { amount: row.amount, dueDate: dateColumn(row.dueDate) },
      });
    }
    return changedAnything;
  });

  const [fees, billed] = await Promise.all([
    db.programmeFee.findMany({ where: { programmeId, academicYear } }),
    billedStudentCounts(programmeId),
  ]);
  const schedule = toSchedules(fees, billed)[0]!; // the transaction guarantees at least one instalment
  const warnings =
    changed && schedule.billedStudents > 0
      ? [
          {
            code: "EXISTING_CHARGES_UNCHANGED",
            message: `${schedule.billedStudents} ${schedule.billedStudents === 1 ? "student was" : "students were"} already billed from the ${academicYear} schedule. Their charges have not changed; the new amounts and dates apply to students enrolled from now on.`,
          },
        ]
      : [];
  return { schedule, warnings };
}
