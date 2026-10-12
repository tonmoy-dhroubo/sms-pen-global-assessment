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
- **Colour palette.** The user has not chosen; the dark green accent (`#2F6B3F`, the `--brand` token) stays unless
  they decide otherwise. Changing it is a one-line edit in `app/globals.css`.

## Resolved

- **MinIO image source** → user confirmed keeping the `pgsty` community fork (D-027).

- **Command search** → header quick search with `Ctrl+K` for staff (milestone M16).
- **Edge-case questions** → D-023, D-024, DB-019.
- **Data model questions** → DB-009 to DB-020.
- **Locale, Student ID year, seed size, pages, API, role switcher, git workflow, build plan** → D-018 to D-022,
  DB-015, [pages.md](pages.md), [api.md](api.md), [milestones.md](milestones.md).
