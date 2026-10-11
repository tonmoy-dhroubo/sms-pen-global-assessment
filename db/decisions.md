# Database decisions

Schema-level decisions, numbered `DB-NNN`. Project-wide decisions stay in [../docs/decisions.md](../docs/decisions.md).
Use the same template as there. Entries marked **Proposed** await the user's confirmation.

---

## DB-001: UUID primary keys, separate business keys

- Status: Accepted
- Decision: Every table uses a UUID `id`. Human-facing identifiers (`studentNumber`, programme and module `code`,
  payment `reference`) are separate unique columns.
- Why: Internal IDs never leak meaning or row counts, and business keys can follow Registry formats without
  affecting relations.

## DB-002: Money as `numeric(12,2)`

- Status: Accepted
- Decision: All amounts use Prisma `Decimal` mapped to `numeric(12,2)`. Never `float`. One currency, configured.
- Why: Floating point cannot represent money exactly; rounding errors in balances are unacceptable to a finance team.

## DB-003: Derived values are calculated, never stored

- Status: Accepted
- Decision: Balance, overdue amount, late flag, effective deadline and classification are computed in `lib/services`
  (rules in [README.md](README.md)).
- Why: A stored copy can drift from the rows it summarises. Calculation also makes deadline extensions and voided
  payments take effect immediately.

## DB-004: Student IDs from a per-year sequence table

- Status: Accepted
- Decision: `STUDENT_ID_SEQUENCE (year, lastValue)` is incremented with an upsert inside the same transaction that
  creates the student, producing `SMS-<year>-<4-digit seq>`. The year is the year the record is created.
- Why: `count() + 1` produces duplicates under concurrent inserts and reuses numbers after deletions. A unique
  constraint on `studentNumber` is the final safety net.

## DB-005: Nothing financial or academic is hard-deleted

- Status: Accepted
- Decision: Students are never deleted (status covers leaving). Payments are voided (`voidedAt`, `voidReason`), not
  deleted or edited. Submission files keep every version. Changes to marks are logged in `MARK_CHANGE`.
- Why: Registry and finance records must be auditable, and disputes ("I paid", "I submitted on time") need history.

## DB-006: Dates vs timestamps

- Status: Accepted
- Decision: Calendar dates (`dateOfBirth`, `dueDate`, `paidAt`) use `date`. Moments (`deadline`, `uploadedAt`,
  audit times) use `timestamptz`, stored in UTC and shown in `APP_TIMEZONE`.
- Why: A birthday has no time zone; a deadline does. Mixing them causes off-by-one-day bugs.

## DB-007: Case-insensitive unique email

- Status: Accepted
- Decision: Emails are trimmed and lower-cased before saving, with a unique constraint.
- Why: `Ayesha@Uni.ac.uk` and `ayesha@uni.ac.uk` are the same person; duplicates would split a student's records.

## DB-008: Database files live in `db/`

- Status: Accepted
- Decision: `schema.prisma`, migrations and seed scripts live in `db/`; `prisma.config.ts` points Prisma there.
- Why: Keeps the schema, its diagram and its decisions together in one place.

## DB-009: Academic year = session plus year of study

- Status: **Proposed**
- Decision: `STUDENT.academicYear` stores the session (`2026/27`) and `yearOfStudy` stores 1, 2, 3.
- Why: The brief's single "academic year" field is ambiguous, and Registry teams use both.

## DB-010: Release status on each mark

- Status: **Proposed**
- Decision: `MARK.releaseStatus` is `DRAFT`, `PUBLISHED` or `WITHHELD` (with `withheldReason`), plus bulk actions
  "publish all for this student" and "publish all for this assessment".
- Why: A single per-student flag would expose marks entered after publishing. Per-mark status still supports
  publishing per student.
- Alternatives: One published flag per student.

## DB-011: Fees support instalments

- Status: **Proposed**
- Decision: A student can have several `FEE_CHARGE` rows per year, each with its own due date. Seed data mostly uses
  one charge per year.
- Why: Costs nothing in the schema and matches how fees are often paid; overdue is judged per due date.

## DB-012: Warn, don't block, when publishing results for students with overdue fees

- Status: **Proposed**
- Decision: Publishing for a student with an overdue balance shows a warning; staff can choose Withhold with reason
  "Outstanding fees".
- Alternatives: Automatic withholding (too rigid); ignoring fees (misses a real Registry practice).

## DB-013: Modules shared between programmes

- Status: **Proposed**
- Decision: Many-to-many via `PROGRAMME_MODULE`.
- Alternatives: Each module belongs to one programme (simpler, less realistic).

## DB-014: Per-student deadline extensions

- Status: **Proposed — stretch goal**
- Decision: `EXTENSION (assessmentId, studentId, newDeadline, reason)`, used to compute the effective deadline.
- Why: Extensions on medical or personal grounds are routine; build only if time allows.
