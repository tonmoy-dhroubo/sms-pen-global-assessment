# UI review (M20)

A design review of the existing UI with the impeccable design skill (D-044), used as dev-time tooling. The boundary is
fixed: shadcn/ui and its ecosystem only (D-016), IBM Plex fonts, the single `--brand` accent, light and dark themes
(D-017), WCAG AA with the existing contrast and axe tests (D-040), no new dependencies, no behaviour change. This file
lists every finding, how it was found, and whether it was fixed or waived and why.

## Method

- **Detector, source:** `npx impeccable detect app components` (static scan of the `.tsx` files; `components/ui/**`,
  `lib/generated/**`, `tests/**`, `scripts/**` and `db/**` are out of scope through the local detector config).
  Baseline result: 0 findings.
- **Detector, rendered pages:** `npx impeccable detect <url>` (headless browser, desktop 1280x800 and phone 390x844)
  over all 18 surfaces, signed in as staff or as a student. Baseline: 2 findings on the role picker, 0 elsewhere.
- **Critique and audit:** a single-context pass (the skill asks for two isolated sub-agents; the work was done by one
  coder agent, so this review is degraded to single-context) over full-page screenshots of every surface at 1280 px
  (light and dark) and 375 px, plus the source of the components involved. Persisted critique snapshots and the live
  browser mode were not used.
- **Surfaces covered:** role picker `/`; staff dashboard; students list, new/edit form and record; fees; programmes;
  assessments list and detail with the Submissions and Marksheet tabs; student Overview, Assessments (list and detail),
  Fees and Results; the 404 and error pages.
- Severity: P0 blocks a task, P1 major or an AA failure, P2 minor, P3 polish.

Overall: the app is a coherent, token-driven shadcn UI. Audit scores (impeccable audit scale, 0 to 4 each): Accessibility
4 (axe clean in both themes), Performance 3, Theming 4, Responsive 3, Implementation integrity 3, total 17/20 (Good).
There is nothing P0 or P1. The findings below are layout and wording refinements.

## Findings

| # | Surface | Finding | Sev | Result |
| --- | --- | --- | --- | --- |
| 1 | Header (all pages) | The "Viewing as:" label of the role switcher wrapped onto two lines at desktop widths and squeezed the person's name ("Dr. Shirin Akht..."). Cause: `sm:not-sr-only` resets `white-space`, which undid `whitespace-nowrap`. | P2 | Fixed: `sm:whitespace-nowrap` (`components/session/role-switcher.tsx`) |
| 2 | Role picker `/` | Detector `nested-cards`: the student list was a bordered, rounded box inside a card. | P2 | Fixed: flat list with top and bottom hairlines (`components/session/role-picker.tsx`) |
| 3 | Role picker `/` | Detector `first-viewport-column-overflow`: the student column ran 178% of the viewport against a staff column at 28%, so the fold fell deep inside one column. | P2 | Fixed: the student list is capped at 20 rem and scrolls inside the card |
| 4 | Student record, Submissions | Three levels of boxes: card, a bordered box per assessment, a bordered receipt per file version. | P2 | Fixed: assessments are separated by dividers; the receipt keeps its box because it is the proof the section is about (`components/students/student-submissions-card.tsx`) |
| 5 | Programmes | Card, a bordered box per session, and a bordered table inside it, repeated 12 times; "Add a session schedule" was a solid primary button three times on one page. | P2 | Fixed: sessions are separated by a top hairline and the table has no frame of its own; the add button is an outline button like "Edit schedule" |
| 6 | Dashboard, overdue table | The age column was headed "For", which reads as a fragment. | P3 | Fixed: "Overdue for" (matches the Fees page) |
| 7 | Assessment detail (staff) | The first card is titled "Deadline" but also holds submitted, marked and published counts. | P3 | Fixed: "Deadline and progress" |
| 8 | Assessment detail and student assessments | The timer is labelled "Time left" but, once the deadline has passed, reads "Deadline passed 6 days ago". | P3 | Fixed: the label is "Time left" while open and "Status" afterwards (staff detail, student detail, student card) |
| 9 | Dashboard KPI cards | Five big-number cards (the "hero metric" pattern). | P3 | Waived: these are the five figures pages.md specifies for the Registry's morning view, each with a link to where it lives, and they scan well for an all-day operator |
| 10 | Dashboard, Fees | "Record payment" is an outline button on every row of the overdue and balances tables. | P3 | Waived: it is the row action the Registry uses most, already the small outline variant; a hidden or icon-only action would be harder to find and to use by keyboard |
| 11 | Student Overview | Three equal cards (fee balance, next deadlines, latest results), the last often empty. | P3 | Waived: they answer the three questions pages.md lists for the Overview; an empty card says so in words |
| 12 | Student Overview, Assessments | The countdown shows seconds ("10d 5h 28m 33s") even days out, which is ticking noise. | P3 | Waived: the "seconds always shown" format is documented in `components/format/countdown.tsx` and pinned by unit tests (M13, M18R); changing it is a behaviour change, not a style fix |
| 13 | Student Assessments | A disabled "Replace file" button is repeated on every past-deadline card. | P3 | Waived: pages.md requires the control to stay visible and disabled with the reason in plain words next to it |
| 14 | Assessment detail, Submissions tab | Each row stacks "Download" above the "1 version" toggle, which doubles the row height. | P3 | Waived: a no-wrap row made the table scroll sideways at 1280 px and clipped the toggle (tried and reverted); the stack is the responsive layout from M17 |
| 15 | Assessment detail, Marksheet tab | The "Saved" column is empty until a row is edited. | P3 | Waived: it is the per-row save state (M14) and the live region screen readers rely on |
| 16 | Student record, Profile | Status and fee badges repeat what the header and the Fees card already show. | P3 | Waived: the printed fee statement uses the Profile card on its own (M16) |
| 17 | Error and 404 pages | Reviewed: both reuse `EmptyState`/`ErrorState` with a plain message and a way back. | - | No finding |
| 18 | Dark theme, 375 px | Reviewed every surface at 1280 px dark and at 375 px light: no contrast, overflow or clipping problem beyond the items above. | - | No finding |

Before and after screenshots (1280 px, light): [m20/](screenshots/m20/) (role picker, programmes, student record).

## Detector waivers

None. After the fixes the detector reports nothing on source or on the rendered pages, so no
`impeccable ignores add-value` was needed. The two things the detector could have objected to, the IBM Plex fonts and
the `--brand` green, were not flagged. (The local `.impeccable/config.json` is not committed; its only entries are the
out-of-scope globs listed in Method.)

## Result

| Check | Before | After |
| --- | --- | --- |
| `impeccable detect app components` (source) | 0 findings | 0 findings |
| `impeccable detect <url>`, 18 surfaces, desktop | 2 findings (role picker) | 0 findings |
| `impeccable detect <url>`, 18 surfaces, 390 px | 1 finding (role picker) | 0 findings |
