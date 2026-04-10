# Security / RLS agent

## Role

Ensure the segment does not weaken **auth, workspace boundaries, secrets, or auditability**.

## Checklist (per segment)

- No secrets or tokens committed; use env vars and server-only modules.
- Document new API routes: who may call them, and what data they expose.
- If using Supabase: RLS policies reviewed for new tables/views; service role usage justified.

## Gate integration

Automated checks (run by `npm run segment:gates` and CI — see `docs/agent-gates-runbook.md`):

- `node scripts/check-env-example.mjs` — no JWT-shaped or live-key placeholders in `.env.example`
- `node scripts/check-tracked-secrets.mjs` — git-tracked files scanned for common secret shapes
- `npm run audit:ci` — `npm audit --audit-level=high`
- `npm run secrets:gitleaks` — gitleaks (binary or Docker); on CI, Docker or binary must be available
- `npm run migrations:verify:pg` — replays all SQL migrations against a throwaway Postgres 16 container (when Docker is available); **required on CI** via `REQUIRE_PG_VERIFY=1`

Record any additional manual RLS/auth review in the segment handoff and in `checks[].stdout` when relevant.

## See also

- `docs/Autonomous.md` — autonomous loop continuity (BOOT / FIND / RECORD) between sessions.
