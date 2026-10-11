# Requirements

Our summary of the assessment brief. The original PDF is kept locally only (not for distribution).

## Goal

A focused web app for the Registry function of a student management system — not a full platform.
The graders value product thinking, edge-case handling and documented reasoning over feature volume.

## Workflows

### 1. Student enrolment

- Create and manage student records: full name, email, date of birth, programme, academic year, enrolment status.
- Auto-generated unique Student ID in the form `SMS-<year>-<seq>` (e.g. `SMS-2025-0001`).
- Statuses: Enrolled, Deferred, Withdrawn, Completed.
- Search and filter by name, ID, programme or status.

### 2. Fees & payments

- Fee amount per student, derived from their programme.
- Record payments: amount, date, reference number.
- Outstanding balance shown live.
- Students with an overdue balance are flagged on the Registry dashboard.

### 3. Assessment submission

- Staff create assessments: title, module, submission deadline.
- Students upload a PDF or DOCX against an open assessment.
- One submission per student per assessment; resubmission allowed before the deadline.
- Late submissions are accepted but visibly flagged.

### 4. Marksheet & results

- Staff enter a numeric grade 0–100 per student per assessment.
- Classification: Pass ≥ 40, Merit ≥ 60, Distinction ≥ 70 (below 40 is a fail).
- Staff publish or withhold results per student.
- Students only see their marksheet once it is published.

## Deliverables

- GitHub repo with all code committed (no zip files).
- README: running locally, `.env` variables, short section on AI usage during the build.
- Seed script with demo data: at least 5 students, 2 programmes, fees and sample grades.
- Basic role separation: Staff view and Student view (auth optional; a role toggle is acceptable).
- Deadline: within 7 working days.

## Constraints

- Next.js 14+ App Router; PostgreSQL + Prisma (commit `schema.prisma`).
- Tailwind or a component library, shadcn/ui preferred.
- No other backend framework; no mocked data in `useState`.
- `.env.example` committed, real credentials never committed.

## Grading

| Dimension | Weight |
| --- | --- |
| Stakeholder understanding — data model and UI match how a Registry team works | 30% |
| Feature intuition — edge cases handled unprompted (overdue fees, late submissions, withheld results) | 30% |
| Technical quality — clean schema, working API routes, basic error handling | 25% |
| AI usage — used effectively and clearly explained in the README | 15% |
