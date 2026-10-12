import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/lib/generated/prisma/client";

// Proves the database-level rules that Prisma cannot express (check constraints, unique keys, restrict-on-delete,
// the extensions and the name-search index). Every write goes through the same Prisma client the app uses.

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is not set (see .env.example).");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

/** Builds the minimum graph the constraints hang off. */
async function baseData() {
  const staff = await prisma.staff.create({
    data: { fullName: "Rafiq Hasan", email: "rafiq@sms.test", jobTitle: "Registry Officer" },
  });
  const programme = await prisma.programme.create({
    data: { code: "BSC-CSE", name: "BSc Computer Science", durationYears: 4 },
  });
  const module_ = await prisma.module.create({ data: { code: "CSE101", title: "Programming 1" } });
  const student = await prisma.student.create({
    data: {
      studentNumber: "SMS-2026-0001",
      fullName: "José Álvarez",
      email: "jose@sms.test",
      dateOfBirth: new Date("2005-03-14"),
      programmeId: programme.id,
      academicYear: "2026-27",
      yearOfStudy: 1,
    },
  });
  const assessment = await prisma.assessment.create({
    data: {
      moduleId: module_.id,
      title: "Coursework 1",
      deadline: new Date("2026-12-01T10:00:00Z"),
      createdById: staff.id,
    },
  });
  return { staff, programme, module: module_, student, assessment };
}

type Base = Awaited<ReturnType<typeof baseData>>;
let base: Base;

// The harness (tests/support/setup.ts) empties every table before each test, ahead of this hook.
beforeEach(async () => {
  base = await baseData();
});
afterAll(async () => {
  await prisma.$disconnect();
});

const markData = (overrides: Partial<{ mark: number | null; isNonSubmission: boolean }> = {}) => ({
  assessmentId: base.assessment.id,
  studentId: base.student.id,
  enteredById: base.staff.id,
  mark: 65.5,
  isNonSubmission: false,
  ...overrides,
});

const feeData = (kind: "PROGRAMME_FEE" | "ADJUSTMENT" | "WAIVER", amount: number) => ({
  studentId: base.student.id,
  kind,
  academicYear: "2026-27",
  description: "Test charge",
  amount,
  dueDate: new Date("2026-09-01"),
});

const paymentData = (amount: number, reference = "TXN-1") => ({
  studentId: base.student.id,
  amount,
  method: "BKASH" as const,
  paidAt: new Date("2026-09-02"),
  reference,
  recordedById: base.staff.id,
});

describe("mark check constraints", () => {
  it.each([0, 0.1, 40, 99.9, 100])("accepts a mark of %s", async (mark) => {
    await expect(prisma.mark.create({ data: markData({ mark }) })).resolves.toMatchObject({
      isNonSubmission: false,
    });
  });

  it.each([100.1, 101, 999.9, -0.1, -1])("rejects a mark of %s (outside 0-100)", async (mark) => {
    await expect(prisma.mark.create({ data: markData({ mark }) })).rejects.toThrow(
      /marks_mark_range_check/,
    );
  });

  it("accepts a non-submission with no mark", async () => {
    await expect(
      prisma.mark.create({ data: markData({ mark: null, isNonSubmission: true }) }),
    ).resolves.toBeTruthy();
  });

  it("rejects a non-submission that still has a mark", async () => {
    await expect(
      prisma.mark.create({ data: markData({ mark: 0, isNonSubmission: true }) }),
    ).rejects.toThrow(/marks_non_submission_check/);
  });

  it("rejects a normal mark row with no mark", async () => {
    await expect(
      prisma.mark.create({ data: markData({ mark: null, isNonSubmission: false }) }),
    ).rejects.toThrow(/marks_non_submission_check/);
  });

  it("rejects updating a stored mark out of range", async () => {
    const row = await prisma.mark.create({ data: markData() });
    await expect(prisma.mark.update({ where: { id: row.id }, data: { mark: 101 } })).rejects.toThrow(
      /marks_mark_range_check/,
    );
  });
});

describe("payment amount check constraint", () => {
  it("accepts a positive amount", async () => {
    await expect(prisma.payment.create({ data: paymentData(0.01) })).resolves.toBeTruthy();
  });

  it.each([0, -0.01, -500])("rejects an amount of %s", async (amount) => {
    await expect(prisma.payment.create({ data: paymentData(amount) })).rejects.toThrow(
      /payments_amount_positive_check/,
    );
  });
});

describe("fee charge amount sign check constraint", () => {
  it.each([
    ["PROGRAMME_FEE", 125000],
    ["ADJUSTMENT", 500],
    ["WAIVER", -25000],
  ] as const)("accepts %s of %s", async (kind, amount) => {
    await expect(prisma.feeCharge.create({ data: feeData(kind, amount) })).resolves.toBeTruthy();
  });

  it.each([
    ["WAIVER", 25000],
    ["WAIVER", 0],
    ["PROGRAMME_FEE", -1],
    ["PROGRAMME_FEE", 0],
    ["ADJUSTMENT", -500],
    ["ADJUSTMENT", 0],
  ] as const)("rejects %s of %s", async (kind, amount) => {
    await expect(prisma.feeCharge.create({ data: feeData(kind, amount) })).rejects.toThrow(
      /fee_charges_amount_sign_check/,
    );
  });
});

describe("unique constraints", () => {
  it("rejects a duplicate payment reference", async () => {
    await prisma.payment.create({ data: paymentData(100, "DUP") });
    await expect(prisma.payment.create({ data: paymentData(200, "DUP") })).rejects.toThrow(
      /Unique constraint/i,
    );
  });

  it("allows only one mark per assessment and student", async () => {
    await prisma.mark.create({ data: markData() });
    await expect(prisma.mark.create({ data: markData({ mark: 70 }) })).rejects.toThrow(
      /Unique constraint/i,
    );
  });

  it("allows only one submission per assessment and student", async () => {
    const data = {
      assessmentId: base.assessment.id,
      studentId: base.student.id,
      firstSubmittedAt: new Date(),
      lastSubmittedAt: new Date(),
    };
    await prisma.submission.create({ data });
    await expect(prisma.submission.create({ data })).rejects.toThrow(/Unique constraint/i);
  });

  it("allows only one fee line per programme, session and instalment", async () => {
    const data = {
      programmeId: base.programme.id,
      academicYear: "2026-27",
      instalment: 1,
      amount: 100000,
      dueDate: new Date("2026-09-01"),
    };
    await prisma.programmeFee.create({ data });
    await expect(prisma.programmeFee.create({ data })).rejects.toThrow(/Unique constraint/i);
    await expect(
      prisma.programmeFee.create({ data: { ...data, instalment: 2 } }),
    ).resolves.toBeTruthy();
  });

  it("keeps student numbers and emails unique", async () => {
    const data = {
      studentNumber: "SMS-2026-0002",
      fullName: "Another Student",
      email: "another@sms.test",
      dateOfBirth: new Date("2004-01-01"),
      programmeId: base.programme.id,
      academicYear: "2026-27",
      yearOfStudy: 1,
    };
    await expect(
      prisma.student.create({ data: { ...data, studentNumber: base.student.studentNumber } }),
    ).rejects.toThrow(/Unique constraint/i);
    await expect(
      prisma.student.create({ data: { ...data, email: base.student.email } }),
    ).rejects.toThrow(/Unique constraint/i);
  });
});

describe("column types and defaults", () => {
  it("round-trips money exactly and defaults ids, versions and status in the database", async () => {
    const payment = await prisma.payment.create({ data: paymentData(1234567.89) });
    expect(payment.amount.toString()).toBe("1234567.89");
    expect(base.student.version).toBe(1);
    expect(base.assessment.version).toBe(1);
    expect(base.student.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(base.student.status).toBe("ENROLLED");
  });

  it("stores marks with one decimal place", async () => {
    const row = await prisma.mark.create({ data: markData({ mark: 69.45 }) });
    expect(row.mark?.toString()).toBe("69.5");
  });
});

describe("delete rules (DB-005)", () => {
  it("refuses to delete a student who has payments", async () => {
    await prisma.payment.create({ data: paymentData(100) });
    await expect(prisma.student.delete({ where: { id: base.student.id } })).rejects.toThrow(
      /foreign key/i,
    );
  });

  it("refuses to delete a student who has marks", async () => {
    await prisma.mark.create({ data: markData() });
    await expect(prisma.student.delete({ where: { id: base.student.id } })).rejects.toThrow(
      /foreign key/i,
    );
  });

  it("refuses two files with the same version in one submission", async () => {
    const file = (objectKey: string) => ({
      version: 1,
      objectKey,
      originalName: "essay.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      sha256: "0".repeat(64),
      uploadedAt: new Date(),
    });
    const submission = await prisma.submission.create({
      data: {
        assessmentId: base.assessment.id,
        studentId: base.student.id,
        firstSubmittedAt: new Date(),
        lastSubmittedAt: new Date(),
        files: { create: file("submissions/a/b/one.pdf") },
      },
    });
    await expect(
      prisma.submissionFile.create({
        data: { submissionId: submission.id, ...file("submissions/a/b/two.pdf") },
      }),
    ).rejects.toThrow(/unique/i);
    // Only the first one was stored.
    expect(
      await prisma.submissionFile.count({ where: { submissionId: submission.id, version: 1 } }),
    ).toBe(1);
  });

  it("refuses to delete a submission that has files", async () => {
    const submission = await prisma.submission.create({
      data: {
        assessmentId: base.assessment.id,
        studentId: base.student.id,
        firstSubmittedAt: new Date(),
        lastSubmittedAt: new Date(),
        files: {
          create: {
            version: 1,
            objectKey: "submissions/a/b/c.pdf",
            originalName: "essay.pdf",
            mimeType: "application/pdf",
            sizeBytes: 1024,
            sha256: "0".repeat(64),
            uploadedAt: new Date(),
          },
        },
      },
    });
    await expect(prisma.submission.delete({ where: { id: submission.id } })).rejects.toThrow(
      /foreign key/i,
    );
  });

  it("cascades the programme-module link only", async () => {
    await prisma.programmeModule.create({
      data: { programmeId: base.programme.id, moduleId: base.module.id },
    });
    // The module is still referenced by an assessment (Restrict); the link row alone cascades.
    await expect(prisma.module.delete({ where: { id: base.module.id } })).rejects.toThrow(
      /foreign key/i,
    );
    const spare = await prisma.module.create({ data: { code: "CSE999", title: "Spare" } });
    await prisma.programmeModule.create({
      data: { programmeId: base.programme.id, moduleId: spare.id },
    });
    await prisma.module.delete({ where: { id: spare.id } });
    expect(await prisma.programmeModule.count({ where: { moduleId: spare.id } })).toBe(0);
  });
});

describe("name search (unaccent + pg_trgm)", () => {
  it("has the extensions and the IMMUTABLE wrapper installed", async () => {
    const ext = await prisma.$queryRaw<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname IN ('unaccent', 'pg_trgm') ORDER BY extname`;
    expect(ext.map((e) => e.extname)).toEqual(["pg_trgm", "unaccent"]);
    const fn = await prisma.$queryRaw<{ provolatile: string }[]>`
      SELECT provolatile::text AS provolatile FROM pg_proc WHERE proname = 'immutable_unaccent'`;
    expect(fn[0]?.provolatile).toBe("i");
  });

  it("finds accented names from unaccented, lower-case input", async () => {
    const rows = await prisma.$queryRaw<{ full_name: string }[]>`
      SELECT full_name FROM students
      WHERE immutable_unaccent(lower(full_name)) LIKE ${"%jose alvarez%"}`;
    expect(rows.map((r) => r.full_name)).toEqual(["José Álvarez"]);
  });

  it("matches near spellings with trigram similarity", async () => {
    const rows = await prisma.$queryRaw<{ full_name: string }[]>`
      SELECT full_name FROM students
      WHERE immutable_unaccent(lower(full_name)) % ${"jose alvares"}`;
    expect(rows).toHaveLength(1);
  });

  it("is served by the GIN trigram index", async () => {
    const plan = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
      return tx.$queryRaw<{ "QUERY PLAN": string }[]>`
        EXPLAIN SELECT id FROM students
        WHERE immutable_unaccent(lower(full_name)) LIKE ${"%alvarez%"}`;
    });
    expect(plan.map((p) => p["QUERY PLAN"]).join("\n")).toContain("students_full_name_search_idx");
  });
});
