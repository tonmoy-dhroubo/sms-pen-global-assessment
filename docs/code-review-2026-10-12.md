# Whole-system code review

Date: 12 October 2026

Project: Student Management System — Registry module

Reviewed commit: `65c5ba2`

The system has a solid foundation, but the review found seven actionable defects, including two high-priority risks to submitted files. Fixing these before submission is recommended.

The review covered documented requirements, API routes, business services, database schema, storage flow, Staff/Student views, tests, and deployment configuration. Source line references below refer to the reviewed commit. This report records the review results; it does not indicate that fixes have been implemented.

## Findings, ordered by severity

### 1. [P1] A confirmed submission can still be overwritten using its upload URL

Source: [lib/services/submissions.ts, line 486](../lib/services/submissions.ts#L486)

Confirmation records the same object key that the 15-minute presigned PUT URL can write. After confirmation succeeds, the student can reuse that URL with different contents of the same size. Downloads then return changed contents while the database retains the original fingerprint, submission time, and validation result. This also bypasses the on-time replacement restriction.

**Fix:** Finalize submissions into an immutable object or pinned storage version. Validate and download that exact finalized content. The second HEAD check only protects the validation window.

### 2. [P1] Upload cleanup can delete a successfully confirmed submission

Source: [lib/services/upload-cleanup.ts, line 45](../lib/services/upload-cleanup.ts#L45)

Cleanup selects expired, unconfirmed rows and deletes their objects before conditionally deleting the database rows. A confirmation that began before expiry can commit after cleanup's selection. Cleanup then deletes the confirmed file; its `confirmedAt: null` condition preserves the row but cannot restore the object.

**Evidence:** A controlled interleaving probe reproduced a confirmed row with its object deleted and cleanup reporting no failure. This was a simulated interleaving, not a live storage test.

**Fix:** Coordinate confirmation and cleanup through a shared lock or atomic claim before deleting anything.

### 3. [P2] Waivers can leave cleared charges contributing to overdue ageing

Source: [lib/services/rules/fees.ts, line 98](../lib/services/rules/fees.ts#L98)

`oldestUnpaidOverdue` is set on the first uncovered charge and never reconsidered when a later waiver clears that debt.

**Reproduced example:** ৳1,000 due July 1, fully waived August 1, followed by ৳500 due October 1. On October 12, the service correctly reports ৳500 overdue but incorrectly reports **103 days / 60+**, instead of **11 days / 1–30**. This affects dashboard ageing, overdue lists, and student notices.

**Fix:** Track the remaining unpaid charges after applying waivers, then derive their age.

### 4. [P2] Submission ordering changes the recorded arrival time and can incorrectly mark work late

Source: [lib/services/submissions.ts, line 463](../lib/services/submissions.ts#L463)

To order versions, confirmation moves an arrival timestamp forward by one millisecond when it is equal to or earlier than the previous version. Two files arriving in the deadline's final second can therefore pass the on-time validation, yet the second receipt becomes late. That late classification subsequently permits replacement after the deadline.

**Evidence:** A focused rule probe reproduced this sequence.

**Fix:** Preserve the actual arrival time and use a separate version sequence for ordering.

### 5. [P2] The activity timeline remains stale after successful changes

Source: [components/students/activity-timeline.tsx, line 184](../components/students/activity-timeline.tsx#L184)

Events and pagination state are initialized from props only once. Recording a payment, changing status, or publishing results calls `router.refresh()`, but the mounted timeline ignores the newly supplied events. Staff can see updated balances alongside a history missing the action they just performed.

**Evidence:** A component rerender probe reproduced the missing event.

**Fix:** Reconcile refreshed timeline data with local pagination state, or deliberately remount it when the underlying history changes.

### 6. [P2] Countdown timers double-count elapsed time after a server refresh

Source: [components/format/countdown.tsx, line 51](../components/format/countdown.tsx#L51)

The timer keeps elapsed time measured from its original mount while accepting an updated `serverNow`. After `router.refresh()`, both values account for the same elapsed period.

**Reproduced example:** A ten-minute countdown correctly reaches nine minutes; refreshing with the current server time makes it display eight minutes.

**Fix:** Reset the elapsed-time baseline whenever `serverNow` changes.

### 7. [P2] Dashboard cards contain invalid nested headings

Source: [components/dashboard/ageing-breakdown.tsx, line 31](../components/dashboard/ageing-breakdown.tsx#L31)

`CardTitle` already renders `<h2>`, but Ageing Breakdown, Overdue Balances, and Needs Attention each put another `<h2>` inside it. React explicitly reports this as a hydration error during the existing tests.

**Fix:** Put the title text directly inside `CardTitle` and add a check that catches hydration warnings.

## What is working well

- Clear separation between routes, services, validation, and pure business rules.
- Consistent server-side role checks and student-scoped endpoints.
- Student results responses omit unpublished marks and withholding reasons.
- Decimal-based money calculations, database constraints, optimistic locking, and financial audit records.
- Extensive automated tests and documented product decisions.

The demo role switcher and omitted extension-management UI are documented scope decisions and were not classified as defects.

## Verification and limitations

| Check | Result |
| --- | --- |
| Unit tests | **1,070 passed across 59 files** |
| TypeScript | Passed |
| ESLint | Passed |
| Production build | Passed using example environment values |
| Prisma schema validation | Passed |
| Additional component probes | Both reproduced the reported defects |
| Database/storage integration and browser workflows | Not verified: Docker daemon unavailable |
| Hosted deployment | Not verified |

The passing tests currently miss these boundary conditions. No application changes were made during the review, temporary probes were removed, and the working tree was clean at the end of the review. This export adds documentation only. Verification results above are from the review, not a separate rerun for this export.
