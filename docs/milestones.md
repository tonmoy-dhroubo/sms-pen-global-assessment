# Milestone tracker

The build plan. The `coder` agent works through it **one milestone at a time** (D-021) and stops to report after
each. Nothing is built in one shot.

## Status board

Statuses: `Not started` → `In progress` → `In review` (PR open, report sent) → `Done` (PR merged). `Blocked` if
waiting on a decision.

| ID | Milestone | Depends on | Status | Branch | PR |
| --- | --- | --- | --- | --- | --- |
| M00 | Repository foundations | — | Done | m00-repo-foundations | [#1](https://github.com/tonmoy-dhroubo/sms-pen-global-assessment/pull/1) |
| M01 | Next.js scaffold and tooling | M00 | Done | m01-nextjs-scaffold | [#2](https://github.com/tonmoy-dhroubo/sms-pen-global-assessment/pull/2) |
| M02 | Local infrastructure (Docker, env) | M01 | Done | m02-local-infrastructure | [#3](https://github.com/tonmoy-dhroubo/sms-pen-global-assessment/pull/3) |
| M03 | Prisma schema and first migration | M02 | Done | m03-prisma-schema | [#4](https://github.com/tonmoy-dhroubo/sms-pen-global-assessment/pull/4) |
| M04 | Domain rules and unit tests | M03 | Done | m04-domain-rules | [#5](https://github.com/tonmoy-dhroubo/sms-pen-global-assessment/pull/5) |
| M05 | API foundation, roles and test harness | M04 | Done | m05-api-foundation | [#6](https://github.com/tonmoy-dhroubo/sms-pen-global-assessment/pull/6) |
| M06 | Storage layer (S3 / MinIO) | M05 | Done | m06-storage-layer | [#7](https://github.com/tonmoy-dhroubo/sms-pen-global-assessment/pull/7) |
| M07 | Seed data and reset | M06 | Done | m07-seed-data | [#8](https://github.com/tonmoy-dhroubo/sms-pen-global-assessment/pull/8) |
| M08 | App shell and shared UI | M07 | Done | m08-app-shell | [#9](https://github.com/tonmoy-dhroubo/sms-pen-global-assessment/pull/9) |
| M09 | Students: list, create, record, status | M08 | Done | m09-students | [#10](https://github.com/tonmoy-dhroubo/sms-pen-global-assessment/pull/10) |
| M10 | Fees and payments | M09 | In progress | m10-fees-payments | |
| M11 | Staff dashboard | M10 | Not started | | |
| M12 | Assessments (staff) | M09 | Not started | | |
| M13 | Submissions (student upload flow) | M12 | Not started | | |
| M14 | Marksheet and results | M13 | Not started | | |
| M15 | Student portal | M14 | Not started | | |
| M16 | Activity timeline and extras | M15 | Not started | | |
| M17 | Quality pass | M16 | Not started | | |
| M18 | README, demo tour and submission | M17 | Not started | | |
| M19 | Hosted deployment (deferred) | M18 | Deferred | | |

Order is sequential even where the dependency column would allow parallel work; one milestone at a time.

## How the coder works through a milestone

1. Read [AGENTS.md](../AGENTS.md), this milestone's section, and every doc it references. Confirm all dependencies
   are `Done`.
2. Create the branch `mNN-short-slug` from an up-to-date `main`. Set the status to `In progress` and fill in the
   branch column.
3. Work through the tasks in order, ticking each checkbox here as it is completed. Commit in small Conventional
   Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`). Push the branch regularly.
4. If something behaviour-affecting is not covered by the docs, **stop and report the question** (status `Blocked`).
   Do not guess.
5. Run the milestone's verification steps and the Definition of Done checks. Fix until green.
6. Update any docs the milestone lists, tick the matching items in [edge-cases.md](edge-cases.md), and log notable
   AI work in [ai-usage.md](ai-usage.md).
7. Open the PR (`MNN: <title>`) using the PR template; set status to `In review` and fill in the PR column.
8. **Stop.** Send the report (template below). Do not start the next milestone.

## Definition of Done (every milestone)

- [ ] All tasks ticked; acceptance criteria met.
- [ ] `npm run lint`, `npm run typecheck`, `npm test` pass (and `npm run test:integration` from M05 onwards).
- [ ] `npm run build` succeeds (from M01 onwards).
- [ ] No `any` without a comment explaining why; no `console.log` left in app code.
- [ ] New env vars added to `.env.example` and `lib/env.ts`; no secrets committed.
- [ ] API changes reflected in [api.md](api.md); schema changes reflected in [db/er-diagram.md](../db/er-diagram.md).
- [ ] UI works in light and dark mode and at 375 px width; every interactive element is keyboard-reachable and labelled.
- [ ] CI is green on the PR.

## Report template

```markdown
## MNN report — <title>

**Status:** In review | Blocked
**Branch / PR:** mNN-slug — <PR link>

### What changed
- …

### How it was verified
| Command | Result |
| --- | --- |
| npm run lint | pass |
| … | … |

### Edge cases ticked
- …

### Deviations, questions or decisions needed
- … (or "None")

### Screenshots
(UI milestones only)

### Next
MNN+1 — <title> (not started; waiting for review)
```

---

## M00 — Repository foundations

**Goal:** a clean, professional repository before any app code exists.
**References:** D-019, tech-stack.md.

Tasks:
- [x] `.gitattributes`: `* text=auto eol=lf`, binary rules for images, PDF and DOCX fixtures.
- [x] `.editorconfig` (2 spaces, LF, final newline, trim trailing whitespace).
- [x] `.nvmrc` pinned to the current Node.js LTS major; `engines.node` will match in M01.
- [x] `.gitignore`: keep the brief PDF entry; add `node_modules/`, `.next/`, `coverage/`, `.env`, `.env.*` (but not
      `.env.example`), `*.log`, `.DS_Store`, `playwright-report/`, `test-results/`.
- [x] `.github/pull_request_template.md`: summary, milestone link, task checklist, verification table, screenshots,
      edge cases ticked, deviations.
- [x] `README.md` skeleton: project name, one-paragraph description, "Status: in development", links to `AGENTS.md`
      and `docs/`. (Fully written in M18.)
- [x] Re-normalise line endings of existing files after adding `.gitattributes`.

Acceptance criteria:
- `git status` is clean after a fresh clone and checkout; no CRLF warnings.
- The PR template appears when opening a PR.

Verification: `git ls-files --eol` shows `i/lf` for text files.

---

## M01 — Next.js scaffold and tooling

**Goal:** an empty but production-grade Next.js app with all tooling in place.
**References:** D-003, D-010, D-016, D-017, tech-stack.md.

Tasks:
- [x] Create the app with the latest stable Next.js (App Router, TypeScript, Tailwind, ESLint) at the repo root,
      without a `src/` folder. Layout: `app/`, `components/`, `lib/`, `db/`, `tests/`.
- [x] `tsconfig.json`: `strict: true`, `noUncheckedIndexedAccess: true`, path alias `@/*`.
- [x] Prettier with the Tailwind plugin; `eslint-config-prettier` so they don't fight.
- [x] npm scripts: `dev`, `build`, `start`, `lint`, `typecheck` (`tsc --noEmit`), `format`, `format:check`, `test`
      (Vitest unit), `test:watch`.
- [x] Vitest configured (Node environment for services; jsdom only where component tests need it) with one
      placeholder test.
- [x] shadcn/ui initialised (CSS variables, neutral base colour). Add: button, input, label, form, select, dialog,
      dropdown-menu, table, badge, card, tabs, sonner, skeleton, calendar, popover, command, sheet, tooltip,
      separator, alert.
- [x] `lucide-react`, `next-themes`; `ThemeProvider` in the root layout (class strategy, default System, no flash).
- [x] `ThemeToggle` component (Light / Dark / System) — used in the header in M08.
- [x] Fonts via `next/font` (IBM Plex Sans + IBM Plex Mono, per the mockup).
- [x] `package.json` `engines.node` matches `.nvmrc`.
- [x] GitHub Actions `ci.yml` on pull requests and pushes to `main`: checkout, setup-node from `.nvmrc` with npm
      cache, `npm ci`, `lint`, `typecheck`, `format:check`, `test`, `build`.
- [x] Remove create-next-app boilerplate (sample page, SVGs); a minimal home page saying "Registry — setting up".

Acceptance criteria:
- `npm run dev` serves the page; toggling theme works and persists across reloads without a flash.
- CI passes on the PR.

Verification: `npm ci && npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`.

---

## M02 — Local infrastructure

**Goal:** `docker compose up -d` gives a working Postgres and MinIO with no manual steps.
**References:** D-007, D-011, D-012, tech-stack.md (Environments, Local services).

Tasks:
- [x] `docker-compose.yml` with pinned image versions:
  - `postgres` (current major, alpine), named volume, healthcheck, port from env.
  - `minio`, named volume, API and console ports, healthcheck.
  - `minio-init` (`minio/mc`): waits for MinIO, creates the private `submissions` bucket, applies the CORS policy
        (allow `PUT`/`GET` from `http://localhost:3000`), exits 0. Safe to re-run.
- [x] A second database `sms_test` for integration tests (init script in `docker/postgres/init/`).
- [x] `.env.example` documenting every variable with a comment: `DATABASE_URL`, `DIRECT_URL`, `TEST_DATABASE_URL`,
      `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`,
      `S3_PUBLIC_ENDPOINT` (browser-reachable endpoint for presigned URLs, if different), `APP_TIMEZONE`
      (`Asia/Dhaka`), `SESSION_SECRET`, `MAX_UPLOAD_MB` (default 20), `DEMO_MODE` (`false`). Local defaults work
      as-is after `cp .env.example .env`.
- [x] `lib/env.ts`: Zod-validated, typed environment; the app fails fast at startup with a clear message listing
      missing or invalid variables. Server-only (never imported by client components).
- [x] npm scripts: `services:up`, `services:down`, `services:reset` (removes volumes).
- [x] README "Run locally" section (draft): prerequisites (Node LTS, Docker), the 4–5 commands.

Acceptance criteria:
- From a clean clone: `cp .env.example .env && npm run services:up` → both containers healthy, bucket exists and is
  private, CORS applied.
- Starting the app with a missing variable prints which one.

Verification: `docker compose ps` (healthy); `mc` or the MinIO console shows the bucket; anonymous GET on an object
is denied.

---

## M03 — Prisma schema and first migration

**Goal:** the agreed data model as a Prisma schema with a committed migration.
**References:** db/er-diagram.md, db/decisions.md (DB-001 to DB-020), db/README.md.

Tasks:
- [x] Prisma (latest stable) with the `pg` driver adapter. `prisma.config.ts` at the root pointing to
      `db/schema.prisma`, migrations in `db/migrations`, seed command `tsx db/seed/index.ts`.
- [x] Models, enums and relations exactly as the ER diagram, including `version`, `PENDING_UPLOAD`, `sha256`,
      `method`, `kind`, `instalment`, `isNonSubmission`, `MARK_CHANGE.change`.
- [x] Types: money `Decimal @db.Decimal(12,2)`; mark `Decimal @db.Decimal(4,1)`; calendar dates `@db.Date`;
      timestamps `@db.Timestamptz(3)`; UUID ids with database defaults.
- [x] Unique constraints: `studentNumber`, `email`, programme/module `code`, payment `reference`, `objectKey`,
      (`assessmentId`,`studentId`) on Submission, Mark, Extension; (`programmeId`,`academicYear`,`instalment`) on
      ProgrammeFee.
- [x] Check constraints added in the migration SQL: mark between 0 and 100; payment amount > 0; mark null exactly
      when `isNonSubmission`; WAIVER amounts negative, other charge kinds positive.
- [x] Postgres extensions `unaccent` and `pg_trgm` enabled in the migration; a trigram index on
      `unaccent(lower(fullName))` (immutable wrapper function) for search; plain indexes on foreign keys,
      `status`, `programmeId`, `dueDate`, `deadline`.
- [x] `onDelete` rules: `Restrict` for students, payments, marks and submissions (DB-005); `Cascade` only for
      `PROGRAMME_MODULE`.
- [x] `lib/db.ts`: Prisma client singleton (safe with Next.js hot reload).
- [x] npm scripts: `db:migrate` (dev), `db:deploy`, `db:generate`, `db:validate`, `db:studio`.
- [x] Add `npx prisma validate` to CI.
- [x] Make sure `next build` still passes in CI without a `.env` once `lib/db` imports `lib/env` (give the CI build step
      dummy values, or parse env lazily) — flagged in the M02 report.
- [x] Update db/er-diagram.md if anything had to differ, with the reason in db/decisions.md (via the report).

Acceptance criteria:
- `npm run db:migrate` on an empty database applies cleanly; running it again reports nothing to do.
- Inserting a mark of 101, a zero payment or a positive waiver fails at the database level.

Verification: migrate on a fresh DB; `prisma validate`; a short script or psql session proving the check constraints.

---

## M04 — Domain rules and unit tests

**Goal:** every business rule as a pure, fully tested function in `lib/services/rules/` — no database, no HTTP.
**References:** db/README.md (calculated values), DB-015, DB-019, D-018, D-023, api.md (status transitions),
edge-cases.md.

Tasks:
- [x] `money.ts`: decimal arithmetic (never floats), BDT formatting with lakh grouping (`৳1,25,000.00`), parsing
      user input.
- [x] `time.ts`: "now" injectable for tests; Asia/Dhaka date helpers; `sessionFor(date)` (July start);
      `formatDate`, `formatDateTime`, relative "in 2 days" / "3 days ago".
- [x] `student-number.ts`: format and parse `SMS-YYYY-NNNN`; widen beyond 9999 without breaking (e.g. `SMS-2026-10000`).
- [x] `status.ts`: transition matrix; which transitions need a reason.
- [x] `fees.ts`: `feeSummary(charges, payments, today)` → charged, waived, paid, balance, credit, overdue amount,
      oldest overdue days, ageing bucket (`1-30`, `31-60`, `60+`), next due date; voided payments ignored.
- [x] `deadlines.ts`: effective deadline (extension aware), `isLate`, `lateBy` (human: "5 hours", "2 days").
- [x] `submission-rules.ts`: `canUpload(student, assessment, existingSubmission, now)` → allowed or a reason code
      (`NOT_ENROLLED`, `MODULE_NOT_IN_PROGRAMME`, `CLOSED`, `ON_TIME_LOCKED`).
- [x] `marks.ts`: validate (0–100, ≤ 1 decimal); classify with half-up rounding (DB-019); NS → Fail.
- [x] `publish.ts`: build the publish preview (counts, missing marks, students with overdue fees).
- [x] `duplicates.ts`: name normalisation (case, accents, extra spaces) for the duplicate check.
- [x] Tests for all of the above, including boundaries: marks 39.4/39.5/40/59.4/59.5/69.4/69.5/70/0/100/100.1/
      −1/40.25; payments exactly equal, greater and less than balance; overdue at 0, 1, 30, 31, 60, 61 days;
      deadlines at exactly the deadline second; session rollover on 30 Jun / 1 Jul in Dhaka time.

Acceptance criteria:
- Coverage for `lib/services/rules` ≥ 95% lines and branches.
- No rule depends on the machine's time zone (tests run with `TZ=UTC` and `TZ=America/New_York` in CI).

Verification: `npm test -- --coverage`.

---

## M05 — API foundation, roles and test harness

**Goal:** the plumbing every endpoint uses, plus integration tests against a real database.
**References:** api.md (Conventions, Session, Health), D-005, D-008, D-020.

Tasks:
- [x] `lib/api/handler.ts`: wraps Route Handlers — parses and validates input with Zod, maps errors to the standard
      error shape and status codes, attaches `warnings`, logs unexpected errors with a request id.
- [x] Error classes: `ValidationError`, `NotFoundError`, `ForbiddenError`, `ConflictError`, `VersionConflictError`,
      `DuplicateWarning`, `BusinessRuleError`.
- [x] `lib/session.ts`: sign and verify the role cookie (HMAC, HTTP-only, `SameSite=Lax`, `Secure` in production);
      helpers `requireStaff()`, `requireStudent()`, `currentIdentity()`.
- [x] `proxy.ts` (Next.js 16's name for `middleware.ts`): redirect `/staff/*` and `/student/*` to `/` when the cookie is missing, invalid or for the
      wrong role.
- [x] Endpoints: `GET/PUT/DELETE /api/session`, `GET /api/session/options`, `GET /api/health` (DB check now;
      storage added in M06), `GET /api/me` (basic).
- [x] Integration test harness: `npm run test:integration` runs Vitest against `TEST_DATABASE_URL`, resets the
      schema before the run and truncates tables between tests; helpers to build test data and call handlers.
      Prisma 7 blocks `prisma migrate reset` when run by an AI agent (DB-022): reset with the harness's own guarded
      drop-and-recreate plus `prisma migrate deploy`, reusing the M03 `tests/db` setup where possible.
- [x] CI job for integration tests using GitHub Actions service containers (Postgres; MinIO added in M06).
- [x] Tests: tampered cookie rejected; wrong role → 403; no cookie → 401; error shape for each error class.

Acceptance criteria:
- Switching role via `PUT /api/session` sets a cookie that the middleware honours.
- Integration tests run locally and in CI.

Verification: `npm run test:integration`; manual curl of `/api/session` and `/api/health`.

---

## M06 — Storage layer

**Goal:** a small, tested wrapper over S3 that works identically with MinIO and, later, Supabase Storage.
**References:** D-006, D-012, D-013, tech-stack.md (File uploads).

Tasks:
- [x] `lib/storage.ts` using the AWS SDK v3: `presignPut(key, contentType, sizeBytes, expiresIn)`,
      `presignGet(key, downloadName, expiresIn)`, `headObject`, `readFirstBytes(key, n)`, `sha256(key)` (streamed),
      `deleteObject`, `deletePrefix`.
- [x] Presigned URLs use `S3_PUBLIC_ENDPOINT` when set (the browser-facing host).
- [x] Object key builder `submissions/<assessmentId>/<studentId>/<uuid>.<ext>`.
- [x] `/api/health` reports storage status.
- [x] Test presigned PUTs with the real AWS SDK v3 against MinIO, including the checksum headers newer SDK versions
      add (flagged in the M02 report).
- [x] MinIO service container (`pgsty/minio`, D-027) added to the CI integration job; integration tests for put → head → read → hash →
      delete.

Acceptance criteria:
- A file PUT to a presigned URL from outside the app is readable through `presignGet`; anonymous access is denied.

Verification: `npm run test:integration`.

---

## M07 — Seed data and reset

**Goal:** the demo data in [db/seed-plan.md](../db/seed-plan.md), reproducible and self-checking.
**References:** db/seed-plan.md, D-022, DB-004, DB-015, DB-017, DB-018.

Tasks:
- [x] `lib/services/student-number.ts`: transactional allocator (upsert-increment on `STUDENT_ID_SEQUENCE`), with an
      integration test creating 20 students concurrently and getting 20 distinct, gap-free numbers.
- [x] Fixture files in `db/seed/fixtures/`: small valid PDF and DOCX.
- [x] `db/seed/index.ts`: builds staff, programmes, fee schedules (current and earlier sessions), modules,
      assessments, 30 students with charges, payments (incl. voided, bKash, Nagad), waivers, status histories,
      submissions with real uploaded files (incl. resubmission versions and late ones), marks (incl. boundaries, NS,
      draft/published/withheld, a post-publish change).
- [x] All dates relative to seed time `T` in Asia/Dhaka; deterministic RNG for filler.
- [x] Self-check at the end: recompute with the real rule functions and assert the expected facts from the seed plan
      (8 overdue with the right buckets, 1 credit, the late submissions, the withheld results, status totals).
      Fail with a clear message if anything differs.
- [x] Scripts: `db:seed`, `db:reset` (drop, migrate, empty the bucket, seed). `db:reset` uses its own guarded
      drop of the `public` schema + `prisma migrate deploy` (not `prisma migrate reset`, DB-022) and refuses unless the
      database host is local (`localhost`/`127.0.0.1`/`::1`) or `--force` is passed.
- [x] Draft the "demo tour" list for the README from the personas (finalised in M18).

Acceptance criteria:
- `npm run db:reset` runs twice in a row with identical results and passes its self-check.

Verification: `npm run db:reset`; spot-check in Prisma Studio and the MinIO console.

---

## M08 — App shell and shared UI

**Goal:** the frame every page lives in, and the shared components.
**References:** docs/pages.md (Global layout, Status badges), D-016, D-017, D-020, mockup.

Tasks:
- [x] `/` role picker page (staff cards + student search).
- [x] Header: app name, staff search box placeholder (wired in M16), `ThemeToggle`, role switcher dropdown
      (staff list + searchable students) calling `PUT /api/session` then navigating.
- [x] Staff layout with sidebar (collapses to a sheet on mobile); student layout with tabs.
- [x] Shared components: `StatusBadge` (all groups in pages.md), `Money`, `DateTime`, `RelativeTime`,
      `Countdown`, `EmptyState`, `ErrorState` with retry, page skeletons, `DataTable` base (server-side pagination
      and sort, URL state), confirm dialog, reason dialog (for actions needing a reason).
- [x] Sonner toasts for success and errors; API error helper that maps `fieldErrors` onto forms.
- [x] `DEMO_MODE` banner.
- [x] Placeholder pages for every route in pages.md (title + "coming in MNN").

Acceptance criteria:
- Switching between a staff member and any student lands on the right home; tampering with the cookie sends you to `/`.
- Light/dark both readable; works at 375 px.

Verification: manual walkthrough + screenshots (light, dark, mobile) in the PR.

---

## M09 — Students

**Goal:** the enrolment workflow end to end.
**References:** api.md (Students), pages.md (`/staff/students*`), edge-cases.md (Enrolment), DB-004, DB-007,
DB-015, DB-016.

Tasks:
- [x] Services: `listStudents` (search across name with unaccent/trigram, partial Student ID, email; filters; fee
      state; default status filter), `createStudent` (transaction: allocate number, create, initial STATUS_CHANGE,
      fee charges from the programme schedule; email lower-cased; duplicate check unless confirmed),
      `getStudent`, `updateStudent` (version check), `changeStatus` (matrix, reasons, history).
- [x] Endpoints per api.md.
- [x] UI: list page with search, filters, filter chips, pagination; new student form with duplicate dialog;
      record page header and profile; edit page with version-conflict handling; status change dialog showing only
      allowed transitions.
- [x] Integration tests: create (ID format and sequence), email conflict, duplicate warning + confirm, invalid
      DOB/age, every allowed and disallowed transition, version conflict, search by partial ID and accent-insensitive
      name, default hiding of withdrawn/completed.

Acceptance criteria and edge cases: all Enrolment items in edge-cases.md ticked.

Verification: tests + manual walkthrough with screenshots.

---

## M10 — Fees and payments

**Goal:** what each student owes and has paid, live.
**References:** api.md (Programmes, Fees and payments), pages.md (Fees section, `/staff/fees`, `/staff/programmes`),
edge-cases.md (Fees), DB-002, DB-003, DB-011, DB-018.

Tasks:
- [ ] Services: fee schedule read/replace (new charges only), `getStudentFees`, `addCharge` (adjustment/waiver),
      `recordPayment` (future date blocked, duplicate reference conflict, overpayment warning), `voidPayment`,
      `listBalances` (fee state and ageing filters).
- [ ] Endpoints per api.md.
- [ ] UI: Fees section on the student record (summary, charges, payments, voided struck through); record payment
      dialog (method incl. bKash/Nagad, reference, date, amount; warnings shown); add adjustment/waiver dialog; void
      dialog with reason; `/staff/fees` overview with ageing filter; `/staff/programmes` with fee schedules.
- [ ] Balance updates immediately after any action (no reload needed).
- [ ] Integration tests for every Fees edge case, including withdrawn students staying on the overdue list and
      "outstanding but not due" vs "overdue".

Acceptance criteria and edge cases: all Fees items in edge-cases.md ticked (debt ageing data ready for M11).

---

## M11 — Staff dashboard

**Goal:** the Registry's morning view.
**References:** pages.md (`/staff`), api.md (Dashboard), seed-plan.md (expected figures).

Tasks:
- [ ] `GET /api/dashboard` with KPI counts, overdue list with ageing buckets, needs-attention items.
- [ ] UI: KPI cards, ageing breakdown (small bar or segmented summary using shadcn Charts), overdue table with
      "Record payment", needs-attention list linking to the right record or assessment.
- [ ] Efficient queries (no per-student loops); tested.

Acceptance criteria: after `npm run db:reset`, every figure matches the "expected" table in seed-plan.md.

---

## M12 — Assessments (staff)

**Goal:** staff create and manage assessments and see submissions.
**References:** api.md (Assessments, file download), pages.md (`/staff/assessments*`), edge-cases.md
(Submissions), D-013.

Tasks:
- [ ] Services and endpoints: list (with counts), create, get, update (version; deadline-change warning with count
      of changed late flags), close, reopen, list submissions for eligible students (programme includes module,
      status Enrolled — plus any student who already submitted).
- [ ] File download endpoint with permission check and presigned GET (original file name).
- [ ] UI: list page, new form (date + time in Asia/Dhaka), detail page with Submissions tab (status badges,
      lateness, versions, download).
- [ ] Integration tests: eligibility, close/reopen, deadline change flips late flags, download permissions.

---

## M13 — Submissions (student upload flow)

**Goal:** students submit work safely, with receipts.
**References:** api.md (Submissions and files), D-013, D-023, DB-017, edge-cases.md (Submissions).

Tasks:
- [ ] `upload-url` endpoint: rule checks via `canUpload`, type/size checks, creates `PENDING_UPLOAD` (15-minute
      expiry), returns presigned PUT.
- [ ] `confirm` endpoint: idempotent; verifies object exists and size; magic bytes (PDF; DOCX zip with
      `word/document.xml`; reject macro-enabled); rejects empty files; computes SHA-256; `uploadedAt` from the object's
      arrival time; creates or adds a version to the submission; deletes invalid objects; returns the receipt.
- [ ] Cleanup script `npm run uploads:cleanup` for expired pending uploads.
- [ ] UI: `/student/assessments` and `/student/assessments/[id]` — countdown, rules text, upload with progress,
      replace, disabled states with reasons, receipt display.
- [ ] Integration tests: every submission edge case, including double confirm, upload after close, on-time lock
      after deadline, first upload after deadline flagged late, wrong content with a `.pdf` name, `.docm`, empty file,
      oversize, deferred student.

Acceptance criteria and edge cases: all Submissions items in edge-cases.md ticked, including the receipt (S).

---

## M14 — Marksheet and results

**Goal:** staff enter, publish and withhold marks; students see only what is published.
**References:** api.md (Marks and results), pages.md (Marksheet tab), DB-010, DB-012, DB-019, DB-020,
edge-cases.md (Marks and results).

Tasks:
- [ ] Services and endpoints: marksheet rows, upsert mark (validation, NS, version, reason when published,
      MARK_CHANGE entries), publish (dry run preview + real run with warnings), withhold (reason), unpublish (reason),
      student results for staff.
- [ ] UI: Marksheet tab grid (keyboard navigation, live classification, NS toggle, late flag visible, unsaved
      changes warning, per-row save state), publish preview dialog, withhold/unpublish/change-reason dialogs;
      Results section on the student record with history.
- [ ] Integration tests: boundaries through the API, NS, reason enforcement, publish preview counts, overdue-fee
      warning, withheld hidden from the student API.

Acceptance criteria and edge cases: all Marks and results items ticked, including the bulk publish preview (S).

---

## M15 — Student portal

**Goal:** the student's own view, complete and locked down.
**References:** pages.md (Student), api.md (`/api/me`).

Tasks:
- [ ] `/api/me`, `/api/me/fees`, `/api/me/assessments`, `/api/me/results` completed.
- [ ] UI: overview, fees, assessments (from M13), results (published only; "Not yet available" otherwise); notices
      for deferred/withdrawn students.
- [ ] Access tests: for every student-facing endpoint, using another student's IDs returns 404; staff-only
      endpoints return 403 for students.

Acceptance criteria: the cross-cutting access-control item in edge-cases.md ticked.

---

## M16 — Activity timeline and extras

**Goal:** the cheap stand-outs that make the app feel real.
**References:** edge-cases.md (Extras), DB-020.

Tasks:
- [ ] `GET /api/students/{id}/timeline` and the timeline section on the student record.
- [ ] Header quick search for staff: type a name or partial ID, jump to the record (keyboard shortcut `Ctrl+K`
      opens it).
- [ ] "Change role" entry in the header switcher: calls `DELETE /api/session` and returns to the role picker `/`.
- [ ] (Could) CSV exports: overdue list and marksheet.
- [ ] (Could) Print stylesheet for the student record's fee statement and marksheet.

---

## M17 — Quality pass

**Goal:** prove every edge case and polish the rough edges.
**References:** edge-cases.md (all), Definition of Done.

Tasks:
- [ ] Walk every item in edge-cases.md against the running app; anything unticked is either fixed or explicitly
      reported as dropped (with a reason).
- [ ] Accessibility: keyboard-only walkthrough of each workflow; labels; focus states; contrast in both themes;
      run an automated check (axe) on the main pages.
- [ ] Responsive check at 375 px, 768 px, 1280 px. Known item from M09: the student list's five filters stack
      tall at ~960 px and the fee column scrolls out of view; lay filters out in one row on wide screens and keep
      the fee badge visible.
- [ ] Empty, loading and error states for every list and panel.
- [ ] (Could) One Playwright test covering: staff records a payment → student sees the updated balance; student
      uploads → staff sees the submission; staff publishes → student sees the result.
- [ ] Review indexes and query counts on the heaviest pages.
- [ ] Dependency hygiene: move the `shadcn` CLI from `dependencies` to `devDependencies` (it pulls the `braces`
      advisory into the production tree); re-run `npm audit --omit=dev` and record the result.

---

## M18 — README, demo tour and submission

**Goal:** a submission a grader can run and understand in ten minutes.
**References:** requirements.md (Deliverables), ai-usage.md, seed-plan.md.

Tasks:
- [ ] README: overview; screenshots; tech stack; **run locally** (exact commands from a fresh clone); **every `.env`
      variable explained**; npm scripts; architecture summary; links to docs, API and ER diagram; testing;
      **demo tour** (which student to open to see each edge case); **"How I used AI"** section summarising
      ai-usage.md (tools, how the work was split between planner and coder agents, what was reviewed or rejected);
      known limitations.
- [ ] Fresh-clone rehearsal: follow the README exactly on a clean checkout; fix anything that doesn't work.
- [ ] Ask the user whether to add a rendered PNG export of the final ER diagram (`db/er-diagram.png`).
- [ ] Final check that no secrets or the brief PDF are in the repo history.

---

## M19 — Hosted deployment (deferred)

Not started until the user asks. See [discussions.md](discussions.md) (Hosted setup) and D-011 to D-014.
