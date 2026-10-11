# AI usage log

The brief asks for a README section on how AI was used. Log meaningful AI contributions here as we go,
then summarise them in the README.

For each entry note: what the AI did, which tool, and what we reviewed, changed or rejected.

| Date | Tool | What it did | Human review / changes |
| --- | --- | --- | --- |
| 2026-10-11 | Claude Code | Initialised the git repo, set the remote, and moved the default branch to `main` | Branch naming chosen by me |
| 2026-10-11 | Claude Code | Drafted `AGENTS.md` and the `docs/` structure, including the requirements summary from the brief | Doc structure requested by me |
| 2026-10-11 | Claude Code | Proposed stack options and trade-offs; wrote up `docs/tech-stack.md` and D-003–D-010 | I chose npm, MinIO, local-only and the role switcher |
| 2026-10-11 | Claude Code | Compared hosted Postgres and free S3-compatible storage; flagged Vercel's upload size limit and proposed direct-to-bucket uploads (D-011–D-014) | I chose Docker + Neon and MinIO + Supabase Storage |
| 2026-10-11 | Claude Code | Set up two subagents: `planner` (Opus 5.5) for decisions and docs, `coder` (Sonnet 5.5) for code and tests (D-015) | Split and model choice were mine |
| 2026-10-11 | Claude Code | Compared component libraries and proposed the shadcn ecosystem plus status-badge conventions (D-016, D-017) | I required dark mode with a global toggle |
| 2026-10-11 | Claude Design | Minimal 3-screen mockup (staff dashboard, student record, student view): https://claude.ai/artifact/X9EoHwpdQfjU2QKody2Eyy | Under review |
| 2026-10-12 | Claude Code | Wrote the seed plan (30 personas), pages and routes, API contract, decisions D-018–D-024 and DB-015–DB-020, and the 20-milestone tracker | I set locale (Bangladesh, BDT), seed size, header role switcher and asked for milestone-by-milestone delivery; delegated the rest |
| 2026-10-12 | Claude Code (coder agent) | Implemented M00: line-ending/editor config, `.nvmrc`, `.gitignore`, PR template and README skeleton on branch `m00-repo-foundations` | Reviewed in the PR before merge |
| 2026-10-12 | Claude Code (coder agent) | Implemented M01: Next.js scaffold, strict TypeScript, ESLint + Prettier, Vitest, shadcn/ui, theming (next-themes), IBM Plex fonts and the CI workflow on branch `m01-nextjs-scaffold` | Reviewed in the PR before merge |
| 2026-10-12 | Claude Code (coder agent) | Implemented M02: Docker Compose (Postgres, MinIO, bucket init), `sms_test` init script, `.env.example`, Zod-validated `lib/env.ts` with a startup check, service scripts and the README "Run locally" draft on branch `m02-local-infrastructure`. Found that the official MinIO images are gone and that MinIO has no per-bucket CORS, and verified presigned cross-origin PUT/GET/HEAD with real requests | Reviewed in the PR before merge |
| 2026-10-12 | Claude Code (coder agent) | Implemented M03: Prisma 7 schema matching the ER diagram, first migration with hand-written SQL (check constraints, `unaccent`/`pg_trgm`, immutable wrapper, trigram index), `lib/db.ts` singleton, 42 database tests proving the constraints, and CI jobs for `prisma validate` and applying migrations to a Postgres service, on branch `m03-prisma-schema`. Hit Prisma's guard that blocks AI agents from running `migrate reset`, so the test setup uses `migrate deploy` instead of working around it | Reviewed in the PR before merge |
