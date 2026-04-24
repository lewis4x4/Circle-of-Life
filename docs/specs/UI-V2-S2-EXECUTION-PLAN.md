# UI-V2 Slice S2 — Database migrations + RLS

**Parent:** `docs/specs/UI-V2-EXECUTION-HANDOFF.md`
**Spec sections:** UI-V2-DESIGN-SYSTEM.md §7 (Data Model) — with the Haven-native RLS corrections inline below.
**Depends on:** S1 committed to `origin/ui-v2`
**Est. eng-days:** 1

## Goal

Three new tables live in Supabase with full RLS (using Haven's existing helper functions), audit coverage, and indexes. Migration sequence advanced from 206 to 209. Rollback migration 210 committed (NOT applied). `qa.migrations-apply-postgres` gate check passes against real Postgres.

## Files to deliver

Migration numbers are sequential: repo was at 206 as of S1 close. Use 207–210 below.

- `supabase/migrations/207_user_dashboard_preferences.sql`
- `supabase/migrations/208_facility_metric_targets.sql`
- `supabase/migrations/209_alert_audit_log.sql`
- `supabase/migrations/210_rollback_ui_v2.sql` — rollback script, committed but NOT applied; for S12.

## Canonical Haven RLS pattern (use verbatim, do not invent aliases)

Haven's RLS helpers live in `supabase/migrations/004_haven_rls_helpers.sql`:

| Helper | Returns | Use |
|---|---|---|
| `haven.organization_id()` | `uuid` | Current user's org_id from JWT |
| `haven.accessible_facility_ids()` | `setof uuid` | Set of facility_ids current user can access |
| `haven.app_role()` | `app_role` enum | Current user's role from JWT |
| `public.haven_capture_audit_log()` | trigger fn | Applied via `AFTER INSERT OR UPDATE OR DELETE` trigger |

`app_role` enum values (from `001_enum_types.sql`): include `'owner'`, `'org_admin'`, `'facility_admin'`, `'manager'`, `'nurse'`, `'caregiver'`, `'finance'`, `'compliance'` (verify full list before writing policies).

Canonical RLS example (copied from `supabase/migrations/205_risk_score_snapshots.sql`, lines 50–74):

```sql
CREATE POLICY risk_score_snapshots_select ON risk_score_snapshots
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE POLICY risk_score_snapshots_insert ON risk_score_snapshots
  FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager')
  );

CREATE POLICY risk_score_snapshots_update ON risk_score_snapshots
  FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin')
  );

CREATE TRIGGER risk_score_snapshots_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON risk_score_snapshots
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();
```

Use this shape for every table below. Non-negotiable rule #7: tables under facility RLS must carry both `organization_id` AND `facility_id` columns.

## Migration 207 — `user_dashboard_preferences`

User-scoped (no facility scope). Uses `auth.uid()` directly.

```sql
CREATE TABLE IF NOT EXISTS user_dashboard_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dashboard_id text NOT NULL,
  column_order text[] NOT NULL DEFAULT '{}',
  column_visibility jsonb NOT NULL DEFAULT '{}'::jsonb,
  saved_views jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (user_id, dashboard_id)
);

ALTER TABLE user_dashboard_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_dashboard_preferences_select ON user_dashboard_preferences
  FOR SELECT USING (auth.uid() = user_id AND deleted_at IS NULL);

CREATE POLICY user_dashboard_preferences_insert ON user_dashboard_preferences
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY user_dashboard_preferences_update ON user_dashboard_preferences
  FOR UPDATE USING (auth.uid() = user_id AND deleted_at IS NULL);

CREATE POLICY user_dashboard_preferences_delete ON user_dashboard_preferences
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX user_dashboard_preferences_user_dashboard_idx
  ON user_dashboard_preferences (user_id, dashboard_id);

CREATE TRIGGER user_dashboard_preferences_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON user_dashboard_preferences
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

COMMENT ON TABLE user_dashboard_preferences IS
  'Per-user dashboard customization: column order, visibility, and saved views. UI-V2 S2.';
```

## Migration 208 — `facility_metric_targets`

Full facility-scoped RLS with role guards.

```sql
CREATE TABLE IF NOT EXISTS facility_metric_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  metric_key text NOT NULL,
  target_value numeric NOT NULL,
  direction text NOT NULL CHECK (direction IN ('up','down')),
  warning_band_pct numeric NOT NULL DEFAULT 10,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz,
  UNIQUE (facility_id, metric_key)
);

ALTER TABLE facility_metric_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY facility_metric_targets_select ON facility_metric_targets
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE POLICY facility_metric_targets_insert ON facility_metric_targets
  FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin')
  );

CREATE POLICY facility_metric_targets_update ON facility_metric_targets
  FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin')
  );

CREATE INDEX facility_metric_targets_facility_metric_idx
  ON facility_metric_targets (facility_id, metric_key);

CREATE TRIGGER facility_metric_targets_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON facility_metric_targets
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

COMMENT ON TABLE facility_metric_targets IS
  'Per-facility thresholds driving UI-V2 red/amber/green callouts on dashboards and DataTable cells. UI-V2 S2.';
```

## Migration 209 — `alert_audit_log`

Append-only audit record for alert actions. Facility-scoped reads; insert gated by membership.

```sql
CREATE TABLE IF NOT EXISTS alert_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  alert_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('ack','detail_open','escalate','dismiss','assign')),
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  actor_role app_role NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE alert_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY alert_audit_log_select ON alert_audit_log
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE POLICY alert_audit_log_insert ON alert_audit_log
  FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND actor_id = auth.uid()
  );

-- No UPDATE or DELETE policies. Audit rows are immutable per non-negotiable rule #2.

CREATE INDEX alert_audit_log_facility_created_idx
  ON alert_audit_log (facility_id, created_at DESC);

CREATE INDEX alert_audit_log_actor_created_idx
  ON alert_audit_log (actor_id, created_at DESC);

CREATE INDEX alert_audit_log_alert_idx
  ON alert_audit_log (alert_id, created_at DESC);

-- alert_audit_log itself is an audit surface, so NO haven_capture_audit_log trigger
-- (would create infinite recursion / double-audit). Append-only via RLS insert policy.

COMMENT ON TABLE alert_audit_log IS
  'Append-only audit trail for UI-V2 PriorityAlertStack actions (ack/detail_open/escalate/dismiss/assign). UI-V2 S2.';
```

## Migration 210 — `rollback_ui_v2.sql` (committed, NOT applied)

```sql
-- Rollback migration for UI-V2 tables. Commit but DO NOT apply except at S12 abort.
-- Order: drop indexes + policies (implicit via DROP TABLE CASCADE) → drop tables.

DROP TABLE IF EXISTS alert_audit_log CASCADE;
DROP TABLE IF EXISTS facility_metric_targets CASCADE;
DROP TABLE IF EXISTS user_dashboard_preferences CASCADE;
```

## Pre-write verification commands

Before writing the three migrations, run these to confirm the schema assumptions:

```bash
# Canonical helper signatures
cat supabase/migrations/004_haven_rls_helpers.sql

# Canonical RLS usage
sed -n '50,74p' supabase/migrations/205_risk_score_snapshots.sql

# app_role enum values
sed -n '45,75p' supabase/migrations/001_enum_types.sql

# Confirm facilities + organizations tables exist in default schema
grep -n "^CREATE TABLE facilities\|^CREATE TABLE organizations" supabase/migrations/002_core_hierarchy.sql

# Confirm haven_capture_audit_log is in public schema
grep -rn "CREATE.*FUNCTION.*haven_capture_audit_log\|CREATE.*FUNCTION public.haven_capture_audit_log" supabase/migrations/ | head -3

# Current migration count + next number
ls supabase/migrations/*.sql | wc -l
ls supabase/migrations/*.sql | sort | tail -1
```

If any of those greps return unexpected results, stop and flag — do not proceed to write migrations with assumed names.

## Gate command (Docker MUST be running)

```bash
# Verify Docker is up first
docker info > /dev/null 2>&1 || { echo "Start Docker Desktop, then retry"; exit 1; }

# S2 runs pg verify real — no SKIP
npm run segment:gates -- --segment "UI-V2-S2"
```

`qa.migrations-apply-postgres` must print **`passed`**, not `skipped`. If Docker refuses to start or the migration replay fails, do not commit — debug first.

## Acceptance

- Three tables created with RLS enabled and Haven-native helper function policies.
- `haven_capture_audit_log` trigger on `user_dashboard_preferences` and `facility_metric_targets` (not on `alert_audit_log` itself).
- `deleted_at` column present on user_dashboard_preferences + facility_metric_targets (soft-delete rule #3).
- `organization_id` + `facility_id` both present on `facility_metric_targets` + `alert_audit_log` (denormalization rule #7).
- `npm run migrations:check` reports sequence 001..210 intact.
- `qa.migrations-apply-postgres` gate check **`passed`** (not skipped).
- Rollback migration 210 committed, not applied.
- Gate JSON PASS at `test-results/agent-gates/*-UI-V2-S2.json`.
- `UI-V2-STATUS.md` S2 box ticked with gate filename.

## Review hooks

- `agents/playbooks/security-rls-agent.md` — RLS policy pass against Haven helpers.
- `agents/playbooks/migration-integrity-agent.md` — sequence + idempotency + rollback pair.

## Commit message

`feat(ui-v2-s2): v2 migrations + RLS (prefs, thresholds, alert audit) [UI-V2-S2]`

## Gotchas

- Do NOT apply migrations to production. S2 is staging + local-verify only. Production application is gated at S12.
- `alert_audit_log` does NOT get `haven_capture_audit_log` trigger — it IS the audit surface; triggering on itself causes recursion.
- Haven's `app_role` enum must already contain every role used in the `IN (...)` clauses. If `'compliance'` role isn't in the enum but policy references it, migration fails. Check enum before writing.
- Next.js 16 + Supabase CLI: you may see `failed to parse environment file: .env.local` if malformed lines exist (Sentry skip path earlier added clean `KEY=value` rows, so this should be fine — but verify `supabase migration list --linked` works before the gate).
- `haven.app_role()` returns the `app_role` enum type, not text. The `IN ('owner', 'org_admin')` literal strings are auto-cast; this is how existing migrations do it. Don't introduce a `::app_role` cast unless mimicking other migrations.
