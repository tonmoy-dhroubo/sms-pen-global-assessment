# Pages and routes

Every screen in the app: its route, who can open it, and what it must show. The coder builds from this; anything not
covered here is a question for the planner, not a guess. Visual reference: the Claude Design mockup
(https://claude.ai/artifact/X9EoHwpdQfjU2QKody2Eyy). Data comes from [api.md](api.md).

## Global layout

- **Header (every page, both roles):** app name · global search (staff only) · theme toggle (Light / Dark / System,
  D-017) · role switcher.
- **Role switcher (D-020):** a header dropdown showing "Viewing as: …".
  - Options: each seeded staff member, then a searchable list of students (name + Student ID).
  - Switching sets the role cookie and lands on that role's home: Staff → `/staff`, Student → `/student`.
  - No cookie, or a cookie pointing at a record that no longer exists → `/` (role picker).
- **Staff sidebar:** Dashboard · Students · Fees · Assessments · Programmes. Collapses to a menu at phone width.
- **Student navigation:** tabs under the header: Overview · Fees · Assessments · Results.
- **Hosted demo only:** "Demo environment" banner (D-014).
- Every list and panel has a loading state (skeleton), an empty state with guidance, and an error state with retry.
- Money: `৳1,25,000.00` (lakh grouping). Dates: `11 Oct 2026`; date-times `11 Oct 2026, 23:59` — all in Asia/Dhaka (D-018).

## Status badges (one component, used everywhere)

| Group | Values | Tone |
| --- | --- | --- |
| Enrolment | Enrolled · Deferred · Withdrawn · Completed | green · amber · grey · blue |
| Fees | Paid · Outstanding · Overdue · Credit | green · grey · red · blue |
| Submission | On time · Late (+ how late) · Not submitted · Closed | green · amber · grey · grey |
| Result | Draft · Published · Withheld | grey · blue · amber |
| Assessment | Open · Past deadline · Closed | green · amber · grey |
| Classification | Distinction · Merit · Pass · Fail · NS | text label, neutral |

Badges always carry a text label; colour is never the only signal.

## Public

| Route | Purpose |
| --- | --- |
| `/` | Role picker: choose a staff member or a student. Also the fallback when the role cookie is missing or invalid. |

## Staff

| Route | Shows | Actions |
| --- | --- | --- |
| `/staff` | **Dashboard.** KPI cards: enrolled students (with deferred/withdrawn/completed counts), total outstanding, overdue students, late submissions (last 14 days), results awaiting publication. Overdue table with ageing buckets (1–30 / 31–60 / 60+). "Needs attention" list: recent late submissions, withheld results, assessments with draft marks. | Record payment (opens dialog), jump to student or assessment |
| `/staff/students` | **Student list.** Search (name, partial ID, email; case- and accent-insensitive). Filters: programme, status, session, year of study, fee state (overdue / outstanding / credit). Withdrawn and Completed hidden unless the status filter includes them. Server-side pagination and sort; filters live in the URL. | New student, open record |
| `/staff/students/new` | **New student form.** Full name, email, date of birth, programme, session, year of study. Student ID preview note ("assigned on save"). | Save. Probable duplicate → warning dialog listing matches, with "Create anyway". |
| `/staff/students/[id]` | **Student record.** Header: name, Student ID, status badge, fee badge, programme, session, year, email, DOB. Sections: **Fees** (summary: charged, waived, paid, balance or credit, overdue amount and age; charges table; payments table with voided rows struck through), **Submissions** (per assessment: deadline, status badge, file versions, receipt), **Results** (grade, classification, release status, history), **Activity timeline** (status changes, payments, voids, mark changes and releases). | Edit details, change status (dialog with allowed transitions only, reason required where needed), record payment, add adjustment/waiver, void payment, publish/withhold this student's results |
| `/staff/students/[id]/edit` | Edit form (same fields as new, minus Student ID). Version conflict → "This record changed since you opened it" with reload. | Save |
| `/staff/fees` | **Fees overview.** All students with a balance: outstanding vs overdue, ageing bucket, last payment. Filters: programme, fee state, ageing bucket. | Record payment, export CSV (Could) |
| `/staff/programmes` | Programmes with their modules and fee schedule per session (instalments, amounts, due dates). | Add or edit a session's fee schedule (affects new charges only — existing charges never change) |
| `/staff/assessments` | Assessment list: module, title, deadline (with "in 2 days" / "3 days ago"), open/closed, submission count, late count, marking progress, release progress. | New assessment |
| `/staff/assessments/new` | Form: module, title, deadline (date + time, Asia/Dhaka). | Save |
| `/staff/assessments/[id]` | **Assessment detail.** Header with deadline, open/closed. **Submissions tab:** every eligible student with status (on time / late + how late / not submitted), file versions, download. **Marksheet tab:** grade entry grid — one row per eligible student: submission status, mark input (0–100, one decimal) or NS toggle, live classification, release status. Keyboard-friendly (Tab/Enter moves down). Unsaved-changes warning. | Edit (deadline change warns that late flags will be recalculated), close / reopen, publish (preview dialog: counts, students with overdue fees, missing marks), withhold (reason), unpublish (reason), change a published mark (reason) |

## Student

All student pages show only the signed-in student's own data. Another student's ID in a URL or API call → 404.

| Route | Shows | Actions |
| --- | --- | --- |
| `/student` | **Overview.** Greeting, Student ID, programme, status. Cards: fee balance (with overdue message if any), next deadlines with countdowns, latest published results. Deferred/withdrawn students see a notice explaining what they can and can't do. | — |
| `/student/fees` | Charges, waivers, payments (voided payments hidden), balance or credit, next due date. Overdue message: "Overdue by N days. Please contact the Registry office." | — |
| `/student/assessments` | Assessments for the student's programme modules: deadline in Asia/Dhaka with countdown, status, current file and receipt. Rules shown in plain words: "You can replace your file until the deadline. Uploads after the deadline are accepted but marked late. Submission time is when your upload finishes." | Upload / Replace file (only when allowed). Disabled with an explanation when closed, when an on-time submission exists after the deadline, or when the student is deferred/withdrawn. |
| `/student/assessments/[id]` | Assessment detail with submission history and receipts (time, file name, size, SHA-256). | Upload / replace, download own file |
| `/student/results` | Published marks only: assessment, module, mark, classification. Draft and withheld results appear as "Not yet available" — no mark, no reason. | — |
