# Student Management System: Registry module

A Registry module for a student management system, built as a technical assessment for PEN Global. It covers the four
everyday workflows of a Registry Administrator: **student enrolment** (records, unique `SMS-<year>-<seq>` IDs, status
changes with history), **fees and payments** (programme fee schedules, instalments, payments, waivers, voids, live
balances and overdue ageing), **assessment submission** (deadlines, direct-to-bucket PDF/DOCX uploads with receipts,
late flags, versions) and **marksheet and results** (marks 0-100 with classification, publish, withhold, appeals and
history). A **Staff view** and a **Student view** sit on top of the same data; a header role switcher stands in for
real authentication (the brief makes auth optional) while roles are still enforced on the server. Everything reads
from a real PostgreSQL database and real S3-compatible storage, and the seed fills it with 30 students built around
the edge cases a Registry team actually meets (see the [demo tour](#demo-tour)).

| Staff dashboard                                       | Student record (fees, overdue ageing)                   |
| ----------------------------------------------------- | ------------------------------------------------------- |
| ![Staff dashboard](docs/screenshots/readme/dashboard-light.png) | ![Student record](docs/screenshots/readme/student-record-light.png) |

| Publish preview with overdue-fee warning                              | Student submission with versions and receipt                   |
| --------------------------------------------------------------------- | -------------------------------------------------------------- |
| ![Publish preview](docs/screenshots/readme/publish-preview-light.png) | ![Student submission](docs/screenshots/readme/student-receipt-light.png) |

![Student overview in dark mode](docs/screenshots/readme/student-overview-dark.png)

_Dark mode is a global toggle in the header of both views. More screenshots per milestone are in
[docs/screenshots/](docs/screenshots/)._

## Contents

[Tech stack](#tech-stack) · [Run locally](#run-locally) · [Environment variables](#environment-variables) ·
[npm scripts](#npm-scripts) · [Demo tour](#demo-tour) · [Architecture](#architecture) · [Testing](#testing) ·
[How I used AI](#how-i-used-ai) · [Known limitations](#known-limitations) · [Documentation](#documentation)

## Tech stack

| Area      | Choice                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------- |
| Framework | Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind CSS v4, shadcn/ui, next-themes |
| Database  | PostgreSQL 18 via Prisma 7 (`db/schema.prisma` and migrations committed)                        |
| Files     | S3-compatible storage through the AWS SDK v3: MinIO in Docker locally (Supabase Storage planned for hosting); or plain files in a folder with `STORAGE_DRIVER=filesystem`, so Docker is optional |
| Forms     | react-hook-form + Zod, with the same Zod schemas validating the API                             |
| Tables    | TanStack Table v8                                                                               |
| Tests     | Vitest (+ Testing Library), real Postgres and MinIO for integration tests, axe-core, Chrome DevTools Protocol scripts |
| CI        | GitHub Actions                                                                                  |

Why each choice was made, and what was rejected: [docs/tech-stack.md](docs/tech-stack.md) and
[docs/decisions.md](docs/decisions.md) (40 decisions) plus [db/decisions.md](db/decisions.md) (26 database decisions).

## Run locally

Everything runs on your machine; no accounts are needed. There are two ways to run it: with Docker (Postgres and MinIO in
containers, below), or [without Docker](#run-without-docker) on a PostgreSQL you already have, keeping files in a folder.

**Prerequisites**

- **Node.js 24** (see `.nvmrc`; `package.json` requires `24.x`) and npm 11
- **Docker Desktop** (or Docker Engine with the Compose plugin), running
- Free ports **3000** (app), **5432** (Postgres), **9000** and **9001** (MinIO API and console). Each can be changed, see
  troubleshooting below.
- A current Chrome, Firefox or Edge. (The browser scripts under `npm run a11y` and friends need Chrome or Edge.)

**From a fresh clone**

```bash
git clone https://github.com/tonmoy-dhroubo/sms-pen-global-assessment.git
cd sms-pen-global-assessment

npm ci                    # install dependencies (also generates the Prisma client)
cp .env.example .env      # the defaults work as they are; on Windows PowerShell: Copy-Item .env.example .env
npm run services:up       # start Postgres + MinIO in Docker and wait until they are healthy
npm run db:reset          # create the tables, then fill them with the demo data and files
npm run dev               # http://localhost:3000
```

Open <http://localhost:3000>. You land on the **role picker**: choose a staff member (for example Kamrul Hasan) or search for
a student. That is the whole login.

**What to expect**

- `services:up` starts `postgres` (databases `sms` and `sms_test`), `minio` (console at <http://localhost:9001>, login
  `minioadmin` / `minioadmin`) and `minio-init`, a one-shot container that creates the private `submissions` bucket and
  exits. The first run downloads the images.
- `db:reset` drops and re-creates the schema, applies the migrations, empties the bucket, seeds, and finishes with a
  **self-check** that recomputes the key facts with the same rule functions the app uses ("Self-check passed", then a
  fingerprint line). It takes a few seconds.
- The app validates `.env` at start-up and prints every missing or invalid variable if something is wrong.
- `npm run dev` compiles each page the first time you open it, so the first visit is slower. For a production build
  use `npm run build && npm start`.

**Troubleshooting**

| Problem                                                              | Fix                                                                                                                                                                   |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Cannot connect to the Docker daemon` / `services:up` hangs          | Start Docker Desktop and wait until it says it is running, then retry.                                                                                                |
| A port is already in use (5432, 9000, 9001)                          | Change `POSTGRES_PORT`, `MINIO_API_PORT` or `MINIO_CONSOLE_PORT` in `.env` **and** the matching port in `DATABASE_URL`, `DIRECT_URL`, `TEST_DATABASE_URL` or `S3_ENDPOINT`; run `npm run services:up` again. |
| Port 3000 is busy                                                    | `npm run dev -- -p 3001`, and set `APP_ORIGIN="http://localhost:3001"` in `.env`, then `npm run services:up` so MinIO accepts uploads from that origin (its CORS is set from `APP_ORIGIN`). |
| Safari (or a browser that treats `http://localhost` as insecure) loops back to the role picker with `npm start` | The role cookie is `Secure` in production mode (D-029). Use `npm run dev`, or Chrome, Firefox or Edge, which accept it on `localhost`. |
| `db:reset` says it refuses to run                                    | It is destructive, so it only runs when the database and the storage endpoint are on this machine (`localhost`, `127.0.0.1`, `::1`). Pass `--force` only for a database you mean to wipe. |
| Uploads fail in the browser with a network or CORS error             | `APP_ORIGIN` in `.env` must be the exact origin you browse (scheme, host and port). Fix it and run `npm run services:up` to recreate MinIO with the new value.         |
| "Invalid environment variables" at start-up                          | You skipped `cp .env.example .env`, or edited a value; the message names each variable.                                                                               |
| Demo data looks stale or you tried the write flows                   | `npm run db:reset` restores the same registry (see [Demo data](#demo-data)).                                                                                          |
| You want a completely clean machine state                            | `npm run services:reset` deletes the Postgres and MinIO volumes and starts fresh; follow it with `npm run db:reset`. `npm run services:down` stops the containers and keeps data. |

### Run without Docker

If you have PostgreSQL but not Docker, set `STORAGE_DRIVER=filesystem`: uploaded files are then kept in a folder
(`./storage`) instead of MinIO. Everything else is identical (D-045).

**Prerequisites:** Node.js 24 and npm 11, and **PostgreSQL 14 or newer** running locally (14 and 18 were tested; the Docker
setup uses 18). The `unaccent` and `pg_trgm` extensions must be available: they ship with PostgreSQL itself, but on
Debian/Ubuntu they are in the separate `postgresql-contrib` package (the Windows and macOS installers, Homebrew and the
official `postgres` Docker images include them). The migrations run `CREATE EXTENSION` for both, so the database user must
be a superuser or, on PostgreSQL 13 and newer, the owner of the database (both extensions are marked trusted). `db:reset`
also drops and re-creates the `public` schema, so that user must own it (a superuser does; otherwise see the `ALTER SCHEMA`
lines below, which PostgreSQL 14 needs and 15 and newer do not).

```bash
# 1. A database user and the two databases (run as a PostgreSQL superuser; adjust the user name to your install)
psql -U postgres -c "CREATE ROLE sms LOGIN PASSWORD 'sms'"
psql -U postgres -c "CREATE DATABASE sms OWNER sms"
psql -U postgres -c "CREATE DATABASE sms_test OWNER sms"     # only needed for npm run test:integration
psql -U postgres -d sms -c "ALTER SCHEMA public OWNER TO sms"            # PostgreSQL 14: the new user must own the schema
psql -U postgres -d sms_test -c "ALTER SCHEMA public OWNER TO sms"

# 2. The app
git clone https://github.com/tonmoy-dhroubo/sms-pen-global-assessment.git
cd sms-pen-global-assessment
npm ci
cp .env.example .env      # on Windows PowerShell: Copy-Item .env.example .env
```

Then edit `.env`: uncomment `STORAGE_DRIVER="filesystem"`, and if your PostgreSQL is not on port 5432 or the user or
password differ, change the port or credentials in `DATABASE_URL`, `DIRECT_URL` and `TEST_DATABASE_URL`. Leave the `S3_*` lines
alone; they are ignored.

```bash
npm run db:reset          # create the tables, then fill them with the demo data and files (written to ./storage)
npm run dev               # http://localhost:3000
```

"What to expect" above and the [demo tour](#demo-tour) apply unchanged. Uploads go to `PUT /api/uploads/{token}` on the app
itself (a signed, 15-minute, one-file link standing in for an S3 presigned URL) and downloads stream through a similar signed
link, so there is no CORS to set up. `./storage` is gitignored; `db:reset` empties and refills it, and the app refuses a
`FILE_STORAGE_DIR` that already holds other files. `STORAGE_DRIVER=filesystem npm run test:integration` runs the integration
suite (PowerShell: `$env:STORAGE_DRIVER="filesystem"; npm run test:integration`) against a scratch folder (`./storage-test`) with no MinIO.

| Problem                                                             | Fix                                                                                                                            |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `extension "unaccent" is not available`                             | Install the contrib package (Debian/Ubuntu: `sudo apt install postgresql-contrib`).                                            |
| `must be owner of schema public` (`db:reset`)                      | PostgreSQL 14: `ALTER SCHEMA public OWNER TO sms` in each database (the two lines above).                                      |
| `permission denied to create extension`                             | Use a superuser, or make the user the database owner (`ALTER DATABASE sms OWNER TO sms`; PostgreSQL 13+).                      |
| `... is not empty and was not created by this app`                  | Point `FILE_STORAGE_DIR` at a new or empty folder.                                                                             |

## Environment variables

Copy `.env.example` to `.env`. The values below are exactly the ones in `.env.example`; the app's own variables are
validated by `lib/env-schema.ts` when it starts. Only `.env.example` is committed.

| Variable               | Required?                               | Default (local)                                  | What it does                                                                                                                       |
| ---------------------- | --------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`         | Yes                                     | `postgresql://sms:sms@localhost:5432/sms`        | The app's PostgreSQL connection. Hosted (Neon): the pooled connection string.                                                      |
| `DIRECT_URL`           | No (falls back to `DATABASE_URL`)       | same as `DATABASE_URL`                           | Connection used by Prisma migrations and `db:reset`. Hosted (Neon): the direct, non-pooled URL.                                    |
| `TEST_DATABASE_URL`    | Only for `npm run test:integration`     | `postgresql://sms:sms@localhost:5432/sms_test`   | A separate database (created by `docker/postgres/init`) that the integration tests drop and re-create. The harness refuses any name not ending in `_test`. |
| `STORAGE_DRIVER`       | No                                      | `s3` (commented out in `.env.example`)           | `s3` (MinIO or any S3-compatible service; the default) or `filesystem` (files in `FILE_STORAGE_DIR`, no Docker; see [Run without Docker](#run-without-docker)). |
| `FILE_STORAGE_DIR`     | No (`filesystem` driver only)           | `./storage`                                      | Folder for uploaded files, relative to the project root. Created on first use; must be new or empty (or one this app created).     |
| `S3_ENDPOINT`          | With `STORAGE_DRIVER=s3`                | `http://localhost:9000`                          | Where the Next.js server reaches the storage service.                                                                              |
| `S3_PUBLIC_ENDPOINT`   | No                                      | empty                                            | Host embedded in presigned URLs for the browser. Leave empty when the browser can reach `S3_ENDPOINT` (as locally).                |
| `S3_REGION`            | With `STORAGE_DRIVER=s3`                | `us-east-1`                                      | Region passed to the S3 client (MinIO ignores the value but the SDK needs one).                                                    |
| `S3_BUCKET`            | With `STORAGE_DRIVER=s3`                | `submissions`                                    | Private bucket for submission files. Created by `minio-init` (and by the seed if missing).                                         |
| `S3_ACCESS_KEY_ID`     | With `STORAGE_DRIVER=s3`                | `minioadmin`                                     | Storage access key. Locally it is also MinIO's root user in `docker-compose.yml`.                                                  |
| `S3_SECRET_ACCESS_KEY` | With `STORAGE_DRIVER=s3`                | `minioadmin`                                     | Storage secret key; MinIO's root password locally. Development value only.                                                         |
| `S3_FORCE_PATH_STYLE`  | No                                      | `true`                                           | `true` puts the bucket in the URL path instead of the host name. Correct for both MinIO and Supabase.                              |
| `APP_TIMEZONE`         | No                                      | `Asia/Dhaka`                                     | IANA time zone used to show dates and judge deadlines, "today" and overdue (D-018).                                                |
| `SESSION_SECRET`       | Yes (at least 32 characters)            | a development placeholder                        | Signs the role cookie (HMAC). Generate a real one for anything hosted: `openssl rand -base64 48`.                                  |
| `MAX_UPLOAD_MB`        | No                                      | `20`                                             | Largest submission file in whole megabytes; larger files are rejected before upload and again at confirm time.                     |
| `DEMO_MODE`            | No                                      | `false`                                          | `true` shows the "Demo environment" banner (for the hosted demo).                                                                  |
| `POSTGRES_USER`        | Docker Compose only (default `sms`)     | `sms`                                            | Postgres container user. Keep in sync with the credentials in `DATABASE_URL`.                                                      |
| `POSTGRES_PASSWORD`    | Docker Compose only (default `sms`)     | `sms`                                            | Postgres container password. Keep in sync with `DATABASE_URL`.                                                                     |
| `POSTGRES_DB`          | Docker Compose only (default `sms`)     | `sms`                                            | Name of the main database the container creates.                                                                                   |
| `POSTGRES_PORT`        | Docker Compose only (default `5432`)    | `5432`                                           | Host port for Postgres. If you change it, change the URLs above.                                                                   |
| `MINIO_API_PORT`       | Docker Compose only (default `9000`)    | `9000`                                           | Host port for the MinIO S3 API. If you change it, change `S3_ENDPOINT`.                                                            |
| `MINIO_CONSOLE_PORT`   | Docker Compose only (default `9001`)    | `9001`                                           | Host port for the MinIO web console.                                                                                               |
| `APP_ORIGIN`           | Docker Compose only (default `http://localhost:3000`) | `http://localhost:3000`            | The browser origin MinIO allows to `PUT`/`GET`/`HEAD` presigned URLs (server-wide CORS). Must match where you open the app.        |

## npm scripts

| Script                                                       | What it does                                                                                                          |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `npm run dev` / `build` / `start`                            | Next.js dev server, production build, production server                                                               |
| `npm run lint` / `typecheck` / `format` / `format:check`     | ESLint, `tsc --noEmit`, Prettier (write / check)                                                                      |
| `npm test` / `test:watch`                                    | Unit and component tests (Vitest), no services needed                                                                 |
| `npm run test:coverage`                                      | Unit tests with coverage; fails if `lib/services/rules` drops below 95 %                                              |
| `npm run test:integration`                                   | API, database and storage tests against the throw-away `sms_test` database and `submissions-test` bucket (needs `services:up`). `STORAGE_DRIVER=filesystem npm run test:integration` runs the same suite on a scratch folder, no MinIO |
| `npm run services:up` / `down` / `reset`                     | Start the Docker services, wait until healthy and create the bucket / stop them (data kept) / **delete all data** and start fresh        |
| `npm run db:reset`                                           | Drop the schema, migrate, empty the bucket and seed with a self-check (local only; `--force` for anything else)       |
| `npm run db:seed`                                            | Fill an **empty** database and the bucket with the demo data (refuses a populated database)                           |
| `npm run db:migrate`                                         | Create and apply a migration after editing `db/schema.prisma` (development)                                           |
| `npm run db:deploy`                                          | Apply the committed migrations (what CI runs)                                                                         |
| `npm run db:generate` / `db:validate` / `db:drift`           | Regenerate the Prisma client / validate the schema / fail if the database differs from `db/schema.prisma`             |
| `npm run db:studio`                                          | Prisma Studio, a browser UI for the data                                                                              |
| `npm run uploads:cleanup`                                    | Delete expired, never-confirmed upload URLs and their stray files (local only; `--force` for anything else)           |
| `npm run er:png`                                             | Re-render `db/er-diagram.md` to `db/er-diagram.png` (Chrome or Edge, internet needed for the Mermaid library)         |
| `npm run a11y`                                               | axe-core check of 23 page states in light and dark. Needs `db:reset`, `build` and `start` running on port 3000; uses the installed Chrome or Edge (or `CHROME_PATH`) |
| `npm run responsive`                                         | Opens every page at 375, 768 and 1280 px and reports any that scroll sideways (`-- --shots=dir` also saves PNGs)      |
| `npm run keyboard`                                           | Walks five workflows with the keyboard only (changes demo data: `db:reset` afterwards)                                |
| `npm run e2e`                                                | Payment -> student balance, upload -> staff view, mark and publish -> student result, in a real browser (changes demo data) |

## Demo tour

### Demo data

`npm run db:reset` gives you the same registry every time: 3 staff, 3 programmes, 8 modules, 10 assessments and
30 students, with 76 fee charges, 69 payments, 78 submissions (real PDF and DOCX files in the bucket), 54 marks and 28
mark changes. **Every date is relative to the moment you run the seed**, in Asia/Dhaka time, so "overdue by 20 days"
is true whenever you look. (A few days later "due in 2 days" will have passed; run `db:reset` again to refresh it.)
The persona plan is in [db/seed-plan.md](db/seed-plan.md); the seed's self-check fails loudly if the data and the
plan disagree.

How to read the tour: choose the role on the first column from the role picker at `/` (the header's _Viewing as_
menu switches without going back, and **Change role** returns to the picker). Staff can find any student with the header
search or `Ctrl+K`. "S" in the plan means the current academic session (2026-27 at the time of writing). The
assessments are referred to by title; their plan codes (A1-A10) are in brackets.

**Start here (Staff: Kamrul Hasan, `/staff`).** The dashboard shows 21 enrolled students (3 deferred, 3 withdrawn, 3
completed), ৳17,55,000 outstanding across 10 students, **8 overdue students** (4 at 1-30 days, 2 at 31-60, 2 at 60+),
5 recent late submissions, 27 draft marks awaiting publication in two assessments, and 2 withheld results.

### Fees and payments

| To see...                                                  | Sign in as / open                                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Overdue 1-30 days**                                      | Staff > Fees. Jannatul Ferdous (nothing paid, 20 days), Raisa Mahmud (20 days), Mehjabin Sultana (only ৳15,000 short, 20 days), Zubair Hasan (10 days) |
| **Overdue 31-60 days**                                     | Tanvir Hasan (paid ৳60,000 of instalment 1, 40 days); Mahmud Karim (see "withdrawn debtor")                               |
| **Overdue 60+ days; oldest charge settled first** (D-028)  | Arif Hossain (285 days: last session's shortfall is still unpaid and nothing was paid this session); Habib Ullah (375 days) |
| **Withdrawn debtor stays on the overdue list**             | Mahmud Karim (withdrawn, owes ৳1,10,000) and Habib Ullah. Contrast: Sabbir Hossain withdrew with no debt                  |
| **Credit (overpayment)**                                   | Nusrat Jahan: paid ৳5,000 too much via bKash, so a credit shows instead of a balance                                      |
| **Outstanding but not yet due**                            | Ayesha Rahman and Rakib Islam (instalment 2 falls due in about 80 days)                                                   |
| **Voided payment, re-recorded**                            | Sadia Chowdhury > Fees > Payments: a struck-through ৳1,06,000 "Wrong amount entered" and the corrected payment (the student never sees voided rows) |
| **Waiver**                                                 | Tasnim Ahmed: a ৳40,000 merit-scholarship waiver in the charges table                                                    |
| **Payment methods**                                        | bKash (Nusrat Jahan), Nagad (Sumaiya Haque), bank transfer (Shakil Ahmed, Tanvir Hasan)                                    |
| **What the student sees**                                  | Student: Tanvir Hasan. The overview and Fees tab say "Overdue by 40 days. Please contact the Registry office." (no ageing bucket, no staff names) |
| **Record a payment**                                       | Staff > Fees (or the dashboard) > Record payment. A payment larger than the balance warns; a reference reused by another payment is refused and points at the existing one |

### Enrolment

| To see...                                      | Sign in as / open                                                                                                                       |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Duplicate-student warning**                  | Staff > Students > New student: name "Rafiqul Alam", date of birth 18 Apr 2006, a different email, programme BBA. The dialog lists the existing record and offers "Create anyway" |
| **Search and filters**                         | Staff > Students: search is case- and accent-insensitive and matches partial IDs; filters are kept in the URL. Withdrawn and Completed are hidden until the status filter includes them |
| **Status changes and history**                 | Open any record > Change status: only allowed transitions are offered, with a reason where one is required. See them in the Activity timeline |
| **Deferred, withdrawn and completed students** | Rakib Islam, Nadia Islam, Priyanka Roy (deferred); Mahmud Karim, Sabbir Hossain, Habib Ullah (withdrawn); Imran Kabir, Ashraful Haque, Samira Siddiqui (completed, with full published marksheets) |

### Submissions

| To see...                                                      | Sign in as / open                                                                                                       |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Countdowns on open assessments**                             | Student: Moumita Das > Assessments > Portfolio (A8, due in 2 days); Ayesha Rahman > Project Proposal (A5)               |
| **Replace a file before the deadline; versions**               | Student: Sadia Chowdhury > Project Proposal (A5): two versions, "Upload replacement" still enabled                      |
| **On-time lock after the deadline; versions with receipts**    | Student: Tahmid Chowdhury > Essay 1 (A3): two versions, both before the deadline, so the replace button is disabled with the reason. Each version has its own time, size and SHA-256 receipt |
| **Late by 5 hours, 2 days and 1 hour**                         | Staff > Assessments > Essay 1 (A3): Rafiqul Alam (5 hours), Tahsin Rahman and Tanvir Hasan (2 days); Case Study (A4): Shakil Ahmed (1 hour); Lab Assignment 2 (A9): Farhana Akter (5 hours). Never submitted: Zubair Hasan on Essay 1 |
| **Past the deadline but not closed: late uploads accepted**    | Student: Tanvir Hasan > Lab Assignment 2 (A9). Upload any PDF or DOCX; it is accepted and flagged late (changes demo data) |
| **A closed assessment**                                        | Lab Assignment 1 (A1) and Reading Response (A7): closed assessments accept no upload at all                             |
| **Deferred and withdrawn students cannot upload**              | Student: Rakib Islam > Project Proposal (A5): the page says why. The same rule is enforced by the API                   |
| **Bad files rejected by content, not by name**                 | As any enrolled student on an open assessment, upload a `.txt` renamed to `.pdf`, an empty file, a `.docm`, or one over `MAX_UPLOAD_MB`: each is refused with a plain explanation |
| **Non-ASCII file name survives download**                      | Staff > Assessments > Portfolio (A8) > Submissions: Moumita Das's file is `পোর্টফোলিও.pdf`; download it                    |
| **The same submissions on the student record**                 | Staff > any student > Submissions section: exactly what the student sees, including late-by and receipts                |

### Marks and results

| To see...                                                      | Sign in as / open                                                                                                       |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Non-submission (NS) is not a zero**                          | Staff > Assessments > Lab Assignment 1 (A1) > Marksheet: Sumaiya Haque is "NS"                                          |
| **Classification boundaries (round half-up first, DB-019)**    | Staff > Quiz 1 (A2) > Marksheet: Sumaiya Haque 39.5 -> Pass; Shakil Ahmed 69.5 -> Distinction; Lamia Khan 59.4 stays Pass |
| **Late work is visible while marking, no automatic penalty**   | Marksheet of Essay 1 (A3) shows the late badge next to Tanvir Hasan's and Tahsin Rahman's rows                          |
| **Draft marks awaiting publication**                           | Quiz 1 (17 marks) and Essay 1 (10 marks); the dashboard's "Marks waiting to be published"                               |
| **Publish preview with overdue-fee warning (never a block)**   | Staff > Quiz 1 > Marksheet > Publish: "Publish 17 marks - 6 students have overdue fees", listing each student and amount. On Essay 1: "Publish 11 marks - 3 students have overdue fees, 6 marks missing". Cancel to leave it unpublished |
| **Withheld: fees vs misconduct**                               | Tanvir Hasan, Essay 1: withheld for "Outstanding fees"; Arnab Saha, Reading Response (A7): "Academic misconduct investigation". Staff see the reason; as the student, Results shows "Not yet available" with no mark and no reason |
| **Published although fees are overdue**                        | Raisa Mahmud, Essay 1 (staff saw the warning and published)                                                             |
| **Mark changed after an appeal, with history**                 | Staff > Fahim Rahman > Results > Lab Assignment 1: 57.0 raised to 62.5 with the reason; expand the history. Changing any published mark requires a reason |
| **Withhold or unpublish with a reason**                        | Marksheet: select rows > Withhold / Unpublish; or the student record's Results card                                      |
| **A student's published results**                              | Student: Moumita Das (82.5 on Reading Response) or Ayesha Rahman (Distinction marks)                                    |

### Everything else

| To see...                         | Where                                                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Activity timeline**             | Any staff student record: status changes, charges, payments, voids, submissions, mark changes and releases, newest first |
| **Quick search**                  | `Ctrl+K` (or `Cmd+K`) in the staff header, type "tanvir" and press Enter                                                  |
| **CSV exports and print**         | Export buttons on Staff > Fees and the Marksheet; print the student record (fee statement) or the marksheet            |
| **Role separation**               | As a student, open `/staff` (sent back to the role picker) or call a staff API such as `/api/students` (403); try another student's id (404) |
| **Dark mode, phone width**        | Theme toggle in the header; narrow the window to 375 px and tables fold their secondary columns into the first cell                                  |

## Architecture

```
app/                      pages (Server Components) and app/api/* Route Handlers (38 routes)
  └─ calls ─▶ lib/services/   business rules: balances, ageing, deadlines, classification, student IDs, publish
                 ├─ rules/    pure functions (no database, no clock): unit-tested to 100 %
                 └─ uses ─▶ lib/db (Prisma), lib/storage (S3 / MinIO)
```

- **Reads** go from Server Components straight to `lib/services`; **writes** go through Route Handlers in `app/api/`,
  which validate with Zod (the same schemas the forms use), check the role, then call a service (D-005). Business rules
  live only in `lib/services`, so they are testable without HTTP or a browser.
- **Errors** share one JSON shape: `400` with per-field issues, `401`/`403` for roles, `404` for missing (and for another
  student's) records, `409` for conflicts such as a stale `version`, `422` for business rules; every response carries a
  request id.
- **Roles**: the switcher sets an HTTP-only cookie signed with HMAC (`SESSION_SECRET`). `proxy.ts` guards `/staff` and
  `/student`; every Route Handler and page re-verifies the role and that the record still exists. A test discovers every
  route and fails if one is missing from the reviewed access list.
- **Uploads** never pass through the app server (D-013): (1) the browser asks for an upload URL; the server checks the
  role, the student's status, the deadline and the file type and size, and returns a short-lived presigned `PUT` for a
  key it chose (a staging key under `pending/`); (2) the browser uploads straight to the private bucket; (3) the
  browser calls confirm; the server checks the size, copies the object inside storage to a final key no URL can write
  (D-042), then checks the copy's magic bytes (PDF; DOCX with `word/document.xml`, macro-enabled files rejected),
  computes its SHA-256, takes the arrival time as the submission time (D-023) and records the next version number in
  one transaction. A later PUT to the still-valid upload URL therefore cannot change a confirmed file.
  Downloads are presigned `GET`s issued after a permission check.
- **Derived values** (balance, overdue, late, classification) are calculated by the services, never stored, so they
  cannot drift (see [db/README.md](db/README.md)). Money is `Decimal`/`numeric(12,2)`, times are UTC shown in Asia/Dhaka.

Details: [docs/api.md](docs/api.md) (the API contract), [docs/pages.md](docs/pages.md) (every screen),
[db/er-diagram.md](db/er-diagram.md) (tables and relationships, also as an image:
[db/er-diagram.png](db/er-diagram.png)) and [docs/tech-stack.md](docs/tech-stack.md).

![ER diagram](db/er-diagram.png)

## Testing

| Suite                    | Command                    | Size on a fresh run                  | Covers                                                                                                                                      |
| ------------------------ | -------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit and component       | `npm test`                 | 1,100 tests in 60 files (about 25 s) | Domain rules (money, Dhaka time, student IDs, status matrix, fee ageing, deadlines, upload rules, marks and boundaries, publish preview), Zod schemas, session cookie, CSV, env validation, seed helpers, jsdom tests for forms, dialogs, the marksheet grid and the timeline |
| Rules coverage gate      | `npm run test:coverage`    | 100 % lines and branches on `lib/services/rules` (gate: 95 %) | The pure rule functions                                                                                                      |
| Integration              | `npm run test:integration` | 805 tests in 30 files (about 2 min); the same suite also runs with `STORAGE_DRIVER=filesystem` (812 tests, no MinIO) | Real PostgreSQL and MinIO (or a scratch folder): schema constraints, every endpoint, access control for every route, the upload edge cases with real presigned PUTs, races (simultaneous payments, voids, confirms, Student IDs), query counts, the seed and the dashboard figures |
| Accessibility            | `npm run a11y`             | 0 axe violations on 23 page states, light and dark | Run against a production build                                                                                                |
| Responsive, keyboard, e2e | `npm run responsive` / `keyboard` / `e2e` | scripts | No page scrolls sideways at 375/768/1280 px; five workflows by keyboard alone; three staff/student hand-offs in a real browser          |

Time-zone independence is tested by running the unit tests under two zones in CI.

**CI** (`.github/workflows/ci.yml`, on every pull request and push to `main`) has five jobs: _check_ (`prisma validate`, lint, type-check, Prettier,
tests, production build); _unit tests and coverage_ under `TZ=UTC` and `TZ=America/New_York`; _migrations_ (applied twice
to an empty database, then a drift check against `db/schema.prisma`); _integration tests_ (Postgres service container and
MinIO); and _seed_ (reset twice, refuse a populated database, identical content fingerprint).

## How I used AI

AI wrote the application code in this repository. My job was product owner, decision-maker and reviewer, and the process
was designed so that every choice and every AI contribution leaves a trace. The running log is
[docs/ai-usage.md](docs/ai-usage.md) (one row per piece of work); this section is its summary.

**Tools.** [Claude Code](https://claude.com/claude-code) (desktop app) throughout, with **Claude Opus 5.5** as the main
session, and two subagents defined in [`.claude/agents/`](.claude/agents/): a **`planner`** (Opus 5.5, high effort) for
decisions, trade-offs and everything in `docs/`, which never writes app code, and a **`coder`** (**Claude Sonnet 5.5**, high
effort) that implements recorded decisions, writes tests, and raises questions instead of deciding. In practice the
planning conversation happened with the main session directly (it had all the context), so the `planner` agent was
defined but not used; every milestone was built by a fresh `coder` agent. **Claude Design**
produced a three-screen mockup (staff dashboard, student record, student view) used as a layout reference only.
**OpenAI Codex** did an independent whole-system code review, so the code was not judged only by the model that wrote it.
The open-source **[impeccable](https://github.com/pbakaus/impeccable)** design skill was used as dev-time tooling for a
final UI review. It was installed on my machine only, so nothing from it is in this repository.

**Workflow.**

1. **Decide and write down first.** Before any code there were the requirements summary, the tech stack, an edge-case
   checklist with Must/Should/Could priorities, a database design with its own decision log, a 30-persona seed plan, the
   API contract, the page list and a 20-milestone tracker. Choices that were not obvious from code went into
   [docs/decisions.md](docs/decisions.md) (44 decisions) and [db/decisions.md](db/decisions.md) (27), with the
   alternatives that were rejected. The coder is told that decisions are settled and to stop and ask when the docs
   do not cover behaviour, so product decisions did not leak into code.
2. **One milestone, one branch, one PR.** Every built milestone (`M00` to `M20`; M19 hosting is deferred) was a
   branch (`mNN-slug`), a Conventional-Commit history, a PR from a template with a verification table and screenshots,
   and a CI run (lint, type-check, format, unit, coverage, migrations, integration, seed). The coder stopped after each report; nothing was built in one shot.
3. **Review loop.** The main session reviewed each milestone PR against its acceptance criteria and the Definition of
   Done, requested changes, and recorded what the report revealed as new decisions (D-026 to D-044, DB-021 to DB-027).
4. **Verification by running things.** The coder was expected to run the real app, not just the tests: screenshots were
   captured from headless Chrome and the seed ends with a self-check against the plan.
5. **A second model reviews the first.** Once the build was feature-complete, I had OpenAI Codex review the whole
   system independently ([docs/code-reviews/](docs/code-reviews/)). Claude checked every finding against the code before
   accepting it (D-042). All seven were real, and they were fixed in their own milestone, M18R. Each fix came with a
   regression test that was written first and confirmed to fail on the old code (D-043).
6. **A design pass at the end.** M20 used the impeccable skill to look for the generic "AI-generated" look. A detector
   ran on the source and on every rendered page at desktop and phone width, alongside a screenshot review in both
   themes. The boundary was fixed in advance (D-044): stay inside shadcn/ui, which the brief prefers; no new
   dependencies, fonts or colours; no behaviour change. Every finding and its outcome is in
   [docs/ui-review.md](docs/ui-review.md).

**What I decided, and what I delegated.**

- Mine: the stack (npm, Docker with MinIO, Neon and Supabase Storage for hosting later, the shadcn ecosystem), dark mode
  with a global toggle, Bangladesh locale (Asia/Dhaka, BDT with lakh grouping), the seed's size and shape, the header
  role switcher instead of real auth, the planner/coder split and model choice, milestone-by-milestone delivery with a
  PR each, the PNG of the ER diagram, and keeping the community MinIO images when the official ones disappeared (D-027).
  I also chose to let work continue overnight (D-025): the main session reviewed and squash-merged milestone PRs once CI
  and the acceptance criteria were green. When I came back I read the status summary and the open questions,
  answered them, and told it to keep going (D-039). Every merged PR keeps its report, verification table and CI run, so
  any of that work can be audited after the fact.
  <!-- TODO(Dhrubo): say in your own words what you reviewed yourself after coming back (PRs, decisions D-025 to D-041). -->
- Also mine: commissioning the independent code review and fixing every finding before submission rather than arguing
  severity (D-042), and running the final UI pass inside a fixed boundary (D-044).
- Delegated to the AI, then accepted: library choices inside the shadcn ecosystem, the edge-case priorities (D-024),
  the status-badge conventions, database details such as keys, audit columns and indexes, and the many technical
  decisions recorded from milestone reports (D-026 to D-041, D-043).

**Where AI output was corrected or rejected.**

- _M01 review:_ the Next.js 16 scaffold led to a recorded decision that Cache Components stay off because every page is
  per-user and dynamic, and that agents consult the version-matched docs bundled with Next.js 16 instead of relying on
  memory (D-026).
- _M02:_ the official MinIO images turned out not to be published any more; the coder verified that and proposed the
  community fork, and MinIO's lack of per-bucket CORS meant CORS had to be set server-wide (D-027). I confirmed the fork.
- _M10 review:_ the review asked for who-did-what audit columns (`payments.voided_by_id`, `fee_charges.created_by_id`), a
  partial unique index so a voided payment frees its reference number, and a warning when a waiver exceeds the balance;
  they landed as a second commit and migration on the same PR (DB-024, D-033).
- _M12 and M14:_ the rule that an assessment's module cannot change was extended from "has submissions" to "has submissions
  or marks" (D-035, D-036).
- _M16:_ the review found the Submissions section of the staff student record still a "Coming in M13" placeholder; it was
  added to M17 as a named gap and delivered there (D-038).
- _Defects the AI found in its own work by running it:_ table sort buttons that never rendered (M09, caught in M10),
  clipped "Record payment" buttons and amounts hidden at 375 px (M11), real contrast and heading problems found by the axe
  run (M17), a seed ordering bug caught by the seed's self-check on an early-July run date (M07), lateness assertions that
  needed slack because storage stamps whole seconds (M13), and a stale server that looked like a layout bug (M17). One AI
  slip survived to review: a rename that damaged strings in the assessment integration tests, fixed within the same PR.
- _Checked rather than trusted:_ `Intl` on Node 24 cannot produce `৳1,25,000.00` or "Sep", so lakh grouping and month names
  are hand-written and covered by tests (M04). A test caught that stripping all Unicode combining marks would corrupt
  Bengali names.
- _Guard respected:_ Prisma blocks `migrate reset` for AI agents. The coder did not work around it; the reset and the test
  harness drop the schema themselves and run `migrate deploy`, and both refuse any non-local or non-`_test` database.
- _Scope cut on purpose:_ per-student deadline extensions (a Could item) were dropped in M17 rather than half-built;
  the schema and rules support them, but no endpoint or screen creates one (D-040).
- _Found by the independent review, missed by the Claude pipeline (M18R):_
  - Two defects threatened submitted files. A student could reuse a still-valid upload link to replace a file after it
    had been confirmed. The cleanup script could also race a confirm and delete a confirmed file. Confirmed uploads are
    now copied to a server-only key that no upload link can write.
  - Fee ageing kept counting a charge that a waiver had already cleared.
  - File versions were ordered by a nudged timestamp instead of a real version number.
  - Two client components kept stale data after the server refreshed.
  - There was a heading-nesting error. Component tests now fail on any React console error, so a hydration problem
    can't pass silently again.

  All of these sat in the gaps between our tests. That showed where the suite was blind, not just what was broken.
- _M20 UI review:_ the automated detector found almost nothing on this codebase. Most of the value came from reviewing
  the screenshots: a header label that wrapped, boxes nested inside boxes, and a timer still labelled "Time left" after
  the deadline. Of 16 findings, 8 were fixed and 8 were waived, each waiver with its reason. One attempted fix made a
  table scroll sideways, so it was reverted and waived. The same milestone found a date-dependent integration test that
  only failed once the real clock passed a pinned date. It would have failed CI on every branch, and it was fixed.

**Limitations and risks I noticed.**

- Most milestone PRs were reviewed by the main Claude session rather than line by line by me. I relied on CI, the
  integration tests that hit real services, the seed self-check and the accessibility, keyboard and responsive scripts,
  and I did not independently re-verify every claim in the reports.
- The process had a couple of slips: a usage-limit interruption part-way through the build (the tracker and one-PR-per-
  milestone made resuming simple) and a git slip when two sessions shared one working tree, which was noticed and corrected.
- Automated accessibility checks (axe, keyboard walkthrough) do not replace a screen-reader pass, and the browser scripts
  only drive Chrome.
- Written specs make the AI confidently consistent: where a decision was wrong, it was implemented faithfully and
  tested. The decision log is where to look for the reasoning behind any behaviour.
- One model reviewing its own work has blind spots. The Claude review loop passed code that a second model then showed
  to have seven real defects. A different reviewer, human or AI, is worth more than another pass by the same one.

## Known limitations

- **No real authentication.** The role switcher is a deliberate stand-in (the brief makes auth optional): anyone who can reach
  the app can act as Staff. Roles are still enforced on the server, the cookie is signed, and students cannot read each other's
  data.
- **Per-student deadline extensions are not exposed.** The table and the deadline rules support them, but there is no endpoint
  or screen (dropped in M17, D-040).
- **Hosted deployment is deferred.** The submission runs locally (Docker). A Vercel + Neon + Supabase Storage demo (M19) was
  planned and designed for (presigned uploads, `S3_PUBLIC_ENDPOINT`, `DEMO_MODE`), but is not deployed.
- **`npm audit`** reports four high-severity findings in `npm audit --omit=dev`, all arriving through Prisma's optional
  `prisma` peer of `@prisma/client`; the only offered fix is a breaking downgrade, so it is accepted (D-040).
- **The end-to-end check is local-only.** `npm run e2e`, `a11y`, `keyboard` and `responsive` need Chrome or Edge and a running
  production build, so they are not part of CI; CI runs lint, types, unit, integration, migrations and the seed check.
- **The filesystem driver is for running locally.** `STORAGE_DRIVER=filesystem` keeps files on one machine's disk, so it is not
  meant for a hosted or multi-instance deployment (use S3 there, D-045).
- **MinIO images come from the community Silo fork** (`pgsty/minio`, `pgsty/mc`), because the official images are no longer
  published (D-027).
- **Scale:** the fee-state filter on the student list applies the overdue rule in memory (about 100 ms for 1,000 students,
  D-032); fine for a registry of a few thousand students, it would move into SQL beyond that.
- **Submission time has one-second resolution** because that is what object storage stamps (D-030).
- Developed and run on Windows 11 with Docker Desktop; CI runs on Linux. Safari was not tested (see the cookie note above).

## Documentation

- [AGENTS.md](AGENTS.md): guidance for AI coding agents and humans working in this repository.
- [docs/](docs/): [requirements](docs/requirements.md), [tech stack](docs/tech-stack.md), [decisions](docs/decisions.md),
  [API](docs/api.md), [pages](docs/pages.md), [edge cases](docs/edge-cases.md) (ticked), [milestone tracker](docs/milestones.md),
  [AI usage log](docs/ai-usage.md) and [open questions](docs/discussions.md).
- [db/](db/README.md): [ER diagram](db/er-diagram.md), [database decisions](db/decisions.md), [seed plan](db/seed-plan.md) and the Prisma schema.
