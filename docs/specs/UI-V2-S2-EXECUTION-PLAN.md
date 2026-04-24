# UI-V2 Slice S2 — Database migrations + RLS

**Parent:** `docs/specs/UI-V2-EXECUTION-HANDOFF.md`
**Spec sections:** UI-V2-DESIGN-SYSTEM.md §7 (Data Model)
**Depends on:** S1 committed to `origin/ui-v2`
**Est. eng-days:** 1

## Goal

Three new tables live in Supabase with full RLS, audit coverage, and indexes. Migration sequence intact. `supabase migration list --linked` clean.

## Files to deliver

Migration numbers are **targets** — allocate sequentially from whatever `npm run migrations:check` reports at slice start. If 206 is the last sequenced migration, use 207/208/209 below.

- `supabase/migrations/207_user_dashboard_preferences.sql`
- `supabase/migrations/208_facility_metric_targets.sql`
- `supabase/migrations/209_alert_audit_log.sql`
- `supabase/migrations/210_rollback_ui_v2.sql` — the rollback script from `UI-V2-DESIGN-SYSTEM.md §12`, committed but NOT applied; present for S12 use.

DDL source of truth: `UI-V2-DESIGN-SYSTEM.md §7.1`, §7.2, §7.3. Copy verbatim, do not edit contracts.

## Additional requirements

1. Every table **enables RLS** in the same migration that creates it.
2. RLS policies use the existing `user_facility_access` table and `has_role()` function. If those names differ in the live schema, resolve before writing DDL — do not invent aliases. Check:
   ```bash
   grep -rn "has_role\|user_facility_access" supabase/migrations/ | head -20
   ```
3. Every table gets `haven_capture_audit_log` trigger (non-negotiable rule #2). `alert_audit_log` itself does not audit itself — append note in migration comment.
4. `facility_metric_targets.facility_id` FK target confirmed against real schema before writing. Run:
   ```bash
   grep -rn "create table public.facilities" supabase/migrations/
   ```
5. Indexes per `§7.1/§7.2/§7.3` committed in the same migration.

## Gate command

**Run with real Postgres verify — do NOT skip on a migration slice:**
```bash
# Ensure Docker is running
docker info > /dev/null 2>&1 || (echo "Start Docker Desktop first" && exit 1)

npm run segment:gates -- --segment "UI-V2-S2"
```

`qa.migrations-apply-postgres` **must be `passed`, not `skipped`**. If Docker won't start, do not proceed — log the issue and escalate.

## Acceptance

- All three tables created with RLS enabled and policies per spec §7.
- `npm run migrations:check` reports correct sequence.
- `qa.migrations-apply-postgres` gate check passes against real Postgres (not skipped).
- Rollback migration `210_rollback_ui_v2.sql` is committed (applied only at S12).
- Gate JSON PASS at `test-results/agent-gates/*-UI-V2-S2.json`.
- `UI-V2-STATUS.md` S2 box ticked with gate filename.

## Review hooks

- `agents/playbooks/security-rls-agent.md` — RLS policy sanity pass.
- `agents/playbooks/migration-integrity-agent.md` — sequence + idempotency + rollback pair.

## Commit message

`feat(ui-v2-s2): v2 migrations + RLS (prefs, thresholds, alert audit) [UI-V2-S2]`

## Gotchas

- Do NOT apply migrations to production in this slice. S2 is staging-only. Production application is gated at S12.
- `alert_audit_log` insert policy requires both `auth.uid() = actor_id` AND facility membership — test both failure modes in RLS tests.
- If `user_facility_access` turns out to be named differently (common variants: `user_facility_memberships`, `facility_users`), stop and ask before aliasing.
