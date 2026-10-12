# TODO — remaining work

Status on 2026-10-12: M00–M18 are merged and the submission is complete on `main`. What is left is review by the
candidate and the optional hosted deployment (M19). To pick up later.

## 1. Review before submitting (candidate)

- [ ] Read [README.md](../README.md) end to end, especially **"How I used AI"** (15% of the grade). It is written in
      the candidate's voice from [ai-usage.md](ai-usage.md), the decision logs and git history — adjust anything that
      isn't how you would say it. (~20–30 min)
- [ ] Skim the merged pull requests [#1](https://github.com/tonmoy-dhroubo/sms-pen-global-assessment/pull/1) to
      [#19](https://github.com/tonmoy-dhroubo/sms-pen-global-assessment/pull/19) and the decisions Claude made while you
      were away: D-025 to D-041 in [decisions.md](decisions.md), DB-021 to DB-026 in
      [../db/decisions.md](../db/decisions.md). (~30–60 min)
- [ ] Optional: follow the README's "Run locally" steps in a fresh clone and walk the demo tour. (~15–20 min)
- [ ] Optional: decide the accent colour (currently dark green `#2F6B3F`, the `--brand` token in `app/globals.css`).

## 2. M19 — hosted demo on Vercel (optional)

Plan: [milestones.md](milestones.md) (M19), [discussions.md](discussions.md) ("Hosted setup"), D-011 to D-014,
D-030. Estimated 1–2 hours in total.

**Candidate (~15–20 min of clicking; Claude does not handle live credentials):**

- [ ] Connect the **Vercel** and **Supabase** connectors in Claude (Connectors settings).
- [ ] Create a Supabase project; in Storage, create S3 access keys.
- [ ] Import the GitHub repo into Vercel (authorise Vercel's GitHub access). After that, pushes to `main` deploy.
- [ ] Paste the secrets into Vercel's environment variables, using the list Claude provides (`DATABASE_URL`,
      `DIRECT_URL`, `S3_*`, `SESSION_SECRET` — a real random one — `APP_TIMEZONE`, `DEMO_MODE=true`, …).

**Claude + coder agent (~45–90 min):**

- [ ] Create the Neon project/database (the Neon connector is already connected); run migrations and seed it.
- [ ] Create the Supabase bucket (private) and set CORS for the Vercel origin.
- [ ] Verify presigned PUT/GET against Supabase's S3 endpoint (open risk; fallback: drop the signed
      `content-length` or use Supabase's own signed upload URLs in the hosted adapter only — D-030).
- [ ] Demo safeguards (D-014): "Demo environment" banner (already built, `DEMO_MODE`) and a way to reset the hosted
      demo data.
- [ ] Fix any deployment problems; add the live URL to the README.
