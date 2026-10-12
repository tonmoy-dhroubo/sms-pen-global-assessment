# Tech stack

The agreed stack and how the pieces fit. The reasoning behind each choice is in [decisions.md](decisions.md) (D-003 to D-014).

## Summary

| Area | Choice | Notes |
| --- | --- | --- |
| Language | TypeScript, `strict` mode | |
| Framework | Next.js 16 (App Router), React 19, Tailwind CSS v4 | Brief requires 14+; Cache Components off (D-026) |
| Database | PostgreSQL | Docker locally, Neon on Vercel |
| ORM | Prisma latest stable, `pg` driver adapter | `schema.prisma` committed; migrations committed |
| File storage | S3-compatible, via the AWS S3 SDK | MinIO (Docker) locally, Supabase Storage on Vercel |
| UI | Tailwind CSS + shadcn/ui | Plus lucide-react, Sonner, Calendar, Charts (Recharts), Sidebar block (D-016) |
| Theming | next-themes | Light / Dark / System, global toggle in the header (D-017) |
| Forms | react-hook-form + Zod, shadcn `field` | shadcn's old `form` component is gone (D-026) |
| Tables | TanStack Table v8 (shadcn data-table) | Server-side filtering/pagination, state in URL params |
| Validation | Zod | Shared between forms and API handlers |
| Dates | date-fns | Stored in UTC, shown in one configured time zone |
| Roles | Cookie-based role switcher, no real auth | Enforced on the server |
| Tests | Vitest (+ Testing Library for components) | Domain rules first; Playwright only if time allows |
| Lint/format | ESLint + Prettier | |
| Package manager | npm | |
| Deployment | Local (Docker) for submission; Vercel for a hosted demo | Deploy once features work |

## Environments

| | Local / submission | Hosted demo |
| --- | --- | --- |
| App | `npm run dev` | Vercel |
| Postgres | Docker | Neon (pooled URL for the app, direct URL for migrations) |
| File storage | MinIO in Docker | Supabase Storage, S3-compatible endpoint |
| Extras | — | "Demo environment" banner; reset script restores seed data |

Only environment variables differ between the two. Expected variables (final list goes in `.env.example`):

- `DATABASE_URL` — app connection (Neon: pooled URL)
- `DIRECT_URL` — migrations (Neon: direct URL; locally the same as `DATABASE_URL`)
- `TEST_DATABASE_URL` — separate database for integration tests (local and CI only)
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `S3_PUBLIC_ENDPOINT` — browser-reachable storage host for presigned URLs, if different from `S3_ENDPOINT`
- `S3_FORCE_PATH_STYLE` — `true` for both MinIO and Supabase
- `APP_TIMEZONE` — `Asia/Dhaka`; used to display dates and judge deadlines (D-018)
- `SESSION_SECRET` — signs the role cookie (D-020)
- `MAX_UPLOAD_MB` — submission size limit (default 20)
- `DEMO_MODE` — shows the demo banner on the hosted environment

## Local services

`docker compose up -d` starts everything the app needs:

- **postgres** — the application database.
- **minio** — object storage for submission files, with its web console for inspecting uploads. Uses the
  community Silo fork images `pgsty/minio` / `pgsty/mc`, because official MinIO images are no longer published (D-027).
- **minio-init** — a one-shot `mc` container that creates the private submissions bucket, so a fresh clone works
  without manual setup.
- **CORS:** MinIO has no per-bucket CORS, so it is set server-wide (`MINIO_API_CORS_ALLOW_ORIGIN` = `APP_ORIGIN`).
  On Supabase Storage (hosted) it is configured on the bucket.

## Application layering

```
app/                 pages (Server Components) and app/api/* Route Handlers
  └─ calls ─▶ lib/services/   business rules: balances, overdue, classification, deadlines, student IDs
                 └─ uses ─▶ lib/db (Prisma client), lib/storage (S3/MinIO client)
```

- **Reads:** Server Components call `lib/services` directly.
- **Writes:** go through Route Handlers in `app/api/`, which validate with Zod, check the role, then call `lib/services`.
- **Errors:** handlers return consistent JSON — `400` with per-field Zod issues, `403` for the wrong role,
  `404` for missing records, `409` for conflicts (e.g. duplicate email).
- Business rules live only in `lib/services` so they can be unit-tested without HTTP or a browser.

## File uploads

The same code runs against MinIO locally and Supabase Storage on Vercel (D-012, D-013).

- The bucket is **private**; nothing is publicly readable. CORS allows only the app's origin to `PUT`/`GET`
  (server-wide on MinIO, per bucket on Supabase).
- **Upload, step 1:** the browser asks a Route Handler for an upload URL. The server checks the role, the assessment
  and the deadline, picks the object key, and returns a short-lived presigned `PUT` URL.
- **Upload, step 2:** the browser uploads the file straight to the bucket. Files never pass through the app server,
  which avoids Vercel's ~4.5 MB request body limit.
- **Upload, step 3:** the browser calls a confirm Route Handler. The server checks the stored object's size and
  leading bytes (PDF / DOCX signature), then records or replaces the submission. Invalid objects are deleted.
- **Download:** a Route Handler checks the viewer may see the file (staff, or the owning student), then returns a
  short-lived presigned `GET` URL.
- Presigned PUTs sign `content-type` and `content-length`, so a different type or size is rejected by storage.
  SDK checksum defaults are set to `WHEN_REQUIRED`, because the default CRC32 parameter breaks real presigned
  uploads on AWS-compatible stores (D-030). Contents are still verified at confirm time.
- Object keys are generated by the server. Upload links write only to a **pending** key
  (`pending/<assessmentId>/<studentId>/<uuid>.<ext>`). At confirm the server copies the object (only if its ETag is
  unchanged) to a **final** key (`submissions/<assessmentId>/<studentId>/<uuid>.<ext>`) that no upload link can write,
  inspects and fingerprints that copy, records it, and deletes the pending object (D-043). The original filename is
  kept only as metadata in the database.
- `npm run uploads:cleanup` deletes only `pending/` objects whose upload expired more than 10 minutes ago.

## Roles

- A role switcher sets a cookie: **Staff**, or **Student** plus which student.
- Middleware and every Route Handler read the role on the server; the UI hiding things is not the security boundary.
- This is a stand-in for real auth, which the brief makes optional.
