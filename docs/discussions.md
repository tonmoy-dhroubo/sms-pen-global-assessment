# Discussions & open questions

Points still being worked out. When one is settled, record it in [decisions.md](decisions.md) and mark it here
as resolved with the decision ID.

## Open

- **Hosted setup (deferred until features work).** Current stage is local only: Docker + localhost.
  When we deploy:
  - Neon connector is already connected (create project, branches, migrations).
  - Supabase and Vercel connectors exist but are not connected; Vercel's is mostly read-only.
  - The user must: connect those connectors, import the repo into Vercel (then pushes to `main` deploy), and paste
    secrets into Vercel env vars. Claude does not handle live credentials.
  - Check whether Neon Object Storage is S3-compatible; if so it could replace Supabase Storage (would revise D-012).

- **Supabase presigned URLs (verify when building uploads).** D-013 relies on presigned `PUT`/`GET` URLs from
  Supabase's S3-compatible endpoint. Confirm this works with the AWS SDK presigner and that CORS can be set for the
  Vercel origin. Fallback: use Supabase's own signed upload URLs in the hosted storage adapter only.
- **Colour palette.** Neutral base with one accent, or PEN Global's green branding?
- **Command search (cmdk).** Global "find a student by name or ID" palette for staff — include or skip?
- **Edge cases.** Checklist in [edge-cases.md](edge-cases.md); three open questions at its end (priority split,
  late-upload timing, mark rounding).
- **Data model.** Draft ER diagram in [db/er-diagram.md](../db/er-diagram.md). Awaiting confirmation of the
  proposed answers DB-009 to DB-014 in [db/decisions.md](../db/decisions.md).

## Resolved

_None yet._
