# AI usage log

The brief asks for a README section on how AI was used. Log meaningful AI contributions here as we go,
then summarise them in the README.

For each entry note: what the AI did, which tool, and what we reviewed, changed or rejected.

| Date | Tool | What it did | Human review / changes |
| --- | --- | --- | --- |
| 2026-10-11 | Claude Code | Initialised the git repo, set the remote, and moved the default branch to `main` | Branch naming chosen by me |
| 2026-10-11 | Claude Code | Drafted `AGENTS.md` and the `docs/` structure, including the requirements summary from the brief | Doc structure requested by me |
| 2026-10-11 | Claude Code | Proposed stack options and trade-offs; wrote up `docs/tech-stack.md` and D-003–D-010 | I chose npm, MinIO, local-only and the role switcher |
| 2026-10-11 | Claude Code | Compared hosted Postgres and free S3-compatible storage; flagged Vercel's upload size limit and proposed direct-to-bucket uploads (D-011–D-014) | I chose Docker + Neon and MinIO + Supabase Storage |
| 2026-10-11 | Claude Code | Set up two subagents: `planner` (Opus 5.5) for decisions and docs, `coder` (Sonnet 5.5) for code and tests (D-015) | Split and model choice were mine |
| 2026-10-11 | Claude Code | Compared component libraries and proposed the shadcn ecosystem plus status-badge conventions (D-016, D-017) | I required dark mode with a global toggle |
| 2026-10-11 | Claude Design | Minimal 3-screen mockup (staff dashboard, student record, student view): https://claude.ai/artifact/X9EoHwpdQfjU2QKody2Eyy | Under review |
| 2026-10-12 | Claude Code | Wrote the seed plan (30 personas), pages and routes, API contract, decisions D-018–D-024 and DB-015–DB-020, and the 20-milestone tracker | I set locale (Bangladesh, BDT), seed size, header role switcher and asked for milestone-by-milestone delivery; delegated the rest |
| 2026-10-12 | Claude Code (coder agent) | Implemented M00: line-ending/editor config, `.nvmrc`, `.gitignore`, PR template and README skeleton on branch `m00-repo-foundations` | Reviewed in the PR before merge |
