# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository.

## Project

Student Management System — **Registry module**, built as a technical assessment for PEN Global.
It covers the four everyday workflows of a Registry Administrator: student enrolment, fees & payments,
assessment submission, and marksheet & results, with a Staff view and a Student view.

## Stack (fixed — do not change)

- Next.js 14+ with the App Router
- PostgreSQL via Prisma ORM (`schema.prisma` is committed)
- Tailwind CSS + shadcn/ui
- TypeScript (strict), npm, S3-compatible file storage
- Two environments, differing only in env vars: local = Docker (Postgres + MinIO); hosted = Vercel + Neon + Supabase Storage — see [docs/tech-stack.md](docs/tech-stack.md)
- No other backend framework, and no mocked data in component state — everything reads from the real database
- Config comes from `.env`; only `.env.example` is committed, never credentials

## Documentation

This file stays short. All details, reasoning and discussion live in [`docs/`](docs/):

| Doc | What it holds |
| --- | --- |
| [docs/requirements.md](docs/requirements.md) | The brief in our own words: scope, deliverables, how it is graded |
| [docs/tech-stack.md](docs/tech-stack.md) | Agreed stack, local services, app layering, uploads and roles |
| [db/](db/README.md) | Database: ER diagram, DB decisions (`DB-NNN`), seed plan, and later the Prisma schema, migrations and seed scripts |
| [docs/milestones.md](docs/milestones.md) | **Build plan and tracker.** One milestone at a time; process, Definition of Done, report template |
| [docs/pages.md](docs/pages.md) | Every route: who sees it, what it shows, what you can do |
| [docs/api.md](docs/api.md) | API contract: conventions, error format, every endpoint |
| [docs/edge-cases.md](docs/edge-cases.md) | Checklist of edge cases and extras to build, by priority (Must / Should / Could) |
| [docs/decisions.md](docs/decisions.md) | Decision log: what we chose, why, and what we rejected |
| [docs/discussions.md](docs/discussions.md) | Open questions and discussion notes that are not yet decisions |
| [docs/ai-usage.md](docs/ai-usage.md) | Running log of how AI was used; feeds the README's AI section |

Read the relevant doc before starting work, and keep docs current as you go.

## Agents

Two Claude Code subagents are defined in `.claude/agents/`:

| Agent | Model | Use for |
| --- | --- | --- |
| `planner` | Opus 5.5, high effort | Decisions, discussion, design, and everything in `docs/`. Never writes app code. |
| `coder` | Sonnet 5.5, high effort | Code, schema, migrations, seed, config and tests. Implements recorded decisions; raises questions instead of deciding. |

## Working rules

- **Put details in `docs/`, not here.** Add a new doc when a topic outgrows an existing one, and link it in the table above.
- **Record decisions.** Any product or technical choice that is not obvious from the code (edge-case handling,
  schema shape, status rules, rounding, etc.) gets an entry in `docs/decisions.md`.
- **Park open questions.** Unresolved points go in `docs/discussions.md`; move them to `decisions.md` once settled.
- **Log AI usage.** Note meaningful AI contributions in `docs/ai-usage.md` — the README summary is built from it.
- **The original brief PDF is not committed** (it is marked not for distribution and is in `.gitignore`).
  Refer to `docs/requirements.md` instead, and do not paste the brief's text verbatim into the repo.
- **Commit and push often.** After each meaningful chunk of work, commit and push. Code goes through a branch and PR
  per milestone (`mNN-slug`, Conventional Commits, squash merge after the user approves); planning and docs-only
  changes may go straight to `main` (D-019).
- **Build one milestone at a time** following [docs/milestones.md](docs/milestones.md), then stop and report (D-021).
- **Next.js 16 docs ship with the package** in `node_modules/next/dist/docs/`; check them before relying on memory
  for Next.js APIs.
- Default branch is `main`.
