# db/

Everything about the database lives here.

| Path | What it holds |
| --- | --- |
| [er-diagram.md](er-diagram.md) | Mermaid ER diagram of all tables and relationships |
| [er-diagram.png](er-diagram.png) | Rendered export of the ER diagram (re-export when it changes) |
| [decisions.md](decisions.md) | Database decisions (DB-NNN): keys, money, auditing and rules |
| [seed-plan.md](seed-plan.md) | Demo data plan: 30 students, personas, relative dates |
| `schema.prisma` | Prisma schema — the source of truth once written (not yet created) |
| `migrations/` | Prisma migrations, committed (not yet created) |
| `seed/` | Seed and demo-reset scripts (not yet created) |

Prisma's default folder is `prisma/`; `prisma.config.ts` at the repo root points it here instead (DB-008).

## Calculated values (never stored)

Storing these would let them drift out of sync with the rows they come from, so the service layer computes them.

| Value | Rule |
| --- | --- |
| Balance | Sum of fee charges − sum of non-voided payments. Negative = credit. |
| Overdue amount | Sum of charges with `dueDate` before today − sum of non-voided payments. Overdue if > 0. |
| Effective deadline | The student's extension `newDeadline` if one exists, else the assessment `deadline`. |
| Late | Latest file's `uploadedAt` > effective deadline. |
| Classification | Round the mark half-up to a whole number, then: < 40 Fail; ≥ 40 Pass; ≥ 60 Merit; ≥ 70 Distinction. NS = Fail (DB-019). |
