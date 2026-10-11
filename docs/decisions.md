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
