# Smart Rounding rebuild — orchestrator build notes (2026-09-16)

Branch: `blewis/smart-rounding-cadence-watchlist`
Spec (build authority): `docs/specs/25A-smart-rounding-cadence-and-watchlist.md`
Supporting authority in order: `AGENTS.md`, `CODEX.md`, `docs/specs/UNIFIED-ROADMAP.md`,
`docs/specs/25-resident-assurance-engine.md`, `docs/specs/FRONTEND-CONTRACT.md`,
`docs/design-system/constitution.md`, `supabase/migrations/`, then runtime code.

Every specialist reads this file first, then the spec, then its own part.

---

## 1. Baseline facts established at the branch point

Read these rather than re-deriving them. They were confirmed by reading the files named.

### 1.1 Migration head

Head is **`411_facility_identity_health_scope_comment.sql`**, not `403`. The spec's
`404`–`410` are therefore reallocated to **`412`–`418`**, suffixes preserved.
`scripts/check-migration-order.mjs` requires `^\d{3}_[a-z0-9][a-z0-9_]*\.sql$`,
contiguous from `001`, no duplicates. Migration numbers are **pre-allocated per part**
in section 3 below. Do not pick your own number.

The spec names `404_col_observation_cadence_michelle_2026_09_16.sql`. The binding rule
"no named person in code, migrations, or seeds" wins over the spec's filename, so the
allocated name drops the person: `412_col_observation_cadence_2026_09_16.sql`.

### 1.2 Observation vocabulary (`observation_vocab`, migration `219`)

```
observation_vocab(
  id, organization_id NOT NULL, facility_id NULL,
  field_name text NOT NULL CHECK (field_name IN ('location','state','activity','position','intervention')),
  value_code text NOT NULL CHECK (value_code ~ '^[a-z0-9_]+$'),
  display_label text NOT NULL, display_order integer NOT NULL DEFAULT 0,
  is_oof boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true,
  created_at, updated_at, created_by, updated_by, deleted_at,
  UNIQUE NULLS NOT DISTINCT (organization_id, facility_id, field_name, value_code)
)
```

- The column is **`field_name`**, not `kind`. Org-wide rows use `facility_id IS NULL`.
- Existing `field_name` literals: `location`, `state`, `activity`, `position`, `intervention`.
  `activity` is declared in the CHECK but has **no seeded rows**.
- Adding `meal_intake`, `mood_state`, `med_response` requires **dropping and recreating the
  CHECK constraint** (`observation_vocab_field_name_check`). Extend the list, never replace it.
- RLS: select for org + accessible facility; manage for `owner`, `org_admin`, `facility_admin`, `manager`.
- Triggers already present: `haven_set_updated_at()` and `haven_capture_audit_log()`.

The three "required fields" named by `219`/`310` (`resident_location`, `resident_state`,
`quick_status`) are **columns on `resident_observation_logs`**, not vocab field names:

- `resident_location text` — free text holding an `observation_vocab` `location` `value_code`
- `resident_state text` — same, holding a `state` `value_code`
- `quick_status resident_observation_quick_status NOT NULL` — enum
  (`awake, asleep, calm, agitated, confused, distressed, not_found, refused`)

`resident_observation_logs` also carries `resident_position`, the boolean observation flags,
`intervention_codes text[]`, `note text`, `observed_at`, `entered_at`,
`entry_mode resident_observation_entry_mode`, `task_id NOT NULL`, `staff_id NOT NULL`,
`assigned_staff_id`, and the standard audit columns. Full DDL in
`supabase/migrations/098_resident_assurance_schema.sql`.

There is **no existing `submit_observation` RPC**. Writes go through the Next.js route
`src/app/api/rounding/tasks/[id]/complete/route.ts`. Part 2 creates the RPC.

### 1.3 `resident_watch_instances`

Present since `098`:

```
resident_watch_instances(
  id, organization_id NOT NULL, entity_id, facility_id NOT NULL, resident_id NOT NULL,
  protocol_id REFERENCES resident_watch_protocols(id),
  triggered_by_type text NOT NULL, triggered_by_id uuid,
  starts_at timestamptz NOT NULL DEFAULT now(), ends_at timestamptz,
  status resident_watch_status NOT NULL DEFAULT 'pending_approval',
  approved_by, ended_by, end_reason,
  created_at, updated_at, updated_by, deleted_at,
  CHECK (ends_at IS NULL OR ends_at >= starts_at)
)
```

`resident_watch_status` enum: `pending_approval, active, paused, ended, cancelled`.

**The care-event trigger the spec §4.4 expects does not exist.** Migrations `400`–`403`
only *read* `resident_watch_instances` (`402_care_events_functions.sql:761`, an
`active_watch` context flag). Nothing inserts into it from `care_events`. The bridge
trigger in Part 3 is therefore built as an `AFTER INSERT` on `resident_watch_instances`
itself, which is correct regardless of what eventually inserts. Recorded as open item 8.

### 1.4 Weight source

**Found.** `daily_logs.weight_lbs numeric(6,2)` (migration `015_daily_logs_and_adl.sql`),
one row per `(resident_id, log_date, shift, logged_by)`. The `weight_loss` signal ships
**enabled** against it.

### 1.5 Role enums — read this before writing any permission check

There are two different role enums and the spec's `assistant_administrator` is in only one.

| Enum | Values |
|---|---|
| `app_role` (authentication, what `haven.app_role()` returns) | `owner, org_admin, facility_admin, manager, admin_assistant, coordinator, nurse, caregiver, med_tech, dietary, dietary_aide, housekeeper, maintenance_role, family, broker` |
| `staff_role` (HR record, what `notification_routes.staff_role_targets` targets) | includes `administrator`, `assistant_administrator`, `resident_aide`, and others |

Consequences:

- **SQL permission gates** use `haven.app_role()` and therefore use **`manager`** where the
  spec says `assistant_administrator`.
- **Recipient targeting** goes through `notification_routes.staff_role_targets staff_role[]`
  and therefore **does** use `assistant_administrator`.
- "Resident Aide and above" for observation and Monitoring Order creation resolves to
  `app_role IN ('caregiver','med_tech','nurse','manager','coordinator','admin_assistant','facility_admin','org_admin','owner')`.
  Define this once as a helper (`haven.can_record_observation(uuid)`) in Part 3 and reuse it.

### 1.6 Other shapes you will need

- `shift_type` enum is `('day','evening','night','custom')`. The enum keeps `evening` —
  it is used by other modules. **This module never writes or renders `evening`.** The
  two-shift model lives in `facility_shift_definitions` rows, not in the enum.
- `shift_assignments(schedule_id, staff_id, facility_id, organization_id, shift_date,
  shift_type, custom_start_time, custom_end_time, unit_id, status, assigned_resident_ids uuid[], ...)`.
- `notification_routes(id, organization_id, facility_id, name, severity_min incident_severity,
  channels text[], staff_role_targets staff_role[], is_active, ...)` — migration `058`.
- `resident_observation_escalations` real columns are `task_id`, `escalation_level`,
  `escalation_type`, `escalated_to_staff_id`, `status`, `triggered_at`, `acknowledged_at`,
  `resolved_at`, `resolution_note`. **`supabase/functions/observation-escalation-engine`
  currently writes `observation_task_id` and `severity_weight`, neither of which exists.**
  That is pre-existing drift; Part 4 rewrites the function against the real columns.
- Helper functions available: `haven.organization_id()`, `haven.app_role()`,
  `haven.has_facility_access(uuid)`, `haven.accessible_facility_ids()`,
  `public.haven_capture_audit_log()`, `public.haven_set_updated_at()`.
- COL organization id is `00000000-0000-0000-0000-000000000001`. The five facilities are
  named `Oakridge ALF`, `Rising Oaks ALF`, `Homewood Lodge ALF`, `Plantation ALF`,
  `Grande Cypress ALF`. Never hardcode a facility uuid; select by name within the org.
- `facilities.timezone` exists and defaults to `America/New_York` in COL data. Always read
  it; never hardcode the zone.

### 1.7 Tooling

- `npm run migrations:check` — filename/sequence. `npm run migrations:check:hosted` — bans
  `public.gen_random_uuid()` and friends (use the bare name).
- `npm run migrations:verify:pg` replays every migration. Docker is **not** used on this
  machine; use the native path: `PG_VERIFY_NATIVE_SOCKET=/tmp/.s.PGSQL.5432 npm run migrations:verify:pg`
  (Homebrew `postgresql@17` is running).
- `npm run lint` runs ESLint plus `npm run lint:constitution` (`scripts/lint-constitution.ts`).
  That script has a **hardcoded `segmentTargets` list** naming the old rounding routes and
  `SafetyScoreBadge`/`ObservationPlanEditor`. Part 6 updates that list to the new five-tab
  routes and new components. Missing paths are skipped silently, so a stale list is a
  silent loss of coverage.
- `npm run build` runs `migrations:check`, `migrations:check:hosted`, `check:admin-shell`,
  `check:memory-care`, then `next build`.

---

## 2. Orchestrator decisions that bind every part

These resolve ambiguities in the spec. They are not optional.

**D1. Configuration is versioned from the first migration, not retrofitted.**
The spec sequences Part 1 as "seeded constants" and Part 7 as "convert them to versioned
configuration". Building a non-versioned shape and then replacing it would leave two
overlapping tables and would make acceptance 16 unprovable for anything generated in
between. Instead:

- Part 1 (`412`) creates `facility_shift_definitions`, `facility_cadence_versions`,
  `facility_cadence_windows` in their **final versioned shape** and seeds version 1 as
  `active`, and adds `cadence_version_id` to `resident_observation_tasks`.
- Part 4 (`415`) creates `facility_escalation_versions`, `facility_escalation_rungs` in
  their final versioned shape, seeds version 1 as `active`, and adds
  `escalation_version_id` to `resident_observation_escalations`.
- Part 7 (`417`, `418`) adds what is genuinely new: templates and their children, the
  facility-to-template pointer, `jurisdiction_observation_floors`, the seven RPCs, the
  `cadence-version-activator` function, and the settings surface.

Every binding rule still holds: no literal times in code, versions immutable once in
force, tasks stamped, compliance reads join through the stamp.

**D2. Nothing in `src/` or `supabase/functions/` may contain an observation time, a grace
value, an escalation offset, a recipient role, a channel, or a shift boundary as a
literal.** Acceptance 19 greps for `06:00`, `10:00`, `14:00`, `18:00`, `22:00`, `02:00`,
and the offsets `15`, `30`, `60`, `90`. Allowed hits: tests, fixtures, and migration seed
data only. If you need one of these values at runtime, read it from a row.

**D3. `evening` is dead in this module.** `grep -rn "Evening" src/app src/components` must
return nothing under the rounding surface. The `shift_type` enum keeps the value for other
modules; this module never selects it, writes it, or renders it.

**D4. Operator vocabulary.** "Monitoring Order", never "watch", in any operator-facing
string. Bands are the words **Needs a look**, **Watch**, **Acute** — "Watch" survives only
as a band name, never as a noun for an order. No migration number, branch name, table
name, column name, or raw enum value renders anywhere.

**D5. No resident-level number.** No score, no percentage, no index on a resident row
anywhere in the module. Facility-level aggregates are fine.

**D6. Spec 25 reconciliation ruling: retire.** `resident-safety-scorer`,
`risk-nightly-scorer`, and `resident-assurance-ai` stop feeding the Watchlist surface
entirely. Do not delete the functions; other spec 25 consumers keep them. Part 5 documents
the choice.

**D7. Quiet Operator, every surface.** No `uppercase` / `tracking-widest` / `font-mono`
labels, no native `<select>` or `<textarea>` chrome, no dashed centered empty states, no
8-plus tab strips, no workflow rendered as a destination tab, semantic color only, no
purple, no neon. Card padding 16–20px, table rows 32–40px, KPI value 28px tabular-nums
semibold. Empty states are left-aligned, two lines, and say what would populate them.
The caregiver capture surface is the phone-first exception on sizing only: 56px targets,
one chip group per line.

**D8. TypeScript strict, no `any`** except where a third-party type forces it, and then
with a one-line reason. Components under 300 lines.

**D9. American spelling. No em dashes** in code comments, UI copy, or documentation.

---

## 3. Migration numbers, pre-allocated. Do not deviate.

| Part | File | Spec number |
|---|---|---|
| 1 | `412_col_observation_cadence_2026_09_16.sql` | `404` |
| 2 | `413_observation_chip_vocabulary.sql` | `405` |
| 3 | `414_resident_monitoring_orders.sql` | `406` |
| 4 | `415_observation_escalation_policy.sql` | `407` |
| 5 | `416_resident_watchlist_signals.sql` | `408` |
| 7 | `417_cadence_config_versioning.sql` | `409` |
| 7 | `418_cadence_config_rpcs.sql` | `410` |

Each file wraps itself in `BEGIN; ... COMMIT;` unless it contains a statement that cannot
run inside a transaction, and is idempotent enough to replay (`CREATE TABLE IF NOT EXISTS`,
`DROP POLICY IF EXISTS` before `CREATE POLICY`, `CREATE OR REPLACE FUNCTION`, seeds guarded
by `WHERE NOT EXISTS` or `ON CONFLICT DO NOTHING`).

---

## 4. Shared naming law

`organization_id`, never `org_id`. Business-user foreign keys reference `user_profiles(id)`.
`docs/specs/`, never `specs/`. Integer cents on any new money column. Text plus CHECK for
new enums in this module, matching the observation module's established pattern.
Append-only history tables stay append-only (no UPDATE or DELETE policy).
Retired names that must not appear anywhere: `round_shift_configs`,
`resident_round_overrides`, `round_location_vocab`, `round_activity_vocab`,
`rounds-escalation-engine`, `cart_assignments`.

RLS on every new table: organization scope first, then
`facility_id IN (SELECT haven.accessible_facility_ids())`. Audit trigger
(`haven_capture_audit_log()`) and updated-at trigger (`haven_set_updated_at()`) on every
new mutable table.

---

## 5. Part ledger

Filled in by the orchestrator as parts land.

| Part | Name | Status | Commit |
|---|---|---|---|
| 1 | Cadence and task generation | pending | |
| 2 | Chip capture and composed narrative | pending | |
| 3 | Monitoring Orders | pending | |
| 4 | Escalation policy and engine | pending | |
| 5 | Watchlist | pending | |
| 6 | Module shell and the nine defects | pending | |
| 7 | Cadence and Escalation Settings | pending | |
| 8 | Verification | pending | |
