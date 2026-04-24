# Migration Replay Hardening — tracked debt

**Status:** Open
**Created:** 2026-04-24
**Origin:** Surfaced while executing `UI-V2-S2` when `scripts/pg-verify-migrations.mjs` stalled on host-side Docker exec loops and historical migrations.

This is NOT a UI-V2 slice. It's standalone repo-health debt. Work it on a dedicated branch `hardening/migration-replay`, not on `ui-v2`.

## What's broken

### 1. `scripts/pg-verify-migrations.mjs` is unreliable on macOS + Docker Desktop

The current verifier loops per-migration via host-side `docker exec ... psql` calls. Symptoms observed:
- Replay stalls for >30 minutes without progress on 210-migration sequence.
- Docker CLI reads (`docker logs`, `docker ps`, `docker exec`) hang after prolonged use.
- Readiness probes time out even when Postgres is up.

Attempted remediation during UI-V2-S2 (on `ui-v2` working tree, should be moved to hardening branch):
- Patched verifier to single `docker run` with in-container replay loop.
- Added bounded timeouts to every Docker call.
- Moved readiness to in-container `pg_isready` polling.
- These patches are uncommitted as of 2026-04-24 and live in `scripts/pg-verify-migrations.mjs` modifications on `ui-v2`.

### 2. Historical migration bugs discovered during the investigation

Replay surfaced genuine bugs in migrations that had never been re-applied cleanly:

| Migration | Issue |
|---|---|
| `102_phase1_staff_seed.sql` | Inserts staff rows with null `facility_id` / `organization_id` despite NOT NULL constraints |
| `103_phase1_vendor_seed.sql` | Similar FK / NOT NULL seed issues |
| `104_phase1_compliance_skeleton.sql` | Schema drift from subsequent migrations |
| `105_reporting_module_seed.sql` | Out-of-order seed referencing tables from later migrations |
| `126_*` | Requires `ankane/pgvector` Docker image, not base `postgres:15` |

These have been edited in the `ui-v2` working tree as part of the S2 investigation. Those edits should be moved to `hardening/migration-replay` and evaluated on their merits, not rubber-stamped under UI-V2.

## Why this is out of scope for UI-V2

UI-V2 is a frontend + component + visual layer. It introduces three new, well-scoped migrations (207/208/209/210) that follow Haven's canonical RLS pattern from migration 205. Those migrations' correctness can be verified by:

1. Sequence check — `npm run migrations:check` (already green).
2. Targeted review — they copy migration 205's shape verbatim, which is already live in production.
3. Staging apply via Supabase CLI — `supabase db push --linked` targeting the staging project.

None of those require a full 210-migration local replay. The repo has been running with `SKIP_PG_VERIFY=1` on every gate since slice S0/S1; that same stance applies to S2.

## Work plan for this debt (proposed)

Move to `hardening/migration-replay` branch:

1. **Cherry-pick** the uncommitted `scripts/pg-verify-migrations.mjs` changes from `ui-v2` to `hardening/migration-replay`. Evaluate on merits; keep the good parts (bounded timeouts, in-container replay); drop any bits that mask real SQL errors.
2. **Cherry-pick** the uncommitted historical migration edits (102–105) to the same branch. Review each one — is the fix correct, or is the test data wrong, or does the schema need a prior migration to seed the FK targets?
3. Add `ankane/pgvector` as the replay Postgres image (replaces `postgres:15`).
4. Add a pre-commit hook: when a migration is added under `supabase/migrations/`, CI runs the replay on that branch before merge.
5. When replay is reliable, flip the gate runner to default `SKIP_PG_VERIFY=0` for slices that touch migrations, and `SKIP_PG_VERIFY=1` for slices that don't.

## Owner decision points

- Does historical migration hygiene warrant a dedicated slice, or does it pile on top of TRACK-A closeout?
- Is the Supabase-staging-push path acceptable as the "real apply" test in the interim, or must local replay be restored first?
- If local replay stays broken, is the gate's `qa.migrations-apply-postgres` check still meaningful at all? Consider downgrading it to informational-only until this is fixed.

## Status updates

- 2026-04-24: Created. No work on dedicated branch yet. UI-V2-S2 to proceed with SKIP_PG_VERIFY=1.
