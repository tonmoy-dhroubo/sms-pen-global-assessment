# Student Management System: Registry module

A Student Management System for the Registry team, built as a technical assessment for PEN Global. It covers the
everyday workflows of a Registry Administrator (student enrolment, fees and payments, assessment submission, and
marksheet and results) with a Staff view and a Student view.

**Status:** in development.

## Documentation

- [AGENTS.md](AGENTS.md): guidance for AI coding agents and humans working in this repository.
- [docs/](docs/): requirements, tech stack, decisions, milestone tracker and more.

## Run locally

> Draft: finalised at the end of the project. Database migrations and seed data arrive in M03 and M07.

Prerequisites:

- Node.js 24 (see `.nvmrc`) and npm
- Docker (Docker Desktop or Docker Engine with the Compose plugin)

```bash
cp .env.example .env     # local defaults work as-is
npm ci                   # install dependencies
npm run services:up      # start Postgres + MinIO and wait until they are healthy
npm run dev              # http://localhost:3000
```

`services:up` starts three containers: `postgres` (databases `sms` and `sms_test`), `minio` (S3-compatible storage;
console at http://localhost:9001, login `minioadmin` / `minioadmin`) and `minio-init`, a one-shot container that creates
the private `submissions` bucket and then exits.

| Script                   | What it does                                                        |
| ------------------------ | ------------------------------------------------------------------- |
| `npm run services:up`    | Start the Docker services and wait until healthy                    |
| `npm run services:down`  | Stop them (data is kept)                                            |
| `npm run services:reset` | Stop them, **delete all data**, and start fresh                     |

The app checks `.env` when it starts and prints every missing or invalid variable if something is wrong. If a host
port (5432, 9000, 9001) is already in use, change it in `.env` (`POSTGRES_PORT`, `MINIO_API_PORT`,
`MINIO_CONSOLE_PORT`) together with the matching URL.

## Development

| Script                                | What it does                                |
| ------------------------------------- | ------------------------------------------- |
| `npm run dev` / `build` / `start`     | Next.js dev server, production build, start |
| `npm run lint`                        | ESLint                                      |
| `npm run typecheck`                   | `tsc --noEmit`                              |
| `npm run format` / `format:check`     | Prettier (write / check)                    |
| `npm test` / `npm run test:watch`     | Vitest unit tests                           |
| `npm run services:up` / `down` / `reset` | Local Docker services (see above) |

The full README (every environment variable explained, demo tour and AI usage) is written at the end of the
project.
