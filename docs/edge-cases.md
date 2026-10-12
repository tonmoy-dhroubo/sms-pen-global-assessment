# Edge cases and extras

Edge cases and stand-out extras to handle during the build. Tick items off as they are implemented and tested.
"Feature intuition" (handling cases the brief did not name) is 30% of the grade, so this list matters.

**Priority:** **M** = Must, **S** = Should (cheap stand-outs), **C** = Could (if time allows).
Split accepted (D-024). Each item is built in the milestone named in [milestones.md](milestones.md).

## Enrolment

- [x] **M** — Probable duplicate student (same name + date of birth, different email): warn before creating; allow override.
- [x] **M** — Date of birth in the future or an implausible age: validation error (age 16–100).
- [x] **M** — Status transitions follow an allowed matrix:
  - Completed is final.
  - Withdrawn → Enrolled only as a re-admission, with a reason.
  - Deferred and Withdrawn always require a reason.
  - Every change is written to `STATUS_CHANGE`.
- [x] **M** — Programme change mid-year: existing fee charges are untouched; staff add an adjustment charge. No silent
  recalculation.
- [x] **M** — Search matches partial IDs (`0007`), names regardless of case or accents, and email.
- [x] **M** — Withdrawn and Completed students are hidden from lists by default, behind a filter chip.

## Fees and payments

- [x] **M** — Overpayment: balance shows as a credit, not a negative number.
- [x] **M** — Duplicate payment reference: clear error linking to the existing payment (also stops double-click duplicates).
- [x] **M** — Payment larger than the outstanding balance: warning, allowed.
- [x] **M** — Payment dated in the future: blocked. Backdated payments: allowed.
- [x] **M** — Mistaken payment: voided with a reason, never edited or deleted; shown struck through.
- [x] **M** — Withdrawn student who still owes money stays on the overdue list.
- [x] **M** — Outstanding but not yet due is shown differently from overdue.
- [x] **S** — Debt ageing on the dashboard: overdue split into 1–30, 31–60 and 60+ days.

## Submissions

- [x] **M** — Upload started before the deadline but finished after it: submission time is when the file arrives
  (D-023), and students are told this next to the upload button.
- [x] **M** — Only server time counts; deadlines show their time zone and a countdown.
- [x] **M** — Deadline changed after submissions: late flags recalculate automatically (derived, not stored).
- [x] **M** — File checks: PDF/DOCX verified by content, not just extension; empty files rejected; macro-enabled
  `.docm` rejected; size limit enforced.
- [x] **M** — Double-click submit: unique constraint plus an idempotent confirm step.
- [x] **M** — On-time submission cannot be replaced after the deadline; a first submission after the deadline is
  accepted and flagged late.
- [x] **M** — Closed assessment (`closedAt` set): no uploads at all.
- [x] **M** — Withdrawn or deferred students, and students whose programme does not include the module, cannot
  submit; the UI explains why.
- [x] **M** — Abandoned uploads (upload URL issued, never confirmed): cleanup script deletes stray objects.
- [x] **S** — Submission receipt: time, file name, size and SHA-256 fingerprint, to settle "I submitted on time" disputes.

## Marks and results

- [x] **M** — Mark must be 0–100 with at most one decimal; classification rounds half-up first (DB-019), covered by
  tests at 39.4 / 39.5 / 40 / 59.4 / 59.5 / 60 / 69.4 / 69.5 / 70.
- [x] **M** — Work never submitted: explicit non-submission (NS), not a silent 0.
- [x] **M** — Late flag visible to staff while marking; no automatic penalty.
- [x] **M** — Changing a published mark requires a reason; recorded in `MARK_CHANGE`.
- [x] **M** — Un-publishing a result is allowed, with a reason.
- [x] **M** — Students see withheld or unpublished results as "Not yet available" — no mark, no reason.
- [x] **M** — Publishing for a student with overdue fees shows a warning (DB-012).
- [x] **S** — Bulk publish preview: "Publish 18 marks — 2 students have overdue fees, 3 marks missing" before confirming.

## Cross-cutting

- [ ] **M** — Access control test: a student cannot read another student's data by changing an ID in the URL or API call.
- [ ] **M** — Two staff editing the same record: the second save gets a "changed, reload" conflict, not a silent overwrite.
- [ ] **M** — Empty states, loading states, and keyboard-accessible forms with labels.

## Extras

- [ ] **S** — Seed data built around these edge cases, plus a "demo tour" section in the README telling graders where
  to see each one. Highest return on effort.
- [ ] **S** — Activity timeline on each student record: status changes, payments, published marks.
- [ ] **S** — GitHub Actions CI: lint, type-check, tests, `prisma validate`.
- [ ] **C** — CSV export of the overdue list and marksheet.
- [ ] **C** — Playwright end-to-end test of one complete flow.
- [ ] **C** — Printable fee statement and marksheet (print stylesheet).
- [ ] **C** — Per-student deadline extensions (DB-014).

## Resolved questions

1. Priority split — accepted as proposed (D-024).
2. Late uploads — submission time is when the file arrives (D-023).
3. Decimal marks — one decimal allowed; round half-up before classifying (DB-019).
