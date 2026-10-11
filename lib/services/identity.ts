import { Prisma } from "@/lib/generated/prisma/client";
import { db } from "@/lib/db";
import type { EnrolmentStatus } from "@/lib/services/rules/types";

// Who can be "viewing as" whom (D-008, D-020): looking up the seeded staff and the students, and the lists behind
// the header role switcher. There is no login; the record behind a role cookie only has to exist.

export interface StaffProfile {
  id: string;
  fullName: string;
  email: string;
  jobTitle: string;
}

export interface StudentProfile {
  id: string;
  studentNumber: string;
  fullName: string;
  email: string;
  status: EnrolmentStatus;
}

export async function findStaff(id: string): Promise<StaffProfile | null> {
  return db.staff.findUnique({
    where: { id },
    select: { id: true, fullName: true, email: true, jobTitle: true },
  });
}

export async function findStudent(id: string): Promise<StudentProfile | null> {
  return db.student.findUnique({
    where: { id },
    select: { id: true, studentNumber: true, fullName: true, email: true, status: true },
  });
}

export interface SessionOptions {
  staff: Pick<StaffProfile, "id" | "fullName" | "jobTitle">[];
  students: {
    items: Pick<StudentProfile, "id" | "studentNumber" | "fullName" | "status">[];
    /** Students matching `q`, which can be more than `items` (the list is limited). */
    total: number;
  };
}

export const DEFAULT_OPTIONS_LIMIT = 20;
export const MAX_OPTIONS_LIMIT = 50;

// `!` is the LIKE escape character, so a search for "50%" or "a_b" matches those characters literally.
function likePattern(term: string): string {
  return `%${term.replace(/[!%_]/g, (char) => `!${char}`)}%`;
}

interface StudentOptionRow {
  id: string;
  studentNumber: string;
  fullName: string;
  status: EnrolmentStatus;
}

/**
 * Staff (all, by name) and students for the role switcher. `q` matches a student's name regardless of case and
 * accents, using exactly the indexed expression `immutable_unaccent(lower(full_name))` (DB-021), or part of the
 * Student ID. Students are sorted by that same normalised name, then Student ID, and limited.
 */
export async function listSessionOptions(
  q: string | undefined,
  limit: number = DEFAULT_OPTIONS_LIMIT,
): Promise<SessionOptions> {
  const term = q?.trim();
  const pattern = term ? likePattern(term) : null;
  const where = pattern
    ? Prisma.sql`WHERE immutable_unaccent(lower(full_name)) LIKE immutable_unaccent(lower(${pattern})) ESCAPE '!'
        OR student_number ILIKE ${pattern} ESCAPE '!'`
    : Prisma.empty;

  const [staff, items, counted] = await Promise.all([
    db.staff.findMany({
      orderBy: [{ fullName: "asc" }, { email: "asc" }],
      select: { id: true, fullName: true, jobTitle: true },
    }),
    db.$queryRaw<StudentOptionRow[]>`
      SELECT id::text AS id, student_number AS "studentNumber", full_name AS "fullName", status::text AS status
      FROM students
      ${where}
      ORDER BY immutable_unaccent(lower(full_name)), student_number
      LIMIT ${limit}`,
    db.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total FROM students ${where}`,
  ]);

  return { staff, students: { items, total: Number(counted[0]?.total ?? 0) } };
}
