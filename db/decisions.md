# Database decisions

Schema-level decisions, numbered `DB-NNN`. Project-wide decisions stay in [../docs/decisions.md](../docs/decisions.md).
Use the same template as there. DB-009 to DB-014 were proposed by Claude and accepted on 2026-10-12 when the user
delegated the remaining open choices.

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

- Status: Accepted
- Decision: `STUDENT.academicYear` stores the session (`2026-27`) and `yearOfStudy` stores 1, 2, 3.
- Why: The brief's single "academic year" field is ambiguous, and Registry teams use both.

## DB-010: Release status on each mark

- Status: Accepted
- Decision: `MARK.releaseStatus` is `DRAFT`, `PUBLISHED` or `WITHHELD` (with `withheldReason`), plus bulk actions
  "publish all for this student" and "publish all for this assessment".
- Why: A single per-student flag would expose marks entered after publishing. Per-mark status still supports
  publishing per student.
- Alternatives: One published flag per student.

## DB-011: Fees support instalments

- Status: Accepted
- Decision: A student can have several `FEE_CHARGE` rows per year, each with its own due date. Seed data mostly uses
  one charge per year, except BSc CSE which is billed in two instalments.
- Why: Costs nothing in the schema and matches how fees are often paid; overdue is judged per due date.

## DB-012: Warn, don't block, when publishing results for students with overdue fees

- Status: Accepted
- Decision: Publishing for a student with an overdue balance shows a warning; staff can choose Withhold with reason
  "Outstanding fees".
- Alternatives: Automatic withholding (too rigid); ignoring fees (misses a real Registry practice).

## DB-013: Modules shared between programmes

- Status: Accepted
- Decision: Many-to-many via `PROGRAMME_MODULE`.
- Alternatives: Each module belongs to one programme (simpler, less realistic).

## DB-014: Per-student deadline extensions

- Status: Accepted — stretch goal (Could)
- Decision: `EXTENSION (assessmentId, studentId, newDeadline, reason)`, used to compute the effective deadline.
- Why: Extensions on medical or personal grounds are routine; build only if time allows.

## DB-015: Student ID year = start year of the student's first session

- Status: Accepted
- Date: 2026-10-12
- Decision: `SMS-<year>-<seq>` uses the start year of the academic session the student first enrols in. A student
  enrolling in January 2027 into session 2026-27 gets `SMS-2026-…`. Sessions start in July (Bangladesh academic
  calendar), so the session for a date is `month >= 7 ? year : year - 1`.
- Why: Registries number cohorts by intake session, not by the day the record was typed in.

## DB-016: Optimistic locking with a `version` column

- Status: Accepted
- Date: 2026-10-12
- Decision: `STUDENT`, `ASSESSMENT` and `MARK` carry an integer `version`. Updates send the version they read; the
  update matches `WHERE id = ? AND version = ?` and increments it. No match → `409 CONFLICT`.
- Why: Two staff editing the same record must not silently overwrite each other (edge-cases.md, cross-cutting).

## DB-017: `PENDING_UPLOAD` table for the upload flow

- Status: Accepted
- Date: 2026-10-12
- Decision: Issuing an upload URL creates a `PENDING_UPLOAD` row (server-chosen key, 15-minute expiry). Confirm
  validates and marks it confirmed, so a repeated confirm is idempotent. A cleanup script deletes expired,
  unconfirmed rows and their objects.
- Why: Makes the three-step upload (D-013) safe against double clicks and abandoned uploads.

## DB-018: Payment methods include bKash and Nagad; fee waivers

- Status: Accepted
- Date: 2026-10-12
- Decision: `PAYMENT.method` is `BANK_TRANSFER`, `CASH`, `BKASH`, `NAGAD` or `CARD`. `FEE_CHARGE.kind` is
  `PROGRAMME_FEE`, `ADJUSTMENT` or `WAIVER`; a waiver has a negative amount (e.g. a merit scholarship).
  `PROGRAMME_FEE` gains an `instalment` number so a session can be billed in parts.
- Why: Mobile financial services and tuition waivers are everyday realities for a Bangladeshi registry.

## DB-019: Marks — one decimal place, round before classifying, explicit non-submission

- Status: Accepted
- Date: 2026-10-12
- Decision: Marks are 0–100 with at most one decimal place (`numeric(4,1)`). Classification uses the mark rounded
  half-up to a whole number, so 39.5 → 40 → Pass and 69.4 → 69 → Merit. The stored and displayed mark is never
  changed. A non-submission is `isNonSubmission = true` with `mark = null`, classified as Fail and shown as "NS".
- Why: Rounding before classification is standard practice and avoids arguments over half marks. An explicit NS is
  clearer than a silent 0.

## DB-020: Mark history covers release changes too

- Status: Accepted
- Date: 2026-10-12
- Decision: `MARK_CHANGE.change` records `MARK`, `PUBLISH`, `WITHHOLD` and `UNPUBLISH` events, each with who and
  when; a reason is required for changing a published mark, withholding and unpublishing.
- Why: One audit trail feeds the student activity timeline and answers "who released this result and when".
