# Seed plan

The demo data a reviewer sees after `npm run db:seed`. It is designed so that **every edge case in
[../docs/edge-cases.md](../docs/edge-cases.md) is visible in the seeded data**, and the dashboard looks like a busy
registry rather than an empty one. The README "demo tour" is written from this file.

## Rules

1. **All dates are relative to the moment the seed runs** (`T`, in `Asia/Dhaka`). Never hard-code a date.
   "Overdue by 20 days" must still be 20 days whenever a reviewer runs it.
2. **Sessions are derived from `T`.** Current session `S` starts in the July on or before `T`
   (`month >= 7 ? year : year - 1`), labelled e.g. `2026-27`. Earlier sessions are `S-1`, `S-2`, `S-3`.
3. **Deterministic.** Use a fixed-seed pseudo-random generator for any filler values, so two runs produce the same data.
4. **Idempotent reset.** `npm run db:reset` drops, migrates and seeds. The seed also empties and refills the
   submissions bucket.
5. **Self-check.** After seeding, the script recomputes key facts with the real service functions and fails loudly if
   they don't match this plan (e.g. the overdue set, the credit student, the late submissions).
6. **Real files.** Submissions upload small fixture files (valid PDF and DOCX, committed under `db/seed/fixtures/`)
   to MinIO so downloads and receipts work.
7. Emails use the reserved domain `example.edu` (`firstname.lastname@student.example.edu`).
8. Money in BDT. Student IDs follow DB-015 (year = start year of first session).

## Staff (3)

| Name | Job title | Used for |
| --- | --- | --- |
| Kamrul Hasan | Registry Officer | Default staff identity; records most payments and status changes |
| Dr. Shirin Akhter | Senior Lecturer | Creates assessments, enters and publishes marks |
| Fatema Begum | Finance Officer | Records some payments and the voided payment |

## Programmes (3)

| Code | Name | Fee per session (BDT) | Billing |
| --- | --- | --- | --- |
| `BSC-CSE` | BSc in Computer Science & Engineering | 3,20,000 | 2 instalments of 1,60,000: due `T-40d` and `T+80d` |
| `BBA` | Bachelor of Business Administration | 2,60,000 | 1 charge, due `T-20d` |
| `BA-ENG` | BA (Hons) in English | 1,80,000 | 1 charge, due `T-10d` |

Earlier sessions use the same amounts (fee rises are out of scope); their due dates are in the past and almost all are
fully paid.

## Modules (8) — shared modules show the many-to-many link

| Code | Title | Programmes |
| --- | --- | --- |
| `CSE101` | Structured Programming | BSC-CSE |
| `CSE201` | Data Structures | BSC-CSE |
| `MAT101` | Calculus I | BSC-CSE, BBA |
| `BBA101` | Principles of Management | BBA |
| `BBA102` | Financial Accounting | BBA |
| `ENG101` | English Composition | BSC-CSE, BBA, BA-ENG |
| `ENG201` | Introduction to Literature | BA-ENG |
| `ENG210` | Academic Writing | BA-ENG |

## Assessments (10)

| # | Module | Title | Deadline | State it demonstrates |
| --- | --- | --- | --- | --- |
| A1 | CSE101 | Lab Assignment 1 | `T-21d` 23:59 | Closed (`T-14d`); fully marked; **published** |
| A2 | MAT101 | Quiz 1 | `T-14d` 23:59 | Marked, all **draft** → "results to publish" on the dashboard; includes boundary marks |
| A3 | ENG101 | Essay 1 | `T-7d` 23:59 | Mix of on time, **late** (5 hours, 2 days), **resubmitted**, missing; partly marked |
| A4 | BBA101 | Case Study | `T-3d` 23:59 | Submissions incl. **late by 1 hour**; not marked yet |
| A5 | CSE201 | Project Proposal | `T+5d` 23:59 | **Open**; some submitted (can still replace), some not |
| A6 | BBA102 | Assignment 1 | `T+10d` 23:59 | Open; nobody has submitted |
| A7 | ENG201 | Reading Response | `T-30d` 23:59 | Closed; marked; mix of **published** and **withheld** |
| A8 | ENG210 | Portfolio | `T+2d` 23:59 | Open; shows the **countdown** |
| A9 | CSE101 | Lab Assignment 2 | `T-1d` 23:59 | Deadline passed but **not closed**: late uploads still accepted |
| A10 | MAT101 | Quiz 2 | `T+14d` 23:59 | Open; far deadline |

## Students (30)

Status totals: **21 Enrolled, 3 Deferred, 3 Withdrawn, 3 Completed**. Overdue: **8** (four 1–30 days, two 31–60,
two 60+). Credit: **1**.

| # | Name | Programme | Year | Status | Fees | Academic story |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Ayesha Rahman | BSC-CSE | 1 | Enrolled | Instalment 1 paid; instalment 2 **outstanding, not yet due** | Model student: always on time, Distinction marks, published |
| 2 | Tanvir Hasan | BSC-CSE | 1 | Enrolled | **Overdue 31–60**: paid 60,000 of instalment 1 | Late on A3 (2 days); results **withheld — outstanding fees** |
| 3 | Nusrat Jahan | BSC-CSE | 1 | Enrolled | **Credit** of 5,000 (overpaid via bKash) | On time |
| 4 | Arif Hossain | BSC-CSE | 2 | Enrolled | **Overdue 60+**: 40,000 still unpaid from session `S-1` and nothing paid yet this session (payments settle the oldest charge first, D-028, so the oldest unpaid charge sets the age) | Normal |
| 5 | Farhana Akter | BSC-CSE | 2 | Enrolled | Paid | Late on A9 by 5 hours |
| 6 | Rakib Islam | BSC-CSE | 1 | **Deferred** (medical; returns next session) | Instalment 1 paid | Cannot submit (A5 shows why) |
| 7 | Sadia Chowdhury | BSC-CSE | 3 | Enrolled | Paid; one payment **voided** ("wrong amount entered") and re-recorded | Normal |
| 8 | Mahmud Karim | BSC-CSE | 1 | **Withdrawn** (transferred to another university) | **Overdue 31–60**: owes 1,10,000 — stays on the overdue list | Earlier submissions kept |
| 9 | Tasnim Ahmed | BSC-CSE | 2 | Enrolled | **Waiver** −40,000 (merit scholarship); rest paid | Normal |
| 10 | Imran Kabir | BSC-CSE | 4 | **Completed** | All sessions paid | Full published marksheet |
| 11 | Sumaiya Haque | BSC-CSE | 1 | Enrolled | Paid via **Nagad** | **Non-submission (NS)** on A1; **39.5 on A2 → Pass** (boundary) |
| 12 | Fahim Rahman | BSC-CSE | 3 | Enrolled | Paid | Published A1 mark **changed after appeal** (reason in history) |
| 13 | Jannatul Ferdous | BBA | 1 | Enrolled | **Overdue 1–30**: nothing paid | On time |
| 14 | Shakil Ahmed | BBA | 1 | Enrolled | Paid by bank transfer | **Late on A4 by 1 hour**; **69.5 on A2 → Distinction** (boundary) |
| 15 | Mehjabin Sultana | BBA | 2 | Enrolled | **Overdue 1–30**: 15,000 short | Normal |
| 16 | Rafiqul Alam | BBA | 1 | Enrolled | Paid | **Duplicate check demo**: creating "Rafiqul Alam" with the same date of birth warns |
| 17 | Nadia Islam | BBA | 3 | **Deferred** (family reasons) | Paid | Cannot submit |
| 18 | Sabbir Hossain | BBA | 2 | **Withdrawn** | Paid in full — withdrawn with no debt (contrast with #8) | — |
| 19 | Lamia Khan | BBA | 1 | Enrolled | Paid | **59.4 on A2 → Pass** (boundary: stays Pass) |
| 20 | Ashraful Haque | BBA | 4 | **Completed** | All paid | Full published marksheet |
| 21 | Raisa Mahmud | BBA | 1 | Enrolled | **Overdue 1–30** | Results **published despite fees** (staff saw the warning and chose to publish) |
| 22 | Tahmid Chowdhury | BBA | 2 | Enrolled | Paid | **Resubmitted** A3 before the deadline (2 file versions) |
| 23 | Anika Tabassum | BA-ENG | 1 | Enrolled | Paid | On time |
| 24 | Zubair Hasan | BA-ENG | 1 | Enrolled | **Overdue 1–30**: full 1,80,000 | Missing A3 |
| 25 | Tahsin Rahman | BA-ENG | 2 | Enrolled | Paid | **Late on A3 by 2 days** |
| 26 | Moumita Das | BA-ENG | 1 | Enrolled | Paid | Distinction on A7, published |
| 27 | Arnab Saha | BA-ENG | 3 | Enrolled | Paid | A7 **withheld — academic misconduct investigation** (non-fee reason) |
| 28 | Priyanka Roy | BA-ENG | 1 | **Deferred** | Paid | Cannot submit |
| 29 | Habib Ullah | BA-ENG | 2 | **Withdrawn** | **Overdue 60+**: withdrew during session `S-1` owing 90,000 of that session's fee; no charges for the current session | — |
| 30 | Samira Siddiqui | BA-ENG | 4 | **Completed** | All paid | Full published marksheet |

Background marks for everyone else are deterministic filler in the 45–85 range.

## What each dashboard figure should show after seeding

| Figure | Expected |
| --- | --- |
| Enrolled students | 21 (3 deferred, 3 withdrawn, 3 completed) |
| Overdue balances | 8 students: 1–30 days ×4, 31–60 ×2, 60+ ×2 |
| Late submissions (recent) | At least 5 (A3, A4, A9) |
| Results awaiting publication | All of A2, plus the marked part of A3 |
| Withheld results | 2 reasons shown: outstanding fees (#2), misconduct investigation (#27) |
