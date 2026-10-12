# Decision log

One entry per decision, newest at the bottom. Keep each short: context, decision, why, alternatives considered.

## Template

```
## D-NNN: <title>
- Date: YYYY-MM-DD
- Context: <what prompted it>
- Decision: <what we chose>
- Why: <reasoning>
- Alternatives: <what we rejected and why>
```

---

## D-001: Keep the brief PDF out of the repo

- Date: 2026-10-11
- Context: The assessment brief is marked "for recruitment purposes only, do not distribute", but the repo is the submission.
- Decision: The PDF is listed in `.gitignore`; `docs/requirements.md` holds our own summary of it.
- Why: Respects the distribution notice while keeping the requirements available to anyone working on the code.
- Alternatives: Committing the PDF (violates the notice); no written requirements (agents and reviewers lose context).

## D-002: `main` as the default branch

- Date: 2026-10-11
- Decision: Work on `main`; the initial `master` branch was renamed and removed from GitHub.

## D-003: TypeScript with the latest stable Next.js and Prisma

- Date: 2026-10-11
- Decision: TypeScript in strict mode, latest stable Next.js (App Router, React 19) and latest stable Prisma.
- Why: Prisma's generated types carry through to the UI and API. Starting a new project on the oldest version the
  brief allows (14) would only add upgrade debt.
- Alternatives: Pinning Next.js 14 (no benefit); plain JavaScript (loses type safety on the schema).

## D-004: npm as package manager

- Date: 2026-10-11
- Decision: npm.
- Why: Ships with Node, so reviewers need nothing extra to run the project.
- Alternatives: pnpm (faster and stricter, but one more tool to install).

## D-005: Route Handlers as the write API, shared service layer

- Date: 2026-10-11
- Decision: Mutations go through Route Handlers in `app/api/`; Server Components read through the same `lib/services`
  layer. Business rules live only in `lib/services`.
- Why: "Working API routes" is a graded criterion, so there must be a real API to inspect. One service layer avoids
  duplicating rules between pages and the API and makes the rules unit-testable.
- Alternatives: Server Actions only (simpler, but leaves no API routes to assess).

## D-006: MinIO for submission files

- Status: Upload flow superseded by D-013; MinIO stays as the local store (D-012).
- Date: 2026-10-11
- Decision: Store uploaded files in MinIO (S3-compatible) run by Docker Compose, through the AWS S3 SDK. Private
  bucket; uploads validated on the server; downloads via short-lived presigned URLs after a permission check.
- Why: Mirrors how production systems store files and keeps binaries out of Postgres and the app's filesystem.
  Moving to AWS S3 later is a configuration change.
- Alternatives: Local disk (simplest, but not production-like); storing files in Postgres (bloats the database).

## D-007: Docker Compose for local services

- Date: 2026-10-11
- Decision: `docker-compose.yml` runs Postgres, MinIO and a one-shot container that creates the bucket.
- Why: A reviewer gets every dependency with one command and no manual setup.
- Alternatives: Asking reviewers to install Postgres and MinIO themselves.

## D-008: Role switcher instead of real authentication

- Date: 2026-10-11
- Decision: A cookie-based switcher selects Staff, or Student plus which student. Roles are enforced on the server in
  middleware and Route Handlers.
- Why: The brief makes auth optional and accepts a role toggle. It lets reviewers try both views instantly while
  still showing proper server-side access control.
- Alternatives: Auth.js with seeded logins (more realistic, but costs time and adds friction for reviewers).

## D-009: Local-only deployment for now

- Status: Superseded by D-011.
- Date: 2026-10-11
- Decision: The app runs locally only. Hosting (e.g. Vercel + Neon + S3) can be revisited later.
- Why: Keeps effort on the graded features; the brief only asks for local run instructions.

## D-010: Supporting libraries

- Date: 2026-10-11
- Decision: Tailwind + shadcn/ui, Zod, react-hook-form, TanStack Table, date-fns, Vitest, ESLint + Prettier.
- Why: shadcn is the brief's preferred UI library, and its Form and data-table components are built on
  react-hook-form and TanStack Table. Zod schemas are shared between forms and API validation. Vitest covers the
  business rules.

## D-011: Two environments — local (Docker) and hosted (Vercel)

- Date: 2026-10-11
- Decision: Local runs everything in Docker; a hosted demo runs on Vercel. Postgres is Docker locally and **Neon** on
  Vercel. Deploy once the features work, not at the start.
- Why: The submission must run locally from a clone with no accounts, so Docker stays the default for reviewers.
  A live URL additionally lets reviewers try the app without cloning. Neon is Vercel's standard Postgres pairing and
  has a free tier.
- Alternatives: Neon for both (reviewers would need an account or shared credentials); local only (no live demo).

## D-012: Storage — MinIO locally, Supabase Storage on Vercel

- Date: 2026-10-11
- Decision: MinIO in Docker locally; **Supabase Storage** (through its S3-compatible endpoint) on Vercel. Only
  Supabase's storage is used, not its database or auth.
- Why: Vercel cannot run MinIO. Supabase Storage is free without a card and speaks the S3 API, so the same S3 SDK
  code serves both environments and only environment variables differ.
- Alternatives: Cloudflare R2 (needs a card); Backblaze B2 (also viable); Vercel Blob (not S3-compatible, would need a
  second code path).

## D-013: Uploads go directly from the browser to the bucket

- Date: 2026-10-11
- Decision: Three steps. (1) The server checks the role, the assessment and the deadline, then issues a short-lived
  presigned upload URL for a key it chooses. (2) The browser uploads straight to the bucket. (3) A confirm request
  makes the server check the stored object's size and leading bytes (PDF/DOCX signature) and only then record the
  submission; invalid objects are deleted.
- Why: Vercel rejects request bodies over about 4.5 MB, so files cannot pass through a Route Handler. Building it
  this way from the start means local and hosted behave identically.
- Alternatives: Uploading through the server (breaks on Vercel for larger files); capping files at 4 MB (too small
  for real coursework).

## D-014: Hosted demo safeguards

- Date: 2026-10-11
- Decision: The hosted demo shows a visible "Demo environment" banner, and a reset script restores the seed data.
- Why: With a role switcher instead of real auth, anyone with the link can act as Staff. That is acceptable for demo
  data, but reviewers need to know it and be able to restore a clean state.

## D-015: Separate planner and coder agents

- Date: 2026-10-11
- Decision: Two Claude Code subagents in `.claude/agents/`. `planner` (Opus 5.5, high effort) handles decisions,
  discussion and docs, and may edit only `docs/` and `AGENTS.md`. `coder` (Sonnet 5.5, high effort) handles code and
  tests, implements recorded decisions, and reports open questions instead of deciding them.
- Why: Keeps reasoning and decisions documented in one place, uses the stronger model where judgement matters most,
  and stops implementation from quietly making product decisions.

## D-016: UI libraries — shadcn/ui and its ecosystem only

- Date: 2026-10-11
- Decision: shadcn/ui (Radix primitives) with lucide-react icons, TanStack Table (data-table), Sonner toasts,
  Calendar (react-day-picker), Charts (Recharts), Sidebar block for navigation, and next-themes for theming.
- Why: shadcn is the brief's preferred library. Every companion is part of shadcn or something it already builds on,
  so the app stays one consistent design system.
- Alternatives: Mantine, Ant Design, MUI, Chakra, HeroUI — capable, but not the brief's preference and a poorer fit
  with Tailwind.

## D-017: Dark mode with a global toggle

- Date: 2026-10-11
- Decision: Light and dark themes via next-themes (class strategy). A toggle in the app header is available on every
  page in both Staff and Student views, offering Light / Dark / System; it defaults to System and the choice persists
  in the browser.
- Why: Requested by the user. Staff use the app all day, and shadcn makes theming nearly free.
- Implementation notes: no flash of the wrong theme on load; status badges and chart colours need dark variants that
  keep readable contrast; never rely on colour alone (badges always carry a text label).

## D-018: Locale — Bangladesh time and Taka

- Date: 2026-10-12
- Decision: Time zone `Asia/Dhaka` (UTC+6, no daylight saving) for deadlines, "today", overdue and display.
  Currency BDT, shown as `৳1,25,000.00` with South Asian (lakh/crore) grouping and English digits. Dates shown as
  `11 Oct 2026`, date-times as `11 Oct 2026, 23:59`. Academic sessions run July–June and are labelled `2026-27`.
- Why: Requested by the user; PEN Global's registry operates in Bangladesh.
- Notes: Supersedes the £ and Western names used in the early mockup; the mockup is a layout reference only.

## D-019: Git workflow — a branch and pull request per milestone

- Date: 2026-10-12
- Decision:
  - Code changes go through a branch and PR per milestone: branch `mNN-short-slug` (e.g. `m03-prisma-schema`), PR
    titled `MNN: <milestone title>`, body from the PR template (summary, checklist, verification output,
    screenshots for UI, edge cases ticked).
  - Commits follow Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`).
  - CI (lint, type-check, tests, Prisma validate) must pass. The user reviews; after approval the PR is
    squash-merged and the branch deleted.
  - Planning and docs-only changes made in the main session may be committed straight to `main`.
- Why: Requested "whatever looks professional". PRs show process to graders and give a natural review point after
  each milestone.

## D-020: Role switcher details

- Date: 2026-10-12
- Decision: A header dropdown ("Viewing as: …") lists the seeded staff and a searchable student list. Switching
  sets a signed, HTTP-only cookie (HMAC with `SESSION_SECRET`) and lands on `/staff` or `/student`. A missing or
  invalid cookie (e.g. the student no longer exists) sends the user to `/`, the role picker.
- Why: Lets reviewers move between views instantly while access control stays server-side and tamper-resistant.

## D-021: Build in milestones, one at a time

- Date: 2026-10-12
- Decision: The build follows [milestones.md](milestones.md). The `coder` agent takes exactly one milestone at a
  time on its own branch, opens a PR, updates the tracker, and stops to report. The next milestone starts only after
  the user has reviewed and the PR is merged. A milestone is done only when its acceptance criteria and the
  Definition of Done in the tracker are met.
- Why: Requested by the user: no one-shot implementation; reviewable steps with a report after each.

## D-022: Demo data — 30 students, dates relative to seed time

- Date: 2026-10-12
- Decision: Seed 30 students across 3 programmes, 8 modules and 10 assessments, with personas chosen to show every
  edge case ([db/seed-plan.md](../db/seed-plan.md)). All dates are computed relative to when the seed runs.
- Why: A busier dashboard reads like a real registry, and relative dates keep "overdue by 20 days" and "due in
  2 days" true whenever a reviewer runs the seed.

## D-023: Late-upload timing — the moment the file arrives

- Date: 2026-10-12
- Decision: A submission's time is when the uploaded file finished arriving in storage (verified at confirm),
  not when the upload started. Students are told this next to the upload button.
- Why: It is the only timestamp the server can trust, and it is the common rule in university systems. Telling
  students up front avoids disputes.

## D-024: Edge-case priorities accepted

- Date: 2026-10-12
- Decision: The Must / Should / Could split in [edge-cases.md](edge-cases.md) is accepted as proposed.
- Why: The user delegated the remaining open choices to Claude's recommendations.

## D-025: Overnight autonomy — Claude reviews and merges milestone PRs

- Date: 2026-10-12
- Decision: While the user is away (from the night of 2026-10-12), the main Claude session reviews each milestone
  PR itself and squash-merges it when CI is green and the acceptance criteria and Definition of Done are met, then
  starts the next milestone. Anything behaviour-affecting that the docs don't cover is parked for the user rather
  than decided. The user reviews merged PRs and reports in the morning.
- Why: Chosen by the user before going to sleep, so work continues without blocking on review.

## D-026: Cache Components off; M01 tooling notes

- Date: 2026-10-12
- Decision: `cacheComponents` and `partialPrefetching` are disabled in `next.config.ts`. Every page is per-user and
  dynamic (signed role cookie, live database data), so classic dynamic rendering is simpler and avoids
  Suspense/`"use cache"` requirements on every cookie or Prisma read.
- Also recorded from M01:
  - shadcn's `form` component no longer exists in the registry; forms use shadcn **`field`** with react-hook-form's
    `Controller` and Zod resolvers.
  - `lib/utils.ts` re-exports `cn` from the `cn` package (published by shadcn; replaces clsx + tailwind-merge).
  - `agentRules: false` stops `next dev` editing AGENTS.md. Next.js 16 ships version-matched docs in
    `node_modules/next/dist/docs/`; agents should consult them rather than rely on memory.
  - `npm audit` reports high advisories in `braces` via `eslint-config-next` (dev-only, no non-downgrade fix);
    accepted for now, re-checked in M17.
- Why: Decided by Claude during the overnight review (D-025); purely technical, no behaviour change.

## D-027: MinIO images from the community Silo fork; server-wide CORS

- Date: 2026-10-12
- Context: In M02 the official `minio/minio` and `minio/mc` images turned out to be unavailable (Docker Hub denies
  access; `quay.io/minio/*` has no manifests — verified by Claude), so pinned official tags are impossible.
- Decision: Use the community-maintained Silo fork, `pgsty/minio` and `pgsty/mc`, pinned to release tags. Same S3
  API and commands, so D-012 (MinIO locally) stands. Because MinIO does not implement per-bucket CORS, CORS is set
  server-wide via `MINIO_API_CORS_ALLOW_ORIGIN` (from `APP_ORIGIN`).
- Why: Closest drop-in to the user's choice of MinIO, current releases, working console. Decided by Claude during
  the overnight review (D-025); **flagged for the user to confirm** — it is a third-party image.
- Alternatives: `alpine/minio` (stale since 2025-10); switching to another S3 server such as Garage or SeaweedFS
  (would change the user's choice); building MinIO from source (slow, fragile for reviewers).
- Also accepted from M02: `server-only` dependency; optional `DIRECT_URL`, `TEST_DATABASE_URL`,
  `S3_PUBLIC_ENDPOINT`; defaults `APP_TIMEZONE=Asia/Dhaka`, `MAX_UPLOAD_MB=20`, `DEMO_MODE=false`;
  `SESSION_SECRET` ≥ 32 characters. The hosted demo (M19) must set a real secret.

## D-028: Payments settle the oldest charge first; locale formatting independent of ICU

- Date: 2026-10-12
- Decision:
  - Payments are not linked to specific charges. They settle charges in due-date order (oldest first). Overdue age
    is measured from the oldest charge that is past due and not yet covered; the next due date is the first
    uncovered charge due today or later. A charge due today is not overdue.
  - BDT formatting (`৳1,25,000.00`) and date formatting (`11 Oct 2026`) are implemented by hand on top of
    `Intl.formatToParts`/`decimal.js`, because no ICU locale on Node 24 produces the exact D-018 format.
  - Rules never read the clock; `lib/services/clock.ts` provides `systemClock` and `fixedClock`.
  - Accepted defaults from M04: a late submission can be replaced again after the deadline (only on-time
    submissions are locked); durations use the largest whole unit ("2 days", "5 hours"); duplicate-name
    normalisation strips Latin diacritics but keeps Bengali vowel signs.
- Why: Oldest-first is how student accounts are normally settled and needs no payment-to-charge links. Recorded
  from the M04 report during the overnight review (D-025). The seed plan was adjusted (personas 4 and 29) so the
  60+ ageing examples hold under this rule.

## D-029: Session and API details settled in M05

- Date: 2026-10-12
- Decision (accepted from the M05 report during the overnight review, D-025):
  - Next.js 16 uses `proxy.ts` (formerly middleware). It only checks the cookie's signature, age and role and
    redirects; route handlers and server code re-verify and confirm the record still exists.
  - Role cookie lifetime 7 days with 60 s clock-skew tolerance; `Secure` in production. If `SESSION_SECRET` is
    missing, the proxy refuses everyone rather than failing open.
  - `GET /api/session` always returns 200 (`{role:null}` when there is no valid session); `PUT` returns the
    identity; `DELETE` returns 200 `{role:null}`.
  - `/api/session/options` returns `{staff, students:{items,total}}` (limit 20, max 50), matching name or Student
    ID only and exposing no emails or dates of birth, because the role picker is public.
  - `/api/me` reports `canSubmit` as `{allowed, reason, message}` based on status; per-assessment reasons live on
    `/api/me/assessments`.
  - 500 responses carry `details.requestId`; every response has `x-request-id` and `Cache-Control: no-store`.
  - One integration harness (`npm run test:integration`) replaces `test:db`; it only ever touches databases whose
    name ends in `_test`.
- Note for the README (M18): with `npm start` (production mode) over plain HTTP, the Secure cookie works on
  localhost in Chrome, Firefox and Edge; reviewers should use `npm run dev` or one of those browsers.

## D-030: Storage layer details settled in M06

- Date: 2026-10-12
- Decision (accepted from the M06 report during the overnight review, D-025):
  - AWS SDK v3 with `requestChecksumCalculation`/`responseChecksumValidation` = `WHEN_REQUIRED`; the default adds a
    CRC32 of an empty body to presigned PUT URLs, which MinIO ignores but AWS-style stores reject.
  - Presigned PUTs sign `content-type` and `content-length`; a mismatched type or size gets 403 from storage.
    File contents and the configured maximum size are still checked at confirm time (M13). If Supabase (M19)
    rejects a signed `content-length`, drop it from the signed headers and rely on the confirm check.
  - Downloads use `Content-Disposition: attachment` with an ASCII fallback plus an RFC 5987 `filename*`, so
    Bengali file names survive.
  - Submission time (D-023) comes from the object's `LastModified`, which has one-second resolution; a file landing
    within the deadline's final second counts as on time.
  - Tests use a separate `submissions-test` bucket; CI starts MinIO with `docker run` because the fork's image
    cannot be a service container (it needs `server /data`).

## D-031: App shell details settled in M08

- Date: 2026-10-12
- Decision (accepted from the M08 report during the overnight review, D-025):
  - Staff sidebar is a hand-built nav that becomes a Sheet below `md`, instead of the full shadcn Sidebar block
    (too heavy for five links). Supersedes that part of D-016.
  - Accent colour lives in one token, `--brand` (`#2f6b3f`), driving primary, ring and sidebar colours.
  - Dev dependencies `@testing-library/react`, `@testing-library/dom`, `@testing-library/user-event` accepted;
    `@tanstack/react-table` pinned to v8 (v9 changed its API and shadcn's pattern targets v8).
  - Every data page calls `requireStaffPage()` / `requireStudentPage()` itself (layouts don't re-run on client
    navigation); route handlers keep `requireStaff()` / `requireStudent()`.
  - Copy: late badge "Late · 2 days"; reason dialogs require 1–500 characters.
  - A "Change role" entry (clears the session, back to `/`) is added to M16.

## D-032: Student workflow details settled in M09

- Date: 2026-10-12
- Decision (accepted from the M09 report during the overnight review, D-025):
  - The Student ID year is the start year of the session chosen on the form (DB-015), not the creation date.
  - `yearOfStudy` cannot exceed the programme's `durationYears`.
  - Status changes: version conflict (409) is checked first, then whether the transition is allowed (422
    `BUSINESS_RULE`, `rule: "STATUS_TRANSITION"`, also for same-status requests), then a missing required reason
    (400 on the `reason` field).
  - A programme change returns a `PROGRAMME_CHANGED` warning; existing charges are never recalculated.
  - A PATCH that changes nothing returns the record without bumping `version`.
  - The duplicate check runs on create only, across all statuses; an email clash is reported first.
  - Fee states: "outstanding" = owes money but nothing is due yet; "overdue" is separate; no charges = "paid".
  - The fee-state filter loads charges/payments for the filtered set and applies the M04 rule in memory (~100 ms
    for 1,000 students). Fine for a registry of a few thousand; beyond ~10,000 it would move into a SQL view.

## D-033: Fees workflow details settled in M10

- Date: 2026-10-12
- Decision (accepted from the M10 report during the overnight review, D-025; schema items in DB-024):
  - Payments, adjustments and waivers are allowed for students of any status; a charge's session is the
    student's current session; adjustment/waiver due dates may be in the past (due immediately).
  - Warnings: `OVERPAYMENT` (payment larger than the balance, including when nothing is owed),
    `WAIVER_EXCEEDS_BALANCE` (waiver larger than the balance — allowed, becomes credit),
    `EXISTING_CHARGES_UNCHANGED` (on saving a fee schedule).
  - Business-rule names: `PAYMENT_ALREADY_VOIDED`, `FEE_INSTALMENT_IN_USE`.
  - Cash payments still need a reference: the dialog asks for the receipt number (e.g. `CASH-RCPT-0012`).
  - `/api/fees` lists every student whose fee state is not "paid", whatever their enrolment status, sorted by
    longest overdue first; `GET /api/programmes` and `/api/modules` return `{ items }` without paging.
  - A fee schedule has 1–12 instalments; `/staff/programmes` offers the previous, current and next two sessions.

## D-034: Dashboard definitions settled in M11

- Date: 2026-10-12
- Decision (accepted from the M11 report during the overnight review, D-025):
  - "Total outstanding" = sum of positive balances across all students, any status; credits are not netted off;
    includes money not yet due.
  - "Late submissions" = latest file arrived after the effective deadline, within a rolling 14 × 24 h window.
  - "Results to publish" counts every DRAFT mark (including non-submissions), plus withheld as a sub-figure.
  - Lists show at most 10 items with a `total` and a link to the full view (overdue list: longest overdue first;
    ties by larger amount). `GET /api/dashboard` takes no parameters.
  - Ageing is drawn as a hand-built segmented bar with a text legend (no chart library); Recharts is not used.

## D-035: Assessment details settled in M12

- Date: 2026-10-12
- Decision (accepted from the M12 report during the overnight review, D-025):
  - New badge group **Assessment: Open · Past deadline · Closed** ("Past deadline" = deadline passed but not
    closed, so late uploads are still accepted).
  - Warnings may carry optional `details`; `LATE_FLAGS_RECALCULATED` has `{changed, submissions}` and is returned
    on any real deadline change when the assessment has submissions (even if nothing flipped).
  - A deadline in the past is allowed with a `DEADLINE_IN_PAST` warning (staff may back-enter); deadlines are
    entered as date + time in Asia/Dhaka and stored in UTC.
  - Editing a closed assessment is allowed; close/reopen bump `version`; `ALREADY_CLOSED` / `NOT_CLOSED` are 422.
  - An assessment's module cannot change once it has submissions **or marks** (marks part added in M14).
  - "Eligible" = Enrolled students whose programme includes the module, plus anyone who already submitted
    (shown with a "no longer eligible" label). Lateness uses the latest file vs the effective deadline.
  - File downloads: staff, or the owning student whatever their status; anyone else gets 404.
  - Duplicate assessment titles within a module are allowed.

## D-036: Marksheet and results details settled in M14

- Date: 2026-10-12
- Decision (accepted from the M14 report during the overnight review, D-025):
  - Keyboard: Tab keeps its natural order (mark box → NS → next row) so every control stays reachable; Enter,
    Shift+Enter and ↑/↓ move between rows.
  - Marking a student not on the marksheet → 422 `STUDENT_NOT_ELIGIBLE`; marks are serialised with one decimal
    (`"70.0"`); updating an existing mark without `version` → 409.
  - Module change is blocked by any submission **or** mark: 422 `ASSESSMENT_HAS_ACTIVITY` with `{submissions, marks}`.
  - Publish preview "missing marks": assessment scope = every marksheet student; student scope = assessments past
    deadline or closed, plus any the student submitted to; explicit `markIds` = none.
  - Withhold/unpublish skip marks already in the target state (keeping their reasons), clear `publishedAt`, and
    return `{changed, skipped, markIds}`. Release history rows carry null old/new marks.
  - NS is classified `FAIL` in the API and shown as "NS" in the UI.
  - `/api/me/results` lists every assessment relevant to the student; anything not published is
    `{status: "NOT_AVAILABLE", assessment}`, so draft, withheld and unmarked look identical to the student.
  - "Withhold this student's results" on the student record is added to M16.
