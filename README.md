# Student Management System: Registry module

A Student Management System for the Registry team, built as a technical assessment for PEN Global. It covers the
everyday workflows of a Registry Administrator (student enrolment, fees and payments, assessment submission, and
marksheet and results) with a Staff view and a Student view.

**Status:** in development.

## Documentation

- [AGENTS.md](AGENTS.md): guidance for AI coding agents and humans working in this repository.
- [docs/](docs/): requirements, tech stack, decisions, milestone tracker and more.

## Run locally

> Draft: finalised at the end of the project.

Prerequisites:

- Node.js 24 (see `.nvmrc`) and npm
- Docker (Docker Desktop or Docker Engine with the Compose plugin)

```bash
cp .env.example .env     # local defaults work as-is
npm ci                   # install dependencies (also generates the Prisma client)
npm run services:up      # start Postgres + MinIO and wait until they are healthy
npm run db:reset         # create the tables and fill them with the demo data (see Demo data)
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

## Demo data

> Draft: the demo tour is finalised in M18, once every page exists.

`npm run db:reset` gives you the same registry every time: 3 staff, 3 programmes, 8 modules, 10 assessments and
30 students, with fees, payments, submissions (real PDF and DOCX files in the bucket) and marks. Every date is
relative to the moment you run it, in Asia/Dhaka time, so "overdue by 20 days" is true whenever you look. The
script ends with a self-check that recomputes the key facts below with the same rule functions the app uses and
fails loudly if they differ. It is destructive, so it refuses to run unless the database and the storage endpoint
are on this machine (`localhost`, `127.0.0.1`, `::1`); pass `--force` for anything else. `npm run db:seed` fills an
empty database without dropping anything. The full plan is in [db/seed-plan.md](db/seed-plan.md).

### Demo tour (draft)

Pick a person from the role picker, then look for these. "S" is the current session (for example 2026-27).

| To see... | Look at |
| --- | --- |
| The staff dashboard: 21 enrolled (3 deferred, 3 withdrawn, 3 completed), 8 overdue students split 1-30 / 31-60 / 60+ days, late submissions, results awaiting publication, withheld results | Staff: Kamrul Hasan, `/staff` |
| Overdue 1-30 days | Jannatul Ferdous (nothing paid), Mehjabin Sultana (15,000 short), Raisa Mahmud, Zubair Hasan |
| Overdue 31-60 days | Tanvir Hasan (paid 60,000 of instalment 1), Mahmud Karim (withdrawn, still owes 1,10,000) |
| Overdue 60+ days (oldest charge settled first) | Arif Hossain (S-1 balance unpaid), Habib Ullah (withdrew during S-1 owing 90,000) |
| Credit (overpayment, paid via bKash) | Nusrat Jahan |
| Outstanding but not yet due | Ayesha Rahman and Rakib Islam (instalment 2) |
| A voided payment, re-recorded | Sadia Chowdhury (Fees section) |
| Payment methods: bKash, Nagad, bank transfer | Nusrat Jahan, Sumaiya Haque (Nagad), Shakil Ahmed (bank transfer) |
| A tuition waiver (merit scholarship) | Tasnim Ahmed |
| Withdrawn with no debt, contrasted with Mahmud | Sabbir Hossain |
| Duplicate-student warning | New student: "Rafiqul Alam", date of birth 18 Apr 2006, with a different email |
| Deferred and withdrawn students cannot upload (and the page says why) | Student: Rakib Islam, Project Proposal (A5) |
| Open assessments with countdowns | Student: Moumita Das, Portfolio (A8, due in 2 days); Ayesha Rahman, Project Proposal (A5) |
| Replacing a file before the deadline, and file versions | Sadia Chowdhury, Project Proposal (A5); Tahmid Chowdhury, Essay 1 (A3, two versions) |
| Late by 5 hours / 2 days / 1 hour, never submitted | Rafiqul Alam and Tahsin Rahman and Tanvir Hasan on Essay 1; Shakil Ahmed on Case Study (A4); Farhana Akter on Lab Assignment 2 (A9); Zubair Hasan missing on Essay 1 |
| Past the deadline but still open (late uploads accepted) | Lab Assignment 2 (A9), as Tanvir Hasan |
| A closed assessment | Lab Assignment 1 (A1) |
| Non-submission (NS), and the rounding boundaries 39.5 / 59.4 / 69.5 | Sumaiya Haque (NS on A1; 39.5 on Quiz 1 passes); Lamia Khan (59.4 stays Pass); Shakil Ahmed (69.5 is Distinction) |
| Draft marks awaiting publication | Quiz 1 (A2), and the marked part of Essay 1 (A3) |
| Withheld results with a reason (staff see it, the student sees "Not yet available") | Tanvir Hasan (outstanding fees, A3); Arnab Saha (academic misconduct investigation, A7) |
| Results published although fees are overdue | Raisa Mahmud, Essay 1 |
| A published mark changed after an appeal, with its history | Fahim Rahman, Lab Assignment 1 (57.0 raised to 62.5) |
| A complete published marksheet | Completed students Imran Kabir, Ashraful Haque, Samira Siddiqui |

## Development

| Script                                | What it does                                |
| ------------------------------------- | ------------------------------------------- |
| `npm run dev` / `build` / `start`     | Next.js dev server, production build, start |
| `npm run lint`                        | ESLint                                      |
| `npm run typecheck`                   | `tsc --noEmit`                              |
| `npm run format` / `format:check`     | Prettier (write / check)                    |
| `npm test` / `npm run test:watch`     | Vitest unit tests                           |
| `npm run services:up` / `down` / `reset` | Local Docker services (see above) |
| `npm run db:migrate`                  | Create and apply a migration after editing `db/schema.prisma` (dev) |
| `npm run db:deploy`                   | Apply committed migrations (also what CI runs) |
| `npm run db:seed`                     | Fill an empty database and the bucket with the demo data, then self-check it |
| `npm run db:reset`                    | Drop the schema, migrate, empty the bucket and seed (local only; `--force` for anything else) |
| `npm run uploads:cleanup`             | Delete expired, never-confirmed upload URLs and their stray files (local only; `--force` for anything else) |
| `npm run db:generate` / `db:validate` | Regenerate the Prisma client / validate the schema |
| `npm run db:drift`                    | Fail if the database differs from `db/schema.prisma` |
| `npm run db:studio`                   | Prisma Studio, a browser UI for the data   |
| `npm run a11y`                        | axe-core accessibility check of 23 page states in light and dark (needs the production build running on port 3000 and a fresh `db:reset`; uses the installed Chrome or Edge, or `CHROME_PATH`) |
| `npm run responsive`                  | Opens every page at 375, 768 and 1280 px and reports any that scroll sideways; `-- --shots=dir` also saves PNGs |
| `npm run keyboard`                    | Walks five workflows with the keyboard only (changes demo data; `db:reset` afterwards) |
| `npm run e2e`                         | Payment -> student balance, upload -> staff view, mark and publish -> student result, in a real browser (changes demo data) |
| `npm run test:integration`            | API, database and storage tests against the throw-away `sms_test` database and `submissions-test` bucket (drops and re-creates the schema, empties the bucket, each run; needs `npm run services:up`) |

The full README (every environment variable explained, demo tour and AI usage) is written at the end of the
project.
