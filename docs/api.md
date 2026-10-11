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
- "No valid role" means the cookie is missing, has a bad signature, is older than 7 days, or points at a staff member or
  student that no longer exists. The role is checked before the request body or query is validated.
- The cookie is `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` when `NODE_ENV=production`. Pages under `/staff` and
  `/student` are guarded by `proxy.ts` (signature, age and role only, no database lookup); Route Handlers and server code
  re-verify and confirm the record still exists.

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
| 500 | `INTERNAL_ERROR` | Unexpected; logged server-side with a request id, generic message to the client (`details.requestId`) |

`details` is omitted when an error has none. A body that is not valid JSON is a `VALIDATION_ERROR` with
`details.formErrors` (`details.fieldErrors` is then empty); nested fields use dotted paths (`instalments.0.amount`).
Every response carries an `x-request-id` header (an incoming one is reused when it looks sane) and
`Cache-Control: no-store`.

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
| GET | `/api/session` | Any / none | Current identity: `{ role: "staff", staff: {...} }`, `{ role: "student", student: {...} }` or `{ role: null }`. Always 200: a missing, invalid or dangling cookie is `{ role: null }` |
| PUT | `/api/session` | Anyone | Switch identity. Body `{ "role": "staff", "staffId": "…" }` or `{ "role": "student", "studentId": "…" }`. Responds 200 with the same body as GET and sets the cookie. Unknown ID → 404 (no cookie set); malformed ID or role → 400 |
| DELETE | `/api/session` | Anyone | Clear the cookie. 200 `{ role: null }`, whether or not there was a session |
| GET | `/api/session/options` | Anyone | Staff list and a searchable student list for the role switcher. Query: `q` (name regardless of case and accents, DB-021, or part of the Student ID; max 100 chars), `limit` (default 20, max 50) |

Profile objects: `staff` is `{ id, fullName, email, jobTitle }`; `student` is `{ id, studentNumber, fullName, email, status }`.

`GET /api/session/options` responds `{ "staff": [{ "id", "fullName", "jobTitle" }], "students": { "items": [{ "id",
"studentNumber", "fullName", "status" }], "total": 3 } }`. Staff are all listed, by name. Students are sorted by
normalised name then Student ID, limited to `limit`; `total` counts every match. No emails or dates of birth are exposed.

## Health

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | Anyone | `{ "db": "ok", "storage": "ok" }`; 503 if either is down (`"down"` for the failing one). Storage is checked with a `HeadBucket` call on the configured bucket; each check times out after 3 s |

## Programmes and modules

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/api/programmes` | Any | Programmes with their modules |
| GET | `/api/programmes/{id}` | Staff | Programme with modules and fee schedules by session |
| PUT | `/api/programmes/{id}/fees/{academicYear}` | Staff | Replace a session's fee schedule: `{ "instalments": [{ "instalment": 1, "amount": "160000.00", "dueDate": "2026-09-01" }] }`. Only affects charges created afterwards (existing charges never change) |
| GET | `/api/modules` | Any | Modules with the programmes that include them |

**Shapes** (settled in M10):

- `GET /api/programmes` answers `{ items: [{ id, code, name, durationYears, modules: [{ id, code, title }] }] }` (by name; modules by code). `GET /api/modules` answers `{ items: [{ id, code, title, programmes: [{ id, code, name }] }] }`.
- `GET /api/programmes/{id}` is the programme above plus `feeSchedules`, newest session first: `[{ academicYear, instalments: [{ instalment, amount, dueDate }], total, billedStudents }]`. `billedStudents` is how many students have a charge copied from that session's schedule.
- **Replace a schedule** (`PUT .../fees/{academicYear}`): `academicYear` is a session such as `2026-27` (400 on `academicYear` otherwise); the body needs 1-12 instalments numbered exactly 1..n in any order (400 on `instalments` if numbers skip or repeat), each with an `amount` above zero (at most two decimals) and a real `dueDate`. Instalments are matched by number: listed numbers are updated in place or added, unlisted ones are removed. Charges that already exist are never read or changed (they hold their own copy), so removing an instalment that students have been billed for is refused with 422 `BUSINESS_RULE`, `details: { rule: "FEE_INSTALMENT_IN_USE", instalments: [2] }`, and nothing is saved. Success answers 200 with the session's schedule (`{ academicYear, instalments, total, billedStudents }`) and, when something changed and students were already billed from it, the warning `EXISTING_CHARGES_UNCHANGED`. Edits to one programme's schedules are applied one at a time.

## Students

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/api/students` | Staff | List. Query: `q` (name, partial Student ID, email), `programmeId`, `status` (repeatable; default excludes WITHDRAWN and COMPLETED), `academicYear`, `yearOfStudy`, `feeState` (`overdue`, `outstanding`, `credit`, `paid`), plus list params. Items include fee summary and overdue age |
| POST | `/api/students` | Staff | Create. Body: `fullName`, `email`, `dateOfBirth`, `programmeId`, `academicYear`, `yearOfStudy`, optional `confirmDuplicate`. Generates the Student ID (DB-004, DB-015), records the initial status change, and creates fee charges from the programme's schedule for that session (warning if no schedule exists). 409 `CONFLICT` on email; 409 `DUPLICATE_WARNING` on same name + date of birth |
| GET | `/api/students/{id}` | Staff | Full record: profile, `version`, fee summary |
| PATCH | `/api/students/{id}` | Staff | Edit profile fields with `version`. Changing programme does **not** touch existing charges (edge-cases.md) |
| POST | `/api/students/{id}/status` | Staff | `{ "toStatus": "WITHDRAWN", "reason": "…", "version": 3 }`. Allowed transitions only (see below); 422 `BUSINESS_RULE` otherwise |
| GET | `/api/students/{id}/timeline` | Staff | Activity events, newest first: status changes, charges, payments, voids, mark changes and releases |

**Shapes** (settled in M09; `GET /api/students/{id}`, and the 200/201 body of every write):

- **Record:** `{ id, studentNumber, fullName, email, dateOfBirth, programme: { id, code, name, durationYears }, academicYear, yearOfStudy, status, version, createdAt, updatedAt, feeSummary }`. `feeSummary` is the fee summary used everywhere: `{ charged, waived, paid, balance, credit, overdueAmount, oldestOverdueDays, ageingBucket, nextDueDate, feeState }` (money as strings; `balance` is negative when in credit and `credit` is the same amount, positive; `feeState` is `overdue`, `outstanding` (owes money, nothing due yet), `credit` or `paid`).
- **List item:** `{ id, studentNumber, fullName, email, programme: { id, code, name }, academicYear, yearOfStudy, status, feeSummary }`. The list answers `{ items, page, pageSize, total }`.
- **Search** (`q`): the name matches regardless of case and accents (DB-021), the Student ID and email match any part, case-insensitively. `%` and `_` are literal.
- **Filters:** `programmeId` (uuid), `academicYear` (`2026-27`), `yearOfStudy` (1-8), `feeState`, and `status` (repeat the key, e.g. `?status=WITHDRAWN&status=COMPLETED`). With no `status` the list shows Enrolled and Deferred only. A `status` filter shows exactly the statuses given, so a withdrawn student who still owes money is found with `?status=WITHDRAWN&feeState=overdue`.
- **Sort** (`sort=fullName`, `sort=-yearOfStudy`): `fullName` (default, accent- and case-insensitive), `studentNumber`, `programme` (by code), `academicYear`, `yearOfStudy`, `status`. Ties break on Student ID, so paging is stable. Any other field is a 400.
- **Fee state filter:** computed by the same rule as the summary, so the list, the filter and the record agree. Search, other filters, sort and paging run in SQL; with `feeState` the matching students' charges and payments are summarised in memory and then paged (about 100 ms for 1,000 students).
- **Create** (`POST /api/students`): 201 with the record. Checks in this order: field validation (400), programme exists and the year of study is within its length (400 on `programmeId` / `yearOfStudy`), taken email (409 `CONFLICT`, `details: { field: "email", existing: { id, studentNumber, fullName } }`), probable duplicate (409 `DUPLICATE_WARNING`, `details.matches` = `[{ id, studentNumber, fullName, email, dateOfBirth, status, programme: { id, code, name } }]`, skipped with `confirmDuplicate: true`). The Student ID is `SMS-<start year of the chosen session>-<seq>` (DB-015). No schedule for the session adds the warning `NO_FEE_SCHEDULE` and no charges. `fullName` has extra spaces collapsed; `email` is trimmed and lower-cased; the date of birth must be a real date, not in the future, and an age of 16-100 as of today in Dhaka.
- **Update** (`PATCH /api/students/{id}`): any of `fullName`, `email`, `dateOfBirth`, `programmeId`, `academicYear`, `yearOfStudy`, plus the `version` that was read (at least one field is required; `status` and `studentNumber` are not editable here). Stale version: 409 `VERSION_CONFLICT` with `details.currentVersion`. When no field actually changes the record is returned as it is and the version does not move. Changing the programme never touches existing charges and adds the warning `PROGRAMME_CHANGED`.
- **Status** (`POST /api/students/{id}/status`): 200 with the updated record. A transition the table does not allow, or to the current status: 422 `BUSINESS_RULE` with `details: { rule: "STATUS_TRANSITION", from, to }`. A missing or blank reason where one is required: 400 `VALIDATION_ERROR` on `reason`. A reason sent for a transition that does not need one is kept. Order of checks: version (409), allowed (422), reason (400).
- An id that is not a UUID is a 404, like an unknown one.

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
| GET | `/api/students/{id}/fees` | Staff | `{ summary, charges, payments }`. Summary: `charged`, `waived`, `paid`, `balance` (negative = credit), `credit`, `overdueAmount`, `oldestOverdueDays`, `ageingBucket`, `nextDueDate`, `feeState` |
| POST | `/api/students/{id}/charges` | Staff | Adjustment or waiver: `{ "kind": "ADJUSTMENT" \| "WAIVER", "description", "amount", "dueDate" }`. Waiver amounts are entered positive and stored negative |
| POST | `/api/students/{id}/payments` | Staff | `{ "amount", "method", "paidAt", "reference" }`. Future `paidAt` → 400. Duplicate reference → 409 `CONFLICT` with the existing payment. Larger than balance → success with warning `OVERPAYMENT` |
| POST | `/api/payments/{id}/void` | Staff | `{ "reason" }`. Already voided → 422 |
| GET | `/api/fees` | Staff | Students with a non-zero balance. Query: `feeState`, `ageingBucket` (`1-30`, `31-60`, `60+`), `programmeId`, list params |

**Shapes** (settled in M10):

- **Summary** is the `feeSummary` of the Students "Shapes" block. **Charge:** `{ id, kind, academicYear, description, amount, dueDate, createdAt }`; a waiver's `amount` is negative, as stored. **Payment:** `{ id, studentId, amount, method, paidAt, reference, recordedBy: { id, fullName }, recordedAt, voidedAt, voidReason }`; `voidedAt` and `voidReason` are `null` unless voided.
- **Read** (`GET /api/students/{id}/fees`): charges oldest due date first, payments newest first (by `paidAt`). Voided payments are included, with their reason; they count toward nothing in the summary. A student with no charges has an all-zero summary with `feeState: "paid"`. An unknown or malformed id is 404.
- **Writes** answer with the changed row and the student's summary afterwards, so a client can update without a second call: `POST .../charges` 201 `{ charge, summary }`; `POST .../payments` 201 `{ payment, summary }` (plus `warnings`); `POST /api/payments/{id}/void` 200 `{ payment, summary }`. Adjustments, waivers and payments are allowed for a student of any status, and a charge belongs to the student's current session (`academicYear`).
- **Charge input:** `kind` is `ADJUSTMENT` (adds to what is owed) or `WAIVER` (reduces it); `description` 1-200 characters; `amount` above zero; `dueDate` any real date (a past date makes the charge due at once).
- **Payment input:** `amount` above zero with at most two decimals, sent as a string; it may be typed with grouping (`"1,25,000"`) and is returned as `"125000.00"`. `method` is `BANK_TRANSFER`, `CASH`, `BKASH`, `NAGAD` or `CARD`. `paidAt` is a real date, today (Dhaka) or earlier; backdating is allowed, a later date is 400 on `paidAt` ("A payment cannot be dated in the future."). `reference` is required, at most 64 characters, and stored trimmed, with runs of spaces collapsed and in upper case, so `trx 9f3` and `TRX 9F3` are the same reference.
- **Duplicate reference:** references are unique across all payments, voided ones included (a voided payment's reference cannot be reused). The 409 is `{ code: "CONFLICT", details: { field: "reference", existing: { id, reference, student: { id, studentNumber, fullName }, amount, paidAt, voided } } }`. Two identical simultaneous requests: exactly one is 201, the other 409.
- **Overpayment:** when `amount` is more than the balance before the payment (or the student owes nothing, or already has a credit) the payment is saved and the response carries `{ code: "OVERPAYMENT", message }`.
- **Void:** `reason` is 1-500 characters (400 otherwise). The row is kept, with `voidedAt` set. Voiding again is 422 `BUSINESS_RULE`, `details.rule: "PAYMENT_ALREADY_VOIDED"` (the first reason is kept); of two simultaneous voids exactly one succeeds. The schema records who recorded a payment (`recordedBy`) but not who voided it.
- **Balances list** (`GET /api/fees`): every student whose fee state is not "paid" (overdue, outstanding or credit), whatever their enrolment status, so a withdrawn student who still owes stays on it. Item: `{ id, studentNumber, fullName, email, programme: { id, code, name }, academicYear, yearOfStudy, status, feeSummary, lastPayment: { paidAt, amount } | null }` (`lastPayment` is the latest payment that is not voided). The envelope is the standard list `{ items, page, pageSize, total }`. `feeState` is `overdue`, `outstanding` or `credit` (`paid` is a 400); `ageingBucket` is `1-30`, `31-60` or `60+` (a hand-typed `60+` that arrives as `60 ` is understood; the UI sends `60%2B`). Sort: `oldestOverdueDays` (default `-oldestOverdueDays`: longest overdue first), `overdueAmount`, `fullName`; students with no overdue age always come last when sorting by it; ties keep name order. Like the student list's fee-state filter (D-032), the rule runs in memory over the candidates.

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

`GET /api/me` responds `{ "student": { id, studentNumber, fullName, email, dateOfBirth, programme: { id, code, name },
academicYear, yearOfStudy, status }, "canSubmit": { "allowed": true, "reason": null, "message": null } }`. At this point
`canSubmit` only reflects the enrolment status (`reason: "NOT_ENROLLED"` for Deferred, Withdrawn and Completed);
per-assessment reasons (closed, deadline passed, module not in programme) belong to `/api/me/assessments`.

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/api/me` | Student | Profile and status, plus what they may do (`canSubmit`, with reason if not). Staff → 403 |
| GET | `/api/me/fees` | Student | Summary, charges, non-voided payments |
| GET | `/api/me/assessments` | Student | Assessments for their programme's modules with deadline, countdown data, own submission status |
| GET | `/api/me/results` | Student | Published marks with classification; other results as `{ "status": "NOT_AVAILABLE" }` only |

## Exports (Could)

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/api/exports/overdue.csv` | Staff | Overdue list with ageing |
| GET | `/api/exports/marksheet/{assessmentId}.csv` | Staff | Marksheet for one assessment |
