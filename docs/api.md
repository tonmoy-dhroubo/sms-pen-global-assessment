# API

REST API served by Next.js Route Handlers under `/api` (D-005). This document is the contract: the coder implements
it, and any change to an endpoint updates this file in the same PR. Request bodies and query strings are validated
with Zod schemas in `lib/validation/`, shared with the forms.

## Conventions

### Format

- JSON in and out, `Content-Type: application/json`. Field names in `camelCase`.
- IDs are UUIDs. Students are also addressable by Student ID only through search, never in URLs.
- **Money** is a string with two decimals, in BDT: `"160000.00"`. Never a JSON number (avoids float rounding).
- **Dates** (`dateOfBirth`, `dueDate`, `paidAt`) are `YYYY-MM-DD`. **Timestamps** are ISO 8601 UTC
  (`2026-10-11T17:59:00Z`); the UI renders them in Asia/Dhaka.
- **Marks** are strings with up to one decimal (`"39.5"`), or `null` with `isNonSubmission: true`.

### Roles and access

- The role comes from the `sms_role` cookie set by `PUT /api/session` (D-008, D-020). It is signed (HMAC with
  `SESSION_SECRET`) so it cannot be hand-edited into another identity.
- Each endpoint below lists who may call it: **Staff**, **Student**, or **Any** (either role).
- No valid role → `401`. Wrong role → `403`. A student requesting another student's data → `404` (never reveal that
  the record exists).

### Errors

Every error uses one shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Some fields are invalid.",
    "details": { "fieldErrors": { "email": ["Enter a valid email address."] } }
  }
}
```

| HTTP | `code` | When |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Body or query fails Zod validation; `details.fieldErrors` per field |
| 401 | `UNAUTHENTICATED` | No valid role cookie |
| 403 | `FORBIDDEN` | Wrong role for this endpoint |
| 404 | `NOT_FOUND` | Record missing, or not visible to this student |
| 409 | `CONFLICT` | Unique clash (e.g. email, payment reference) — `details` points at the existing record |
| 409 | `VERSION_CONFLICT` | Optimistic lock failed (DB-016) — `details.currentVersion` |
| 409 | `DUPLICATE_WARNING` | Probable duplicate student; resend with `confirmDuplicate: true` to proceed — `details.matches` |
| 422 | `BUSINESS_RULE` | Valid input that breaks a rule (e.g. upload after close, invalid status transition) — `details.rule` names it |
| 500 | `INTERNAL_ERROR` | Unexpected; logged server-side, generic message to the client |

### Warnings

Some actions succeed but deserve attention (payment larger than balance, publishing for a student with overdue
fees). Successful responses may include `"warnings": [{ "code": "...", "message": "..." }]`.

### Lists

- Query: `page` (default 1), `pageSize` (default 25, max 100), `sort` (`field` or `-field` for descending).
- Response: `{ "items": [...], "page": 1, "pageSize": 25, "total": 142 }`.

### Concurrency

Updatable records (`Student`, `Assessment`, `Mark`) return `version`. Updates must send the `version` they read; a
mismatch returns `409 VERSION_CONFLICT` (DB-016).

---

## Session

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/api/session` | Any / none | Current identity: `{ role: "staff", staff: {...} }`, `{ role: "student", student: {...} }` or `{ role: null }` |
| PUT | `/api/session` | Anyone | Switch identity. Body `{ "role": "staff", "staffId": "…" }` or `{ "role": "student", "studentId": "…" }`. Unknown ID → 404 |
| DELETE | `/api/session` | Anyone | Clear the cookie |
| GET | `/api/session/options` | Anyone | Staff list and a searchable student list (`?q=`) for the role switcher |

## Health

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | Anyone | `{ "db": "ok", "storage": "ok" }`; 503 if either is down |

## Programmes and modules

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/api/programmes` | Any | Programmes with their modules |
| GET | `/api/programmes/{id}` | Staff | Programme with modules and fee schedules by session |
| PUT | `/api/programmes/{id}/fees/{academicYear}` | Staff | Replace a session's fee schedule: `{ "instalments": [{ "instalment": 1, "amount": "160000.00", "dueDate": "2026-09-01" }] }`. Only affects charges created afterwards (existing charges never change) |
| GET | `/api/modules` | Any | Modules with the programmes that include them |

## Students

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/api/students` | Staff | List. Query: `q` (name, partial Student ID, email), `programmeId`, `status` (repeatable; default excludes WITHDRAWN and COMPLETED), `academicYear`, `yearOfStudy`, `feeState` (`overdue`, `outstanding`, `credit`, `paid`), plus list params. Items include fee summary and overdue age |
| POST | `/api/students` | Staff | Create. Body: `fullName`, `email`, `dateOfBirth`, `programmeId`, `academicYear`, `yearOfStudy`, optional `confirmDuplicate`. Generates the Student ID (DB-004, DB-015), records the initial status change, and creates fee charges from the programme's schedule for that session (warning if no schedule exists). 409 `CONFLICT` on email; 409 `DUPLICATE_WARNING` on same name + date of birth |
| GET | `/api/students/{id}` | Staff | Full record: profile, `version`, fee summary |
| PATCH | `/api/students/{id}` | Staff | Edit profile fields with `version`. Changing programme does **not** touch existing charges (edge-cases.md) |
| POST | `/api/students/{id}/status` | Staff | `{ "toStatus": "WITHDRAWN", "reason": "…", "version": 3 }`. Allowed transitions only (see below); 422 `BUSINESS_RULE` otherwise |
| GET | `/api/students/{id}/timeline` | Staff | Activity events, newest first: status changes, charges, payments, voids, mark changes and releases |

**Status transitions** (enforced in `lib/services`):

| From \ To | Enrolled | Deferred | Withdrawn | Completed |
| --- | --- | --- | --- | --- |
| Enrolled | — | reason required | reason required | allowed |
| Deferred | allowed (return) | — | reason required | — |
| Withdrawn | re-admission, reason required | — | — | — |
| Completed | — | — | — | — (final) |

## Fees and payments

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/api/students/{id}/fees` | Staff | `{ summary, charges, payments }`. Summary: `charged`, `waived`, `paid`, `balance` (negative = credit), `overdueAmount`, `oldestOverdueDays`, `ageingBucket`, `nextDueDate` |
| POST | `/api/students/{id}/charges` | Staff | Adjustment or waiver: `{ "kind": "ADJUSTMENT" \| "WAIVER", "description", "amount", "dueDate" }`. Waiver amounts are entered positive and stored negative |
| POST | `/api/students/{id}/payments` | Staff | `{ "amount", "method", "paidAt", "reference" }`. Future `paidAt` → 400. Duplicate reference → 409 `CONFLICT` with the existing payment. Larger than balance → success with warning `OVERPAYMENT` |
| POST | `/api/payments/{id}/void` | Staff | `{ "reason" }`. Already voided → 422 |
| GET | `/api/fees` | Staff | Students with a non-zero balance. Query: `feeState`, `ageingBucket` (`1-30`, `31-60`, `60+`), `programmeId`, list params |

## Dashboard

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/api/dashboard` | Staff | KPI counts, overdue list with ageing, needs-attention items (see pages.md) |

## Assessments

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/api/assessments` | Staff | List with submission, late, marking and release counts. Query: `moduleId`, `state` (`open`, `past-deadline`, `closed`) |
| POST | `/api/assessments` | Staff | `{ "moduleId", "title", "deadline" }` |
| GET | `/api/assessments/{id}` | Staff | Detail with `version` |
| PATCH | `/api/assessments/{id}` | Staff | Edit title/deadline with `version`. Deadline change → response warning `LATE_FLAGS_RECALCULATED` with how many changed |
| POST | `/api/assessments/{id}/close` | Staff | Stop all uploads (`closedAt = now`) |
| POST | `/api/assessments/{id}/reopen` | Staff | Clear `closedAt` |
| GET | `/api/assessments/{id}/submissions` | Staff | Every eligible student with submission status, lateness and file versions |

## Submissions and files

Upload flow (D-013, DB-017). All three steps re-check the rules on the server.

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| POST | `/api/assessments/{id}/submission/upload-url` | Student | `{ "fileName", "contentType", "sizeBytes" }` → `{ "pendingUploadId", "uploadUrl", "headers", "expiresAt" }`. Rejects (422) if the student is not Enrolled, the module isn't in their programme, the assessment is closed, or an on-time submission exists and the deadline has passed. Rejects (400) wrong extension/type or size over `MAX_UPLOAD_MB` |
| POST | `/api/assessments/{id}/submission/confirm` | Student | `{ "pendingUploadId" }`. Server reads the object: checks size, magic bytes (PDF `%PDF-`; DOCX = ZIP with `word/document.xml`, no macros), computes SHA-256, records the file version with `uploadedAt` = time the object arrived. Invalid → deletes object, 400. Repeat confirm → same result (idempotent). Returns the receipt |
| GET | `/api/me/assessments/{id}/submission` | Student | Own submission with versions and receipts |
| GET | `/api/files/{fileId}/download` | Any | Staff, or the owning student → `{ "url", "expiresAt" }` (presigned GET, 5 minutes, original file name). Others → 404 |

**Receipt:** `{ "submissionId", "fileName", "sizeBytes", "sha256", "uploadedAt", "late": false, "lateBy": null }`.

## Marks and results

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/api/assessments/{id}/marks` | Staff | Marksheet rows: student, submission status and lateness, `mark`, `isNonSubmission`, classification, `releaseStatus`, `version` |
| PUT | `/api/assessments/{id}/marks/{studentId}` | Staff | `{ "mark": "67.5" }` or `{ "isNonSubmission": true }`, plus `version` when updating, and `reason` when the mark is already published (422 without it). Mark outside 0–100 or more than one decimal → 400 |
| POST | `/api/marks/publish` | Staff | `{ "assessmentId" }` or `{ "studentId" }` or `{ "markIds": [...] }`, plus `dryRun`. Dry run returns the preview: counts to publish, missing marks, students with overdue fees. Real run publishes DRAFT and WITHHELD marks in scope, with warnings |
| POST | `/api/marks/withhold` | Staff | `{ "markIds": [...], "reason" }` — reason required |
| POST | `/api/marks/unpublish` | Staff | `{ "markIds": [...], "reason" }` — back to DRAFT |
| GET | `/api/students/{id}/results` | Staff | All marks for a student with release status and history |

Classification follows DB-019 and is computed on read.

## Student self-service (`/api/me`)

All scoped to the signed-in student; no IDs of other students are accepted.

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/api/me` | Student | Profile and status, plus what they may do (`canSubmit`, with reason if not) |
| GET | `/api/me/fees` | Student | Summary, charges, non-voided payments |
| GET | `/api/me/assessments` | Student | Assessments for their programme's modules with deadline, countdown data, own submission status |
| GET | `/api/me/results` | Student | Published marks with classification; other results as `{ "status": "NOT_AVAILABLE" }` only |

## Exports (Could)

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/api/exports/overdue.csv` | Staff | Overdue list with ageing |
| GET | `/api/exports/marksheet/{assessmentId}.csv` | Staff | Marksheet for one assessment |
