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

## DB-021: Name search goes through `immutable_unaccent(lower(full_name))`

- Status: Accepted
- Date: 2026-10-12
- Decision: The init migration defines an IMMUTABLE wrapper `immutable_unaccent(text)` and a GIN trigram index on
  `immutable_unaccent(lower(full_name))`. Services must search with exactly that expression (e.g.
  `immutable_unaccent(lower(full_name)) LIKE immutable_unaccent(lower($1))` or trigram similarity) so the index is
  used.
- Why: Accent- and case-insensitive search (edge-cases.md) that stays fast as the student list grows.

## DB-022: Schema details settled in M03

- Status: Accepted
- Date: 2026-10-12
- Decision:
  - Prisma 7.10 (stable). Prisma 8 is still a release candidate; revisit when it is stable.
  - Naming: PascalCase models / camelCase fields mapped to plural snake_case tables and snake_case columns.
  - Nullable columns: `StatusChange.fromStatus` and `reason`; `Assessment.closedAt`; `Payment.voidedAt` and
    `voidReason`; `Mark.mark`, `withheldReason`, `publishedAt`; `MarkChange.oldMark`, `newMark`, `reason`;
    `PendingUpload.confirmedAt`; `FeeCharge.programmeFeeId`. Everything else is NOT NULL. "Reason required" rules
    are enforced in services (DB-020), not by the database.
  - `ADJUSTMENT` charges must be positive; anything that reduces what a student owes is a `WAIVER`.
  - Resets: Prisma 7 refuses `prisma migrate reset` when an AI agent runs it, and that guard is respected. Test
    harnesses and `db:reset` drop and recreate the schema themselves, guarded to `_test` databases or local hosts,
    then run `prisma migrate deploy`.
- Why: Recorded from the M03 report during the overnight review (D-025).

## DB-023: Seed interpretations and mark-history scope (M07)

- Status: Accepted
- Date: 2026-10-12
- Decision (accepted from the M07 report during the overnight review, D-025):
  - Completed students' marks are published, including on A2; every other A2 mark is draft.
  - Tanvir's withheld result is on A3 only, so exactly two marks are withheld in the demo (fees; misconduct).
  - Arif owes 2,00,000: the unpaid 40,000 from session S-1 (which sets the 60+ age) plus the unpaid current
    instalment 1. Habib's `academicYear` stays at S-1, the session he left in.
  - `MARK_CHANGE` rows are written for changes to an existing mark and for publish, withhold and unpublish events —
    **not** for the first entry of a mark. M14 follows the same rule.
  - `db:seed` and `db:reset` refuse non-local database **or storage** targets unless `--force`. The seed prints a
    content fingerprint; two resets on the same day must match.
  - One seeded file keeps a Bengali name ("পোর্টফোলিও.pdf") to demonstrate non-ASCII downloads.

## DB-024: Fee audit columns and reusable voided references (M10 review)

- Status: Accepted
- Date: 2026-10-12
- Decision:
  - `payments.voided_by_id` (staff) is set whenever a payment is voided; a CHECK keeps `voided_at` and
    `voided_by_id` both null or both set. `fee_charges.created_by_id` (staff) records who added a charge,
    adjustment or waiver (automatic programme-fee charges record the staff member who enrolled the student).
  - Payment references are unique only among **non-voided** payments (partial unique index on the normalised
    reference). A mistaken payment can be voided and re-recorded with the same bank reference.
  - References are normalised: trimmed, inner spaces collapsed, upper-cased.
  - Removing a fee-schedule instalment that students were already billed for is refused
    (`FEE_INSTALMENT_IN_USE`); its amount and due date can still be edited, because charges keep their own copy.
- Implementation: migration `20261012120000_fee_audit_columns`. The partial unique index is declared in
  `schema.prisma` via `@@unique(..., where: raw("voided_at IS NULL"))`, which needs Prisma's **`partialIndexes`
  preview feature** (enabled in the generator). Revisit when it becomes stable or if a Prisma upgrade drops it.
- Why: Every financial action needs a who-and-when (DB-005) for the activity timeline, and real bank references
  repeat when a mistaken entry is corrected. Decided by Claude during the overnight review (D-025).

## DB-025: Pending uploads keep the declared file details (M13)

- Status: Accepted
- Date: 2026-10-12
- Decision: Migration `20261012180000_pending_upload_details` adds `original_name`, `mime_type` and `size_bytes`
  to `pending_uploads` (existing throw-away rows are deleted first). The confirm step receives only the pending id,
  so it needs the declared name (copied to `SUBMISSION_FILE`), type and size (re-checked against the stored
  object). Rejected uploads (bad content, expired, rule failure at confirm) delete both the object and the pending
  row; rejections are not stored.
- Why: Recorded from the M13 pull request during the overnight review (D-025).

## DB-026: Index on submissions.last_submitted_at (M17)

- Status: Accepted
- Date: 2026-10-12
- Decision: Migration `20261012200000_submission_last_submitted_index` indexes `submissions.last_submitted_at` for
  the dashboard's 14-day late-submission window. A query-count test proves 11 services issue the same number of
  statements for 3 and 30 students.

## DB-027: Submission file versions and final keys (M18R)

- Status: Accepted
- Date: 2026-10-13
- Decision: Migration `20261013090000_confirmed_file_keys_and_versions`:
  - `submission_files.version` (1, 2, 3… per submission; unique with `submission_id`; backfilled by `uploaded_at`,
    `id`). Versions are ordered by it; `uploaded_at` is always the real arrival time (no more 1 ms nudge) and
    `last_submitted_at` is the newest version's arrival time.
  - `pending_uploads.final_object_key` (unique): each confirm attempt copies to its own random final key, so racing
    confirms can't overwrite each other's copy, and a repeated confirm can find its receipt. Already-confirmed rows
    were backfilled with `final_object_key = object_key`; unconfirmed pending rows were deleted (DB-025 precedent).
- Why: Fixes review findings #1, #2 and #4 (D-042, D-043).
