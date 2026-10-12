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
- Roles are tested route by route: `tests/integration/api/route-access.test.ts` discovers every `route.ts` under `app/api`, checks it against a reviewed list of who may call it, and proves a student gets `403` from every staff-only route (a new route fails the test until it is added to that list). `tests/integration/api/student-access.test.ts` aims every student-facing endpoint at another student's ids.

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
fees). Successful responses may include `"warnings": [{ "code": "...", "message": "..." }]`; a warning may also carry
`"details"` with the numbers behind it (for example `{ "changed": 2 }`).

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

- **Summary** is the `feeSummary` of the Students "Shapes" block. **Charge:** `{ id, kind, academicYear, description, amount, dueDate, createdAt, createdBy: { id, fullName } | null }`; a waiver's `amount` is negative, as stored; `createdBy` is the staff member who added it (for the automatic programme-fee charges, who enrolled the student). **Payment:** `{ id, studentId, amount, method, paidAt, reference, recordedBy: { id, fullName }, recordedAt, voidedAt, voidedBy: { id, fullName } | null, voidReason }`; `voidedAt`, `voidedBy` and `voidReason` are `null` unless voided.
- **Read** (`GET /api/students/{id}/fees`): charges oldest due date first, payments newest first (by `paidAt`). Voided payments are included, with their reason; they count toward nothing in the summary. A student with no charges has an all-zero summary with `feeState: "paid"`. An unknown or malformed id is 404.
- **Writes** answer with the changed row and the student's summary afterwards, so a client can update without a second call: `POST .../charges` 201 `{ charge, summary }` (plus `warnings`); `POST .../payments` 201 `{ payment, summary }` (plus `warnings`); `POST /api/payments/{id}/void` 200 `{ payment, summary }`. Adjustments, waivers and payments are allowed for a student of any status, and a charge belongs to the student's current session (`academicYear`).
- **Charge input:** `kind` is `ADJUSTMENT` (adds to what is owed) or `WAIVER` (reduces it); `description` 1-200 characters; `amount` above zero; `dueDate` any real date (a past date makes the charge due at once). A waiver larger than the current balance (or any waiver when the student owes nothing) is allowed and answers with the warning `WAIVER_EXCEEDS_BALANCE`; the rest shows as credit.
- **Payment input:** `amount` above zero with at most two decimals, sent as a string; it may be typed with grouping (`"1,25,000"`) and is returned as `"125000.00"`. `method` is `BANK_TRANSFER`, `CASH`, `BKASH`, `NAGAD` or `CARD`. `paidAt` is a real date, today (Dhaka) or earlier; backdating is allowed, a later date is 400 on `paidAt` ("A payment cannot be dated in the future."). `reference` is required (for cash it is the receipt number), at most 64 characters, and stored trimmed, with runs of spaces collapsed and in upper case, so `trx 9f3` and `TRX 9F3` are the same reference.
- **Duplicate reference:** a reference is unique among payments that are not voided. A voided payment frees its reference, so a mistaken entry that is voided can be re-recorded with the same bank reference. The 409 is `{ code: "CONFLICT", details: { field: "reference", existing: { id, reference, student: { id, studentNumber, fullName }, amount, paidAt } } }`. Two identical simultaneous requests: exactly one is 201, the others 409.
- **Overpayment:** when `amount` is more than the balance before the payment (or the student owes nothing, or already has a credit) the payment is saved and the response carries `{ code: "OVERPAYMENT", message }`.
- **Void:** `reason` is 1-500 characters (400 otherwise). The row is kept, with `voidedAt` and `voidedBy` (the acting staff member) set. Voiding again is 422 `BUSINESS_RULE`, `details.rule: "PAYMENT_ALREADY_VOIDED"` (the first reason is kept); of two simultaneous voids exactly one succeeds.
- **Balances list** (`GET /api/fees`): every student whose fee state is not "paid" (overdue, outstanding or credit), whatever their enrolment status, so a withdrawn student who still owes stays on it. Item: `{ id, studentNumber, fullName, email, programme: { id, code, name }, academicYear, yearOfStudy, status, feeSummary, lastPayment: { paidAt, amount } | null }` (`lastPayment` is the latest payment that is not voided). The envelope is the standard list `{ items, page, pageSize, total }`. `feeState` is `overdue`, `outstanding` or `credit` (`paid` is a 400); `ageingBucket` is `1-30`, `31-60` or `60+` (a hand-typed `60+` that arrives as `60 ` is understood; the UI sends `60%2B`). Sort: `oldestOverdueDays` (default `-oldestOverdueDays`: longest overdue first), `overdueAmount`, `fullName`; students with no overdue age always come last when sorting by it; ties keep name order. Like the student list's fee-state filter (D-032), the rule runs in memory over the candidates.

## Dashboard

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/api/dashboard` | Staff | KPI counts, overdue list with ageing, needs-attention items (see pages.md) |

**Shape** (settled in M11; money as strings, timestamps ISO 8601 UTC):

```json
{
  "generatedAt": "2026-10-12T04:00:00.000Z",
  "today": "2026-10-12",
  "kpis": {
    "students": { "enrolled": 21, "deferred": 3, "withdrawn": 3, "completed": 3 },
    "outstanding": { "amount": "1755000.00", "students": 10 },
    "overdue": { "students": 8, "amount": "1115000.00" },
    "lateSubmissions": { "count": 5, "windowDays": 14, "since": "2026-09-28T04:00:00.000Z" },
    "resultsAwaitingPublication": { "draftMarks": 27, "assessments": 2, "withheldMarks": 2 }
  },
  "ageing": [
    { "bucket": "1-30", "students": 4, "amount": "615000.00" },
    { "bucket": "31-60", "students": 2, "amount": "210000.00" },
    { "bucket": "60+", "students": 2, "amount": "290000.00" }
  ],
  "overdue": {
    "total": 8,
    "items": [
      { "id": "…", "studentNumber": "SMS-2025-0029", "fullName": "Habib Ullah",
        "programme": { "id": "…", "code": "BA-ENG", "name": "BA (Hons) in English" },
        "status": "WITHDRAWN", "overdueAmount": "90000.00", "balance": "90000.00",
        "oldestOverdueDays": 375, "ageingBucket": "60+" }
    ]
  },
  "needsAttention": {
    "lateSubmissions": { "total": 5, "items": [
      { "submissionId": "…", "student": { "id": "…", "studentNumber": "…", "fullName": "…" },
        "assessment": { "id": "…", "title": "Essay 1", "module": { "id": "…", "code": "ENG101", "title": "…" } },
        "submittedAt": "…", "deadline": "…", "lateBy": "2 days", "href": "/staff/assessments/…" } ] },
    "withheldResults": { "total": 2, "items": [
      { "markId": "…", "student": { "id": "…", "studentNumber": "…", "fullName": "…" },
        "assessment": { "id": "…", "title": "Essay 1", "module": { "id": "…", "code": "ENG101", "title": "…" } },
        "reason": "Outstanding fees", "href": "/staff/students/…" } ] },
    "draftAssessments": { "total": 2, "items": [
      { "assessment": { "id": "…", "title": "Quiz 1", "module": { "id": "…", "code": "MAT101", "title": "…" }, "deadline": "…" },
        "draftMarks": 17, "href": "/staff/assessments/…" } ] }
  }
}
```

- **"Now" and "today":** the figures are computed for one instant (`generatedAt`, from the clock). `today` is that instant's calendar date in Asia/Dhaka, and every overdue figure is measured against it, so the dashboard agrees with the fee screens at any moment.
- **Students:** counts by enrolment status over all students.
- **Outstanding:** the sum of the positive balances (charged − waived − paid) of every student who owes anything, overdue or not yet due, whatever their enrolment status; `students` is how many owe. A credit is not netted off.
- **Overdue and ageing:** the same fee rule as the student list and `GET /api/fees` (D-028): payments settle the oldest charge first, a student is overdue when a charge fell due before today and is not covered, and the bucket comes from the age of the oldest uncovered overdue charge. Withdrawn, deferred and completed students who still owe are included. `ageing` always lists the three buckets in order, zeros included; `amount` is the overdue amount of the students in the bucket.
- **Overdue list:** at most 10 students, longest overdue first (ties: larger overdue amount, then id); `total` is everyone overdue. `balance` is the student's whole balance, which the record-payment dialog shows.
- **Late submissions:** a submission whose latest file arrived (`lastSubmittedAt`) after the student's effective deadline (their extension if they have one, else the assessment's; D-023, DB-014) and within the last 14 days, counted in elapsed time up to `generatedAt` (`kpis.lateSubmissions.since` is the start of the window; a file arriving exactly then is included). `count` is all of them; the list holds the 10 most recent, each with `lateBy` in the largest whole unit ("5 hours", "2 days").
- **Results:** `draftMarks` is the number of marks still in DRAFT (a non-submission counts) and `assessments` how many assessments they are spread across; `withheldMarks` is the number of marks currently WITHHELD. `draftAssessments` lists up to 10 assessments with drafts, the oldest deadline first, each with its draft count; `withheldResults` lists up to 10 withheld marks, most recently changed first, with the reason staff gave (`null` if none was recorded).
- **Links:** every needs-attention item carries `href`, the page to act on it: the assessment for late submissions and drafts, the student record for a withheld result. (`/staff/assessments/{id}` is a placeholder page until M12.)
- **Cost:** a fixed number of database queries (19 statements today), however many students there are; there are no per-student queries (tested with 5 and with 50 students).

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

**Shapes** (settled in M12; timestamps ISO 8601 UTC):

- **Assessment** (list item, detail and every write's body): `{ id, title, module: { id, code, title }, deadline, closedAt, state, version, counts }`, plus `createdBy: { id, fullName }` on the detail and on writes. `deadline` is the assessment's deadline (students with an extension have their own); `closedAt` is `null` while it accepts uploads. `state` is `open` (not closed, deadline not yet passed; arriving exactly at the deadline is still on time), `past-deadline` (not closed, deadline gone by: uploads are still accepted and marked late) or `closed` (no uploads at all, whatever the deadline). `counts` is `{ eligible, submitted, late, marked, published }`: `eligible` is the number of rows the submissions list has (Enrolled students whose programme includes the module, plus anyone who submitted regardless of status), `submitted` how many students have a submission, `late` how many of those have a latest file after their effective deadline (derived, never stored), `marked` the marks entered (a non-submission counts, any release status), `published` the marks published.
- **List** (`GET /api/assessments`): the standard `{ items, page, pageSize, total }`. Query: `moduleId`, `state` (`open`, `past-deadline`, `closed`), `page`, `pageSize`, `sort` (`deadline` (default `-deadline`: newest first), `title`, `module` (by code); ties break on deadline then id). A fixed number of queries however many assessments or students there are (tested).
- **Create** (`POST`, 201): `moduleId` must be an existing module (400 on `moduleId` otherwise), `title` 1-200 characters (spaces collapsed), `deadline` an ISO 8601 timestamp with `Z` or an offset (`2026-10-11T23:59:00+06:00` and `2026-10-11T17:59:00Z` are the same instant); years outside 2000-2099 are a 400. A deadline that is already in the past is accepted (staff may back-enter an assessment) and answers with the warning `DEADLINE_IN_PAST`. The UI collects a date and a time in Asia/Dhaka and converts them to this instant.
- **Update** (`PATCH`): any of `title`, `deadline`, `moduleId`, plus the `version` that was read (at least one field is required). Stale version: 409 `VERSION_CONFLICT` with `details.currentVersion`. Changing `moduleId` is only allowed while no student has submitted **and no mark has been entered**, otherwise 422 `BUSINESS_RULE`, `details: { rule: "ASSESSMENT_HAS_ACTIVITY", submissions, marks }` (M14, D-035); an unknown module is a 400 on `moduleId`. A closed assessment can still be edited. When a deadline change is real and the assessment has submissions, the response carries the warning `LATE_FLAGS_RECALCULATED` with `details: { changed, submissions }`: `changed` is how many submissions flipped between on time and late (a student with an extension never flips, as their own deadline does not move) and `submissions` how many exist (`changed` can be 0). When nothing actually changes the assessment is returned as it is and the version does not move.
- **Close** (`POST .../close`): 200 with the assessment, `closedAt` = now. Closing a closed assessment: 422 `BUSINESS_RULE`, `details.rule: "ALREADY_CLOSED"` (the first closing time is kept; of two simultaneous closes exactly one succeeds). **Reopen:** 200, `closedAt` = `null`; reopening one that is not closed: 422, `details.rule: "NOT_CLOSED"`. Both move `version`, so an edit form opened before the change gets `VERSION_CONFLICT` on save. Neither takes a body.
- **Submissions** (`GET .../submissions`): `{ assessmentId, total, summary: { onTime, late, notSubmitted }, items }`, not paged, by name (case and accents ignored), then Student ID. Eligible = Enrolled in a programme that includes the module; anyone who has submitted is listed whatever their status now. Item: `{ student: { id, studentNumber, fullName, status, programme: { id, code, name } }, eligible, status, lateBy, deadline, extension, submission, currentFile, versions }`. `eligible` is `false` for a student who submitted but is no longer Enrolled in such a programme. `status` is `ON_TIME`, `LATE` or `NOT_SUBMITTED`; `lateBy` ("2 days", "5 hours") is set only when late and measures the latest file against `deadline`, the student's effective deadline (their extension's `newDeadline` if they have one, else the assessment's). `extension` is `{ newDeadline, reason }` or `null`; `submission` is `{ id, firstSubmittedAt, lastSubmittedAt }` or `null`. A file is `{ id, version, fileName, mimeType, sizeBytes, sha256, uploadedAt }` (`version` counts from 1 for the first upload; `uploadedAt` is when it arrived, the submission time of D-023). `currentFile` is the latest file (or `null`), `versions` every file newest first.
- An id that is not a UUID is a 404, like an unknown one.

## Submissions and files

Upload flow (D-013, DB-017). All three steps re-check the rules on the server.

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| POST | `/api/assessments/{id}/submission/upload-url` | Student | `{ "fileName", "contentType", "sizeBytes" }` → `{ "pendingUploadId", "uploadUrl", "headers", "expiresAt" }`. Rejects (422) if the student is not Enrolled, the module isn't in their programme, the assessment is closed, or an on-time submission exists and the deadline has passed. Rejects (400) wrong extension/type or size over `MAX_UPLOAD_MB` |
| POST | `/api/assessments/{id}/submission/confirm` | Student | `{ "pendingUploadId" }`. Server reads the object: checks size, magic bytes (PDF `%PDF-`; DOCX = ZIP with `word/document.xml`, no macros), computes SHA-256, records the file version with `uploadedAt` = time the object arrived. Invalid → deletes object, 400. Repeat confirm → same result (idempotent). Returns the receipt |
| GET | `/api/me/assessments/{id}/submission` | Student | One assessment with the student's own submission, versions and receipts (shape under "Student assessments" below) |
| GET | `/api/files/{fileId}/download` | Any | Staff, or the owning student → `{ "url", "expiresAt" }` (presigned GET, 5 minutes, original file name). Others → 404 |

**Receipt:** `{ "submissionId", "fileName", "sizeBytes", "sha256", "uploadedAt", "late": false, "lateBy": null }`.

**Shapes** (settled in M13):

- **Upload URL** (`POST .../submission/upload-url`, 200): body `{ fileName, contentType, sizeBytes }`; answers `{ pendingUploadId, uploadUrl, headers, expiresAt, late }`. `headers` (`{ "Content-Type": ... }`) must be sent exactly as given with the `PUT`; the URL signs the type and the length (`Content-Length`, which the browser sets from the file), so storage answers 403 to any other type or size. `expiresAt` is 15 minutes out; `late` says the file would be marked late if it arrived now. `fileName` loses any folder part; the extension must be `.pdf` or `.docx` (case ignored; `.docm` and `.dotm` get a message about macros), `contentType` must be the extension's MIME type (`application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`), `sizeBytes` a whole number above zero and at most `MAX_UPLOAD_MB`. All of these are 400 `VALIDATION_ERROR` with the field in `details.fieldErrors`. The rules run next (422 `BUSINESS_RULE`, `details.rule` is `NOT_ENROLLED`, `MODULE_NOT_IN_PROGRAMME`, `CLOSED` or `ON_TIME_LOCKED`, with a plain-words `message`); an unknown or malformed assessment id is 404. The storage key is chosen by the server (`submissions/<assessmentId>/<studentId>/<uuid>.<ext>`); the declared name, type and size are kept on the pending upload.
- **Confirm** (`POST .../submission/confirm`, 200, body `{ pendingUploadId }`): the pending upload must be this student's for this assessment, else 404 (the same 404 as an unknown id). Order of checks: already confirmed (the same receipt again, even after the 15 minutes) -> expired (422 `BUSINESS_RULE`, `details.rule: "UPLOAD_EXPIRED"`; the object and the pending row are removed) -> object missing (422, `UPLOAD_NOT_FOUND`; the pending upload is kept so the student can retry) -> content checks (400 `VALIDATION_ERROR` on `file`; the object and the pending row are removed): empty, over `MAX_UPLOAD_MB`, not the announced size, a PDF that does not start with `%PDF-`, a DOCX that is not a ZIP with `word/document.xml`, or that contains a `vbaProject.bin` (macros) -> the upload rules again with the moment the file arrived (the object's `LastModified`, one-second resolution, D-023/D-030) as "now" (422 with the rule; the object and row are removed), so an assessment closed, or a deadline that passed on an on-time submission, between issue and confirm rejects the file. The ZIP is read with ranged GETs (the last 64 KiB and the central directory, at most 2 MiB), never downloaded whole; the SHA-256 is streamed. The version, the submission (first and last submitted times) and the confirmation are written in one transaction behind a per-student, per-assessment lock, so several confirms at once create one version. A new version's `uploadedAt` is moved up by 1 ms if it would not sort after the previous one (storage stamps whole seconds).
- **Receipt:** `late` and `lateBy` are measured against the student's own deadline (their extension if any) and recomputed on every read.
- **Abandoned uploads:** `npm run uploads:cleanup` deletes unconfirmed pending uploads past `expiresAt`, and their objects.

**Download** (`GET /api/files/{fileId}/download`, settled in M12): any signed-in role; the role is checked first (no session is 401). Staff may open any file; a student only a file of their own submission, and another student's file is a 404 identical to an unknown one (also for an id that is not a UUID), so it never confirms the file exists. A student keeps access to their own files whatever their enrolment status. Answers `{ "url", "expiresAt" }`: a presigned GET that lives 300 seconds and saves the file under its original name (`Content-Disposition: attachment` with an RFC 5987 `filename*`, so Bengali names survive).

## Marks and results

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/api/assessments/{id}/marks` | Staff | Marksheet rows: student, submission status and lateness, `mark`, `isNonSubmission`, classification, `releaseStatus`, `version` |
| PUT | `/api/assessments/{id}/marks/{studentId}` | Staff | `{ "mark": "67.5" }` or `{ "isNonSubmission": true }`, plus `version` when updating, and `reason` when the mark is already published (400 on `reason` without it). Mark outside 0-100 or more than one decimal → 400 on `mark` |
| POST | `/api/marks/publish` | Staff | `{ "assessmentId" }` or `{ "studentId" }` or `{ "markIds": [...] }`, plus `dryRun`. Dry run returns the preview: counts to publish, missing marks, students with overdue fees. Real run publishes DRAFT and WITHHELD marks in scope, with warnings |
| POST | `/api/marks/withhold` | Staff | `{ "markIds": [...], "reason" }` - reason required |
| POST | `/api/marks/unpublish` | Staff | `{ "markIds": [...], "reason" }` - back to DRAFT |
| GET | `/api/students/{id}/results` | Staff | All marks for a student with release status and history |

Classification follows DB-019 and is computed on read.

**Shapes** (settled in M14; timestamps ISO 8601 UTC):

- **Marks** are strings with exactly one decimal (`"67.5"`, `"70.0"`), or `null` for a non-submission. A non-submission has `isNonSubmission: true`, `mark: null` and `classification: "FAIL"`; the UI shows it as "NS". `classification` is `FAIL`, `PASS`, `MERIT` or `DISTINCTION`, judged on the mark rounded half-up (39.5 is `PASS`, 69.4 is `MERIT`); the stored mark is never rounded.
- **Marksheet** (`GET /api/assessments/{id}/marks`): `{ assessmentId, total, summary: { entered, missing, draft, published, withheld }, items }`, by name (case and accents ignored), then Student ID. A row exists for every student who is Enrolled in a programme that includes the module, plus anyone who has submitted or has a mark, whatever their status now (D-035; `eligible: false` for the latter). Item: `{ student: { id, studentNumber, fullName, status, programme }, eligible, submission: { status, lateBy, deadline, lastSubmittedAt }, markId, mark, isNonSubmission, classification, releaseStatus, withheldReason, publishedAt, version, updatedAt }`. `submission.status` is `ON_TIME`, `LATE` or `NOT_SUBMITTED`, measured against `deadline`, the student's own (extension-aware); late is information only and never changes a mark. A student with no mark yet has `markId`, `mark`, `classification`, `releaseStatus`, `withheldReason`, `publishedAt`, `version` and `updatedAt` all `null` (and `isNonSubmission: false`). An unknown or malformed assessment id is 404.
- **Enter a mark** (`PUT .../marks/{studentId}`): the body has exactly one of `mark` (a string or a number: 0-100, at most one decimal, so `"67.50"` is accepted and `"40.25"`, `"100.1"`, `"-1"`, `"1e2"` and `""` are 400 on `mark`) or `isNonSubmission: true`; both, or neither, is 400 on `mark`. Answers the mark `{ markId, assessmentId, studentId, mark, isNonSubmission, classification, releaseStatus, withheldReason, publishedAt, version, updatedAt }`.
  - **First entry:** 201, a `DRAFT` with `version: 1` entered by the acting staff member, and **no** `MARK_CHANGE` row (DB-023). The student must be on the marksheet (Enrolled in a programme with the module, or have submitted), otherwise 422 `BUSINESS_RULE`, `details.rule: "STUDENT_NOT_ELIGIBLE"`; an unknown assessment or student is 404. Two simultaneous first entries: one 201, the other 409 `VERSION_CONFLICT`.
  - **Change:** 200. The body must carry the `version` that was read: a stale or missing one is 409 `VERSION_CONFLICT` (`details.currentVersion`); of two simultaneous updates with the same version exactly one succeeds. A real change moves `version` by one and writes one `MARK_CHANGE` row `MARK` with `oldMark`, `newMark` (null = non-submission), the optional `reason` and the acting staff member. Sending exactly what is stored changes nothing: the mark is returned as it is, the version does not move, and no reason is needed.
  - **Published marks:** a change needs a non-empty `reason` (400 `VALIDATION_ERROR` on `reason`, the D-032 pattern). The mark **stays PUBLISHED**; the reason is stored in the `MARK_CHANGE` row. A DRAFT or WITHHELD mark takes an optional reason and keeps its status.
  - Order of checks: body shape (400) -> ids (404) -> eligibility (422, first entry only) -> version (409) -> unchanged (200) -> reason (400).
- **Publish** (`POST /api/marks/publish`): the body has exactly one of `assessmentId`, `studentId` or `markIds` (1-500 ids; duplicates are ignored), else 400; an unknown assessment, student or mark id is 404 (nothing is published). `dryRun` defaults to `false`. Both modes answer the same preview body, so a client can show it and then send the same request without `dryRun`: `{ dryRun, published, toPublish, alreadyPublished, missingMarks: [{ student: { id, studentNumber, fullName }, assessment: { id, title, module } }], overdueStudents: [{ student, overdueAmount, marksToPublish }], overdueTotal, summary }`, plus `warnings`.
  - `toPublish` is the DRAFT and WITHHELD marks in scope (a non-submission counts); `alreadyPublished` the PUBLISHED ones, which are left alone; `published` is how many this request really changed (0 for a dry run).
  - **Missing marks** (by name): for `assessmentId`, every student on that marksheet without a mark; for `studentId`, every assessment the student is Enrolled for whose deadline has passed or that is closed (plus any they submitted to) where they have no mark; for `markIds`, none. Missing marks never block publishing.
  - **Overdue fees** (DB-012: a warning, never a block): students who have something to publish and an overdue amount above zero by the fee rule (D-028), largest amount first; `overdueAmount` is a money string. Students with nothing left to publish are not listed.
  - **Warnings:** `OVERDUE_FEES` (`details: { students, amount }`) and `MISSING_MARKS` (`details: { count }`), present on a dry run and on a real run alike. `summary` reads like "Publish 18 marks - 2 students have overdue fees, 3 marks missing".
  - A real run sets `releaseStatus: PUBLISHED`, `publishedAt` = now, clears `withheldReason`, moves `version`, and writes one `MARK_CHANGE` row `PUBLISH` (no reason, no mark values) per mark it really changed, all in one transaction. The update is a single conditional statement, so two simultaneous publishes never both flip, or log, the same mark.
- **Withhold / unpublish** (`POST /api/marks/withhold`, `.../unpublish`): `markIds` (1-500) and a required `reason` (1-500 characters; 400 on `reason`); an unknown mark id is 404 and nothing changes. Withhold turns DRAFT and PUBLISHED marks into WITHHELD (storing `withheldReason`, clearing `publishedAt`); unpublish turns PUBLISHED marks back into DRAFT (clearing `publishedAt`). Marks not in a state the action applies to are left as they are, with their own reason, and counted as skipped. Answer: `{ changed, skipped, markIds }` (the ids that changed). Each changed mark moves `version` and gets one `WITHHOLD` or `UNPUBLISH` row with the reason. Publishing a WITHHELD mark again is the way to release it.
- **History rows** (DB-020, DB-023): `MARK` (old and new value), `PUBLISH`, `WITHHOLD` (reason) and `UNPUBLISH` (reason), each with who and when. The first entry of a mark writes none. Release rows carry no mark values.
- **Student results for staff** (`GET /api/students/{id}/results`): `{ student: { id, studentNumber, fullName }, summary: { total, draft, published, withheld }, items }`, newest assessment deadline first. Item: `{ markId, assessment: { id, title, deadline, module }, mark, isNonSubmission, classification, releaseStatus, withheldReason, publishedAt, version, updatedAt, enteredBy: { id, fullName }, history }` where `history` is newest first: `[{ id, change, oldMark, newMark, reason, changedBy: { id, fullName }, changedAt }]`. A student with no marks gets `items: []`. Unknown or malformed id is 404.

## Student self-service (`/api/me`)

All scoped to the signed-in student; no IDs of other students are accepted.

`GET /api/me` responds `{ "student": { id, studentNumber, fullName, email, dateOfBirth, programme: { id, code, name },
academicYear, yearOfStudy, status }, "canSubmit": { "allowed": true, "reason": null, "message": null } }`. At this point
`canSubmit` only reflects the enrolment status (`reason: "NOT_ENROLLED"` for Deferred, Withdrawn and Completed);
per-assessment reasons (closed, deadline passed, module not in programme) belong to `/api/me/assessments`.

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/api/me` | Student | Profile and status, plus what they may do (`canSubmit`, with reason if not). Staff → 403 |
| GET | `/api/me/fees` | Student | Summary, charges, non-voided payments, overdue message (shape under "Student fees" below) |
| GET | `/api/me/assessments` | Student | Assessments for their programme's modules with deadline, countdown data, own submission status |
| GET | `/api/me/results` | Student | Published marks with classification; other results as `{ "status": "NOT_AVAILABLE" }` only (shape under "Student results" below) |

### Student assessments (`/api/me/assessments`, settled in M13)

- **List** (`GET /api/me/assessments`): `{ now, items }`, not paged. `now` is the server's clock (ISO) for countdowns. The items are the assessments of the student's programme's modules plus any they have already submitted to (a programme change never hides work handed in). Order: assessments still accepting uploads with a deadline ahead, nearest first; then the rest, latest deadline first.
- **Item** (also `assessment` in the detail answer `{ now, assessment }` of `GET /api/me/assessments/{id}/submission`): `{ id, title, module: { id, code, title }, deadline, extended, closedAt, state, status, lateBy, canUpload, submission }`. `deadline` is the student's own (their extension's `newDeadline` if `extended`); `state` is `open`, `past-deadline` or `closed` against that deadline; `status` is `ON_TIME`, `LATE`, `NOT_SUBMITTED` or `CLOSED` (nothing submitted and uploads closed); `lateBy` is how late the current file is. `canUpload` is `{ allowed, reason, message, late }` with the same reason codes and wording as the upload-url errors (`late`: an upload now would be marked late). `submission` is `null` or `{ id, firstSubmittedAt, lastSubmittedAt, status, lateBy, currentFile, versions }`; a version is `{ id, version, fileName, mimeType, sizeBytes, sha256, uploadedAt, late, lateBy }` (newest first, `version` counts from 1), enough to render a receipt and to download with `GET /api/files/{id}/download`.
- **Detail:** an unknown or malformed id, or an assessment that is neither in the student's programme nor already submitted to, is 404. No session is 401; staff are 403. Only the signed-in student's own submission is ever read.

### Student results (`/api/me/results`, settled in M14)

- `GET /api/me/results` answers `{ items }`, not paged, newest assessment deadline first. There is one entry per assessment that is the student's: those of their programme's modules, any they submitted to, and any they were marked on.
- A **published** mark: `{ status: "PUBLISHED", assessment: { id, title, module: { id, code, title } }, mark, isNonSubmission, classification, publishedAt }` (`mark` is `null` for a non-submission, which the page shows as "NS").
- Everything else - a draft, a withheld mark, or no mark yet - is exactly `{ status: "NOT_AVAILABLE", assessment: { id, title, module } }`: no mark, no classification, no release status and no reason, so a student cannot tell a withheld result from one that has not been entered. Withdrawn and other students keep seeing their own published results. Only the signed-in student's marks are read; staff are 403, no session is 401.

### Student fees (`/api/me/fees`, settled in M15)

- `GET /api/me/fees` answers `{ now, summary, charges, payments, overdue }`. `now` is the server's clock (ISO), the moment the summary was worked out for. Only the signed-in student's rows are read; staff are 403, no session is 401, and any `studentId` or other id in the query is ignored.
- **Summary:** the staff summary of the Students "Shapes" block without `ageingBucket` (a Registry grouping): `{ charged, waived, paid, balance, credit, overdueAmount, oldestOverdueDays, nextDueDate, feeState }`. `balance` is negative and `credit` positive when the student is in credit; `nextDueDate` is the first uncovered charge due today or later.
- **Charges** (oldest due date first, waivers included): `{ id, kind, academicYear, description, amount, dueDate }`. A waiver (`kind: "WAIVER"`) has a negative `amount`, as stored. `createdBy` and `createdAt` are not sent, so a student never sees which staff member added an adjustment or waiver.
- **Payments** (newest first): `{ id, amount, method, paidAt, reference }`, only payments that are not voided. A voided payment is not read at all: neither it, its reason, nor `recordedBy`, `recordedAt`, `voidedBy` or `voidedAt` of any payment reach the student.
- **Overdue:** `null`, or `{ amount, days, message }` exactly when `feeState` is `overdue`. `message` is the sentence the pages show: `Overdue by 12 days. Please contact the Registry office.` (`1 day` in the singular).

## Exports (Could)

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/api/exports/overdue.csv` | Staff | Overdue list with ageing |
| GET | `/api/exports/marksheet/{assessmentId}.csv` | Staff | Marksheet for one assessment |
