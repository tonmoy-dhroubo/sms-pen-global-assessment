# Student Management System: Registry module

A Student Management System for the Registry team, built as a technical assessment for PEN Global. It covers the
everyday workflows of a Registry Administrator (student enrolment, fees and payments, assessment submission, and
marksheet and results) with a Staff view and a Student view.

**Status:** in development.

## Documentation

- [AGENTS.md](AGENTS.md): guidance for AI coding agents and humans working in this repository.
- [docs/](docs/): requirements, tech stack, decisions, milestone tracker and more.

## Development

Requires Node.js 24 (see `.nvmrc`) and npm.

```bash
npm ci
npm run dev
```

| Script                                | What it does                               |
| ------------------------------------- | ------------------------------------------ |
| `npm run dev` / `build` / `start`     | Next.js dev server, production build, start |
| `npm run lint`                        | ESLint                                     |
| `npm run typecheck`                   | `tsc --noEmit`                             |
| `npm run format` / `format:check`     | Prettier (write / check)                   |
| `npm test` / `npm run test:watch`     | Vitest unit tests                          |

Database and storage setup arrives with the later milestones; see [docs/milestones.md](docs/milestones.md).

The full README (run instructions, environment variables, demo tour and AI usage) is written at the end of the
project.
