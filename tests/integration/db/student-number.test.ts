import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { parseStudentNumber } from "@/lib/services/rules/student-number";
import { allocateStudentNumber, nextStudentNumber } from "@/lib/services/student-number";
import { createProgramme } from "../../support/factories";

// DB-004 / DB-015: the sequence is incremented inside the transaction that creates the student.

// 12 Oct 2026 and 15 Jan 2027 are both in session 2026-27; 2 Jul 2027 starts session 2027-28.
const OCTOBER_2026 = new Date("2026-10-12T05:00:00Z");
const JANUARY_2027 = new Date("2027-01-15T05:00:00Z");
const JULY_2027 = new Date("2027-07-02T05:00:00Z");

async function createStudent(programmeId: string, n: number, enrolmentDate: Date) {
  return db.$transaction(
    async (tx) => {
      const studentNumber = await allocateStudentNumber(tx, enrolmentDate);
      await tx.student.create({
        data: {
          studentNumber,
          fullName: `Concurrent Student ${n}`,
          email: `concurrent.${n}@student.example.edu`,
          dateOfBirth: new Date("2005-03-14"),
          programmeId,
          academicYear: "2026-27",
          yearOfStudy: 1,
        },
      });
      return studentNumber;
    },
    { maxWait: 20_000, timeout: 30_000 },
  );
}

describe("student number allocator", () => {
  it("gives 20 concurrent creations 20 distinct, gap-free numbers", async () => {
    const programme = await createProgramme();
    const numbers = await Promise.all(
      Array.from({ length: 20 }, (_, i) => createStudent(programme.id, i, OCTOBER_2026)),
    );

    expect(new Set(numbers).size).toBe(20);
    const sequences = numbers.map((n) => parseStudentNumber(n)!.sequence).sort((a, b) => a - b);
    expect(sequences).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(numbers.every((n) => n.startsWith("SMS-2026-"))).toBe(true);

    const stored = await db.student.findMany({ select: { studentNumber: true } });
    expect(stored).toHaveLength(20);
    const sequence = await db.studentIdSequence.findUnique({ where: { year: 2026 } });
    expect(sequence?.lastValue).toBe(20);
  });

  it("numbers by the start year of the session, one sequence per year", async () => {
    const programme = await createProgramme();
    expect(await createStudent(programme.id, 1, OCTOBER_2026)).toBe("SMS-2026-0001");
    // January 2027 belongs to session 2026-27 (DB-015).
    expect(await createStudent(programme.id, 2, JANUARY_2027)).toBe("SMS-2026-0002");
    // A new session starts a new sequence.
    expect(await createStudent(programme.id, 3, JULY_2027)).toBe("SMS-2027-0001");
    expect(await createStudent(programme.id, 4, OCTOBER_2026)).toBe("SMS-2026-0003");
  });

  it("does not skip a number when the student insert fails and the transaction rolls back", async () => {
    const programme = await createProgramme();
    expect(await createStudent(programme.id, 1, OCTOBER_2026)).toBe("SMS-2026-0001");

    await expect(
      db.$transaction(async (tx) => {
        await allocateStudentNumber(tx, OCTOBER_2026); // takes 0002 ...
        throw new Error("student insert failed"); // ... and gives it back
      }),
    ).rejects.toThrow("student insert failed");

    expect(await createStudent(programme.id, 2, OCTOBER_2026)).toBe("SMS-2026-0002");
  });

  it("nextStudentNumber works directly on a year", async () => {
    const numbers = await db.$transaction(async (tx) => [
      await nextStudentNumber(tx, 2031),
      await nextStudentNumber(tx, 2031),
    ]);
    expect(numbers).toEqual(["SMS-2031-0001", "SMS-2031-0002"]);
  });
});
