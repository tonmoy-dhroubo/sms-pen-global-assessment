import { db } from "@/lib/db";
import {
  BusinessRuleError,
  ConflictError,
  DuplicateWarning,
  NotFoundError,
  ValidationError,
  VersionConflictError,
} from "@/lib/api/errors";
import { Prisma } from "@/lib/generated/prisma/client";
import { systemClock } from "@/lib/services/clock";
import type { Clock } from "@/lib/services/clock";
import { loadFeeSummaries, toFeeSummaryDto } from "@/lib/services/fee-summary";
import type { FeeSummaryDto } from "@/lib/services/fee-summary";
import { isProbableDuplicate } from "@/lib/services/rules/duplicates";
import { nextStudentNumber } from "@/lib/services/student-number";
import { checkTransition } from "@/lib/services/rules/status";
import {
  DATE_OF_BIRTH_MESSAGES,
  dateOfBirthProblem,
  sessionStartYearOf,
} from "@/lib/services/rules/student-profile";
import { sessionFor, todayIn, toDateOnly } from "@/lib/services/rules/time";
import type { DateOnly, EnrolmentStatus } from "@/lib/services/rules/types";
import { DEFAULT_STATUS_FILTER } from "@/lib/validation/students";
import type {
  ChangeStatusInput,
  CreateStudentInput,
  StudentListQuery,
  StudentSortField,
  UpdateStudentInput,
} from "@/lib/validation/students";

// The enrolment workflow (api.md "Students"): list, create, read, edit and change status. Business rules live here
// and nowhere else (tech-stack.md "Application layering"); Route Handlers only validate and call these functions.
//
//   - Student IDs come from the per-session sequence inside the same transaction that inserts the student
//     (DB-004, DB-015), so a failed insert leaves no gap.
//   - Emails are lower-cased and unique (DB-007); updates are optimistic (`version`, DB-016).
//   - Every status change, including the first, is a STATUS_CHANGE row (D-018 locale, edge-cases.md "Enrolment").

// --- Shapes ---------------------------------------------------------------------------------------------------------

export interface ProgrammeRef {
  id: string;
  code: string;
  name: string;
}

/** One row of the student list. */
export interface StudentListItem {
  id: string;
  studentNumber: string;
  fullName: string;
  email: string;
  programme: ProgrammeRef;
  academicYear: string;
  yearOfStudy: number;
  status: EnrolmentStatus;
  feeSummary: FeeSummaryDto;
}

export interface StudentList {
  items: StudentListItem[];
  page: number;
  pageSize: number;
  total: number;
}

/** The full record: profile, `version` and the fee summary. */
export interface StudentRecord {
  id: string;
  studentNumber: string;
  fullName: string;
  email: string;
  dateOfBirth: DateOnly;
  programme: ProgrammeRef & { durationYears: number };
  academicYear: string;
  yearOfStudy: number;
  status: EnrolmentStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  feeSummary: FeeSummaryDto;
}

/** A success that deserves attention (api.md "Warnings"); the handler attaches it to the response. */
export interface ServiceWarning {
  code: string;
  message: string;
}

export interface StudentResult {
  student: StudentRecord;
  warnings: ServiceWarning[];
}

/** A probable duplicate as shown in the warning dialog (`details.matches`). */
export interface DuplicateMatch {
  id: string;
  studentNumber: string;
  fullName: string;
  email: string;
  dateOfBirth: DateOnly;
  status: EnrolmentStatus;
  programme: ProgrammeRef;
}

// --- Helpers --------------------------------------------------------------------------------------------------------

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids from a URL may be anything; a malformed one is simply a record that does not exist. */
function assertKnownId(id: string): void {
  if (!UUID_PATTERN.test(id)) throw new NotFoundError("Student not found.");
}

function dateColumn(value: DateOnly): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

const PROGRAMME_REF = { id: true, code: true, name: true } as const;

type StudentWithProgramme = Prisma.StudentGetPayload<{
  include: { programme: { select: { id: true; code: true; name: true; durationYears: true } } };
}>;

const WITH_PROGRAMME = {
  programme: { select: { ...PROGRAMME_REF, durationYears: true } },
} as const;

function toRecord(student: StudentWithProgramme, feeSummary: FeeSummaryDto): StudentRecord {
  return {
    id: student.id,
    studentNumber: student.studentNumber,
    fullName: student.fullName,
    email: student.email,
    dateOfBirth: toDateOnly(student.dateOfBirth),
    programme: student.programme,
    academicYear: student.academicYear,
    yearOfStudy: student.yearOfStudy,
    status: student.status,
    version: student.version,
    createdAt: student.createdAt.toISOString(),
    updatedAt: student.updatedAt.toISOString(),
    feeSummary,
  };
}

async function loadRecord(id: string, clock: Clock): Promise<StudentRecord> {
  assertKnownId(id);
  const student = await db.student.findUnique({ where: { id }, include: WITH_PROGRAMME });
  if (!student) throw new NotFoundError("Student not found.");
  const summaries = await loadFeeSummaries([id], todayIn(clock()));
  return toRecord(student, toFeeSummaryDto(summaries.get(id)!));
}

function isUniqueViolation(error: unknown, column: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002")
    return false;
  const target = error.meta?.target;
  // The pg adapter reports the violated columns (or the constraint name); either way it mentions the column.
  return JSON.stringify(target ?? error.message).includes(column);
}

async function emailConflict(email: string, exceptId?: string): Promise<ConflictError | null> {
  const existing = await db.student.findUnique({
    where: { email },
    select: { id: true, studentNumber: true, fullName: true },
  });
  if (!existing || existing.id === exceptId) return null;
  return new ConflictError("A student with this email address already exists.", {
    field: "email",
    existing,
  });
}

function assertDateOfBirth(dateOfBirth: DateOnly, today: DateOnly): void {
  const problem = dateOfBirthProblem(dateOfBirth, today);
  if (problem) throw ValidationError.field("dateOfBirth", DATE_OF_BIRTH_MESSAGES[problem]);
}

function assertYearOfStudy(yearOfStudy: number, durationYears: number): void {
  if (yearOfStudy > durationYears) {
    throw ValidationError.field(
      "yearOfStudy",
      `This programme runs for ${durationYears} years; choose a year from 1 to ${durationYears}.`,
    );
  }
}

async function findProgramme(id: string) {
  const programme = await db.programme.findUnique({
    where: { id },
    select: { ...PROGRAMME_REF, durationYears: true },
  });
  if (!programme) throw ValidationError.field("programmeId", "Choose a programme.");
  return programme;
}

// --- List -----------------------------------------------------------------------------------------------------------

const SORT_SQL: Record<StudentSortField, Prisma.Sql> = {
  fullName: Prisma.sql`immutable_unaccent(lower(s.full_name))`, // the indexed expression (DB-021)
  studentNumber: Prisma.sql`s.student_number`,
  programme: Prisma.sql`p.code`,
  academicYear: Prisma.sql`s.academic_year`,
  yearOfStudy: Prisma.sql`s.year_of_study`,
  status: Prisma.sql`s.status`,
};

// `!` is the LIKE escape character, so a search for "50%" or "a_b" matches those characters literally.
function likePattern(term: string): string {
  return `%${term.replace(/[!%_]/g, (char) => `!${char}`)}%`;
}

function whereClause(query: StudentListQuery): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];

  const term = query.q?.trim();
  if (term) {
    // Name: case- and accent-insensitive, using exactly the indexed expression (DB-021). Student ID and email: plain
    // case-insensitive substring, so "0007" finds SMS-2026-0007 and "ayesha@" finds the address.
    const pattern = likePattern(term);
    conditions.push(
      Prisma.sql`(immutable_unaccent(lower(s.full_name)) LIKE immutable_unaccent(lower(${pattern})) ESCAPE '!'
        OR s.student_number ILIKE ${pattern} ESCAPE '!'
        OR s.email ILIKE ${pattern} ESCAPE '!')`,
    );
  }

  const statuses = query.status?.length ? query.status : DEFAULT_STATUS_FILTER;
  conditions.push(
    Prisma.sql`s.status IN (${Prisma.join(statuses.map((status) => Prisma.sql`${status}::enrolment_status`))})`,
  );

  if (query.programmeId) conditions.push(Prisma.sql`s.programme_id = ${query.programmeId}::uuid`);
  if (query.academicYear) conditions.push(Prisma.sql`s.academic_year = ${query.academicYear}`);
  if (query.yearOfStudy) conditions.push(Prisma.sql`s.year_of_study = ${query.yearOfStudy}`);

  return Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;
}

function orderClause(query: StudentListQuery): Prisma.Sql {
  const sort = query.sort ?? { field: "fullName", direction: "asc" };
  const expression = SORT_SQL[sort.field as StudentSortField];
  const direction = sort.direction === "desc" ? Prisma.sql`DESC` : Prisma.sql`ASC`;
  // Student ID then id make the order total, so pages never repeat or skip a row.
  return Prisma.sql`ORDER BY ${expression} ${direction}, s.student_number ASC, s.id ASC`;
}

/**
 * Students matching the search and filters, one page at a time (api.md `GET /api/students`).
 *
 * Search, filters, sorting and paging all happen in SQL, except the fee state. A fee state is derived from the charge
 * and payment rows by the M04 rule (oldest charge settled first, D-028), and re-implementing that in SQL would give
 * the system two definitions of "overdue". So:
 *   - no `feeState` filter: SQL returns just the page's ids, and fees are summarised for those <= 100 students;
 *   - with `feeState`: SQL returns every id that matches the other filters (in order), their fees are summarised in
 *     memory (two queries), the ones in that state are kept, and the page is sliced from them.
 * The second path reads the charges and payments of every student matching the other filters, so it is meant for
 * hundreds to a few thousand students (the brief's scale); beyond roughly ten thousand, move the rule into a view.
 */
export async function listStudents(
  query: StudentListQuery,
  clock: Clock = systemClock,
): Promise<StudentList> {
  const today = todayIn(clock());
  const where = whereClause(query);
  const order = orderClause(query);
  const { page, pageSize } = query;
  const offset = (page - 1) * pageSize;

  let pageIds: string[];
  let total: number;
  let summaries;

  if (query.feeState) {
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT s.id::text AS id FROM students s JOIN programmes p ON p.id = s.programme_id ${where} ${order}`;
    const ids = rows.map((row) => row.id);
    const all = await loadFeeSummaries(ids, today);
    const matching = ids.filter((id) => all.get(id)!.feeState === query.feeState);
    total = matching.length;
    pageIds = matching.slice(offset, offset + pageSize);
    summaries = all;
  } else {
    const [rows, counted] = await Promise.all([
      db.$queryRaw<{ id: string }[]>`
        SELECT s.id::text AS id FROM students s JOIN programmes p ON p.id = s.programme_id
        ${where} ${order} LIMIT ${pageSize} OFFSET ${offset}`,
      db.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total FROM students s ${where}`,
    ]);
    pageIds = rows.map((row) => row.id);
    total = Number(counted[0]?.total ?? 0);
    summaries = await loadFeeSummaries(pageIds, today);
  }

  const students = await db.student.findMany({
    where: { id: { in: pageIds } },
    include: { programme: { select: PROGRAMME_REF } },
  });
  const byId = new Map(students.map((student) => [student.id, student]));

  const items = pageIds.flatMap((id): StudentListItem[] => {
    const student = byId.get(id);
    if (!student) return []; // deleted between the two queries; nothing is ever hard-deleted, so this is theoretical
    return [
      {
        id: student.id,
        studentNumber: student.studentNumber,
        fullName: student.fullName,
        email: student.email,
        programme: student.programme,
        academicYear: student.academicYear,
        yearOfStudy: student.yearOfStudy,
        status: student.status,
        feeSummary: toFeeSummaryDto(summaries.get(id)!),
      },
    ];
  });

  return { items, page, pageSize, total };
}

// --- Create ---------------------------------------------------------------------------------------------------------

async function findDuplicates(fullName: string, dateOfBirth: DateOnly): Promise<DuplicateMatch[]> {
  // Same date of birth narrows the set to a handful; the name is then compared with the M04 rule, which ignores case,
  // accents and spacing. Students of every status count: a withdrawn student's record should be re-admitted instead.
  const candidates = await db.student.findMany({
    where: { dateOfBirth: dateColumn(dateOfBirth) },
    include: { programme: { select: PROGRAMME_REF } },
    orderBy: { studentNumber: "asc" },
  });
  return candidates
    .filter((candidate) =>
      isProbableDuplicate({ fullName, dateOfBirth }, { fullName: candidate.fullName, dateOfBirth }),
    )
    .map((candidate) => ({
      id: candidate.id,
      studentNumber: candidate.studentNumber,
      fullName: candidate.fullName,
      email: candidate.email,
      dateOfBirth,
      status: candidate.status,
      programme: candidate.programme,
    }));
}

/** Description of a programme-fee charge, e.g. `Tuition 2026-27` or `Tuition 2026-27, instalment 2` (as the seed). */
function tuitionDescription(academicYear: string, instalment: number, instalments: number): string {
  return instalments > 1
    ? `Tuition ${academicYear}, instalment ${instalment}`
    : `Tuition ${academicYear}`;
}

/**
 * Creates a student. In one transaction: the next Student ID for the session, the student, the initial status change
 * (Enrolled, by `actorId`), and one fee charge per instalment of the programme's schedule for that session.
 * Throws `ConflictError` for a taken email and `DuplicateWarning` for the same name and date of birth unless
 * `input.confirmDuplicate` is set.
 */
export async function createStudent(
  input: CreateStudentInput,
  actorId: string,
  clock: Clock = systemClock,
): Promise<StudentResult> {
  assertDateOfBirth(input.dateOfBirth, todayIn(clock()));
  const programme = await findProgramme(input.programmeId);
  assertYearOfStudy(input.yearOfStudy, programme.durationYears);

  const taken = await emailConflict(input.email);
  if (taken) throw taken;

  if (!input.confirmDuplicate) {
    const matches = await findDuplicates(input.fullName, input.dateOfBirth);
    if (matches.length > 0) throw new DuplicateWarning(matches);
  }

  // The Student ID carries the start year of the session the student first enrols in (DB-015).
  const sessionYear = sessionStartYearOf(input.academicYear)!; // validated by the schema
  let created: { id: string; noSchedule: boolean };
  try {
    created = await db.$transaction(async (tx) => {
      const studentNumber = await nextStudentNumber(tx, sessionYear);
      const student = await tx.student.create({
        data: {
          studentNumber,
          fullName: input.fullName,
          email: input.email,
          dateOfBirth: dateColumn(input.dateOfBirth),
          programmeId: input.programmeId,
          academicYear: input.academicYear,
          yearOfStudy: input.yearOfStudy,
          status: "ENROLLED",
          statusChanges: {
            create: { fromStatus: null, toStatus: "ENROLLED", reason: null, changedById: actorId },
          },
        },
        select: { id: true },
      });

      const schedule = await tx.programmeFee.findMany({
        where: { programmeId: input.programmeId, academicYear: input.academicYear },
        orderBy: { instalment: "asc" },
      });
      if (schedule.length > 0) {
        await tx.feeCharge.createMany({
          data: schedule.map((fee) => ({
            studentId: student.id,
            programmeFeeId: fee.id,
            kind: "PROGRAMME_FEE" as const,
            academicYear: input.academicYear,
            description: tuitionDescription(input.academicYear, fee.instalment, schedule.length),
            amount: fee.amount,
            dueDate: fee.dueDate,
          })),
        });
      }
      return { id: student.id, noSchedule: schedule.length === 0 };
    });
  } catch (error) {
    // Two people saving the same email at once both pass the check above; the unique index decides.
    if (isUniqueViolation(error, "email")) {
      const clash = await emailConflict(input.email);
      if (clash) throw clash;
    }
    throw error;
  }

  const warnings: ServiceWarning[] = created.noSchedule
    ? [
        {
          code: "NO_FEE_SCHEDULE",
          message: `${programme.name} has no fee schedule for ${input.academicYear}, so no fee charges were created. Add the schedule and a charge manually.`,
        },
      ]
    : [];
  return { student: await loadRecord(created.id, clock), warnings };
}

// --- Read -----------------------------------------------------------------------------------------------------------

export async function getStudent(id: string, clock: Clock = systemClock): Promise<StudentRecord> {
  return loadRecord(id, clock);
}

// --- Update ---------------------------------------------------------------------------------------------------------

/**
 * Edits profile fields. The caller must send the `version` it read (DB-016); a stale one throws
 * `VersionConflictError`. Changing the programme never touches existing fee charges (edge-cases.md): the result carries
 * a warning saying so. Nothing is written, and the version does not move, when no field actually changes.
 */
export async function updateStudent(
  id: string,
  input: UpdateStudentInput,
  clock: Clock = systemClock,
): Promise<StudentResult> {
  assertKnownId(id);
  const current = await db.student.findUnique({ where: { id }, include: WITH_PROGRAMME });
  if (!current) throw new NotFoundError("Student not found.");
  if (current.version !== input.version) throw new VersionConflictError(current.version);

  if (input.dateOfBirth !== undefined) assertDateOfBirth(input.dateOfBirth, todayIn(clock()));

  const programmeChanged =
    input.programmeId !== undefined && input.programmeId !== current.programmeId;
  const programme = programmeChanged ? await findProgramme(input.programmeId!) : current.programme;
  const yearOfStudy = input.yearOfStudy ?? current.yearOfStudy;
  if (programmeChanged || input.yearOfStudy !== undefined) {
    assertYearOfStudy(yearOfStudy, programme.durationYears);
  }

  const data: Prisma.StudentUncheckedUpdateManyInput = {};
  if (input.fullName !== undefined && input.fullName !== current.fullName)
    data.fullName = input.fullName;
  if (input.email !== undefined && input.email !== current.email) {
    const taken = await emailConflict(input.email, id);
    if (taken) throw taken;
    data.email = input.email;
  }
  if (input.dateOfBirth !== undefined && input.dateOfBirth !== toDateOnly(current.dateOfBirth)) {
    data.dateOfBirth = dateColumn(input.dateOfBirth);
  }
  if (programmeChanged) data.programmeId = input.programmeId;
  if (input.academicYear !== undefined && input.academicYear !== current.academicYear) {
    data.academicYear = input.academicYear;
  }
  if (input.yearOfStudy !== undefined && input.yearOfStudy !== current.yearOfStudy) {
    data.yearOfStudy = input.yearOfStudy;
  }

  if (Object.keys(data).length === 0) {
    return { student: await loadRecord(id, clock), warnings: [] };
  }

  let updated: { count: number };
  try {
    updated = await db.student.updateMany({
      where: { id, version: input.version },
      data: { ...data, version: { increment: 1 } },
    });
  } catch (error) {
    if (isUniqueViolation(error, "email") && input.email) {
      const clash = await emailConflict(input.email, id);
      if (clash) throw clash;
    }
    throw error;
  }
  if (updated.count === 0) await throwStale(id);

  const warnings: ServiceWarning[] = programmeChanged
    ? [
        {
          code: "PROGRAMME_CHANGED",
          message:
            "The programme was changed. Existing fee charges were not changed; add an adjustment or waiver if the fees differ.",
        },
      ]
    : [];
  return { student: await loadRecord(id, clock), warnings };
}

/** The conditional update matched nothing: someone else saved first (or, theoretically, the row is gone). */
async function throwStale(id: string): Promise<never> {
  const now = await db.student.findUnique({ where: { id }, select: { version: true } });
  if (!now) throw new NotFoundError("Student not found.");
  throw new VersionConflictError(now.version);
}

// --- Status ---------------------------------------------------------------------------------------------------------

const STATUS_LABEL: Record<EnrolmentStatus, string> = {
  ENROLLED: "Enrolled",
  DEFERRED: "Deferred",
  WITHDRAWN: "Withdrawn",
  COMPLETED: "Completed",
};

/**
 * Moves a student to a new status if the matrix allows it (api.md "Status transitions"): a refused transition is a
 * 422 `BUSINESS_RULE`, a missing reason where one is required is a 400 on `reason`, and a stale `version` is a 409.
 * The status, the bumped version and the STATUS_CHANGE row are written together.
 */
export async function changeStatus(
  id: string,
  input: ChangeStatusInput,
  actorId: string,
  clock: Clock = systemClock,
): Promise<StudentResult> {
  assertKnownId(id);
  const reason = input.reason?.trim() || null;

  await db.$transaction(async (tx) => {
    const current = await tx.student.findUnique({
      where: { id },
      select: { status: true, version: true },
    });
    if (!current) throw new NotFoundError("Student not found.");
    if (current.version !== input.version) throw new VersionConflictError(current.version);

    const check = checkTransition(current.status, input.toStatus, reason);
    if (!check.ok) {
      if (check.code === "REASON_REQUIRED") {
        throw ValidationError.field(
          "reason",
          `Enter a reason to move a student from ${STATUS_LABEL[current.status]} to ${STATUS_LABEL[input.toStatus]}.`,
        );
      }
      throw new BusinessRuleError(
        "STATUS_TRANSITION",
        check.code === "NO_CHANGE"
          ? `The student is already ${STATUS_LABEL[current.status]}.`
          : `A ${STATUS_LABEL[current.status]} student cannot be changed to ${STATUS_LABEL[input.toStatus]}.`,
        { from: current.status, to: input.toStatus },
      );
    }

    const updated = await tx.student.updateMany({
      where: { id, version: input.version },
      data: { status: input.toStatus, version: { increment: 1 } },
    });
    if (updated.count === 0) {
      const now = await tx.student.findUnique({ where: { id }, select: { version: true } });
      throw new VersionConflictError(now?.version ?? input.version + 1);
    }
    await tx.statusChange.create({
      data: {
        studentId: id,
        fromStatus: current.status,
        toStatus: input.toStatus,
        reason,
        changedById: actorId,
      },
    });
  });

  return { student: await loadRecord(id, clock), warnings: [] };
}

// --- Form options ---------------------------------------------------------------------------------------------------

export interface ProgrammeOption extends ProgrammeRef {
  durationYears: number;
}

/** Programmes for the form and filter selects. */
export async function listProgrammeOptions(): Promise<ProgrammeOption[]> {
  return db.programme.findMany({
    orderBy: [{ name: "asc" }],
    select: { ...PROGRAMME_REF, durationYears: true },
  });
}

/**
 * Sessions to offer in selects, newest first: every session that has a fee schedule or a student, plus the current
 * one (so a registry with an empty database can still enrol into it).
 */
export async function listAcademicYears(clock: Clock = systemClock): Promise<string[]> {
  const rows = await db.$queryRaw<{ academic_year: string }[]>`
    SELECT academic_year FROM programme_fees UNION SELECT academic_year FROM students`;
  return [...new Set([sessionFor(clock()), ...rows.map((row) => row.academic_year)])]
    .sort()
    .reverse();
}
