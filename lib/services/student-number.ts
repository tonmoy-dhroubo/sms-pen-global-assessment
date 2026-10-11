import type { Prisma } from "@/lib/generated/prisma/client";
import { formatStudentNumber, studentNumberYear } from "@/lib/services/rules/student-number";

// The transactional allocator behind Student IDs (DB-004, DB-015). The pure formatting lives in
// `rules/student-number.ts`; this file is the only place that touches the sequence table.
//
// It always runs inside the caller's transaction, in the same transaction that inserts the student:
//   - concurrent creations queue on the sequence row's lock, so they get 1, 2, 3 ... with no duplicates;
//   - if the student insert fails and the transaction rolls back, the increment rolls back too, so no number is
//     skipped (gap-free). The unique constraint on `students.student_number` remains the final safety net.
// It imports only a type from the generated client, so scripts (the seed) can use it without `lib/db`.

/** The part of a Prisma transaction client the allocator needs. */
export type SequenceClient = Pick<Prisma.TransactionClient, "$queryRaw">;

/**
 * Takes the next number for `year` (the start year of the student's first session): creates the year's row on first
 * use, otherwise increments it. One atomic statement, so two transactions can never read the same value.
 */
export async function nextStudentNumber(tx: SequenceClient, year: number): Promise<string> {
  const rows = await tx.$queryRaw<{ last_value: number }[]>`
    INSERT INTO "student_id_sequences" ("year", "last_value")
    VALUES (${year}, 1)
    ON CONFLICT ("year") DO UPDATE SET "last_value" = "student_id_sequences"."last_value" + 1
    RETURNING "last_value"`;
  const row = rows[0];
  if (!row) throw new Error(`Student ID sequence for ${year} returned no row`);
  return formatStudentNumber(year, row.last_value);
}

/**
 * Allocates the number for a student first enrolling at `enrolmentDate`: `SMS-<start year of that session>-<seq>`
 * (enrolling in January 2027 into session 2026-27 gives `SMS-2026-...`).
 */
export async function allocateStudentNumber(
  tx: SequenceClient,
  enrolmentDate: Date,
): Promise<string> {
  return nextStudentNumber(tx, studentNumberYear(enrolmentDate));
}
