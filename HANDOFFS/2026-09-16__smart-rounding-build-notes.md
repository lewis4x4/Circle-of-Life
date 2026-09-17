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
- COL organization id is `00000000-0000-0000-0000-000000000001`.
  **Never seed or filter by facility name.** Migration `318_col_facility_entity_names.sql`
  renamed two of the five facilities to their registered form (`Homewood Lodge, ALF` with a
  comma, `The Plantation on Summers`). Any seed carrying the pre-`318` names silently
  touches three facilities out of five and reports success. Select every non-deleted
  facility in the organization instead, which is also what should happen when a sixth
  building is added. Never hardcode a facility uuid either.
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

**D10. The 22:00 window is keyed `late_evening`, not `evening`.** The spec table named it
`evening`; reusing the word the retired three-daypart model used for a shift, while
`shift_type` still carries that value, would reintroduce the ambiguity defect 2 exists to
remove. The spec table in the repo was updated to match. The rendered label is
"Late evening check".

**D11. `apply_col_discovery_round_observation_plan` stays working.** It carries the
2026-08-14 times, but SYS-001 wrapped it in a five argument overload that
`supabase/tests/review_authoritative_actor.sql` exercises as an authorization fixture, so
retiring the body fails an unrelated acceptance probe. The spec only requires the
Plantation helper be deprecated. Part 6 removes the operator entry point that calls it
(`/api/rounding/plans/apply-discovery-default` and
`src/lib/rounding/apply-col-discovery-observation-plan.ts`), which is what takes it out of
the product.

**D12. The facility pool is explicit in the assignee guard.** `haven.complete_rounding_task_core`
now treats a task with `assigned_staff_id IS NULL` as satisfiable by any permitted staff
member, written as its own `WHEN` branch rather than left to NULL propagation through
`AND`. Spec sections 2.2 and 3.5 require it and Part 1 made pool tasks routine. This is the
only authorization change in the module; every other line of both locked bodies is the
approved text.

**D13. Absorption is expectation-derived, never row-derived.** Spec section 4.3 says an
order check inside a standard window's span marks that window satisfied, and the same
section says the standard windows stop generating while an order is active. Both are true,
which means **there is no task row to mark**. Any implementation that reads
`resident_observation_tasks` to compute absorption is structurally wrong and will report a
resident on 30 minute checks as missing six windows a day.

The compliance read for a resident and a service date must:

1. resolve the cadence version in force for that date, from the task stamp where tasks
   exist and from `facility_cadence_in_force` where they do not
2. project the windows that version defines for that date, through
   `facility_observation_windows_for_date`
3. mark a projected window satisfied when **any** log for that resident falls inside its
   span, whether the log came from a standard task or an order task
4. count expected as the projected count, never as the task count

This makes every compliance number in the module expectation-derived. Part 3 owns the view.
Parts 5, 6, 7 and 8 read it and must not re-derive compliance by counting task rows.

**D14. The version-in-force invariant is the thing most likely to be silently wrong.**
`facility_cadence_in_force` resolves by `status IN ('active','superseded')` ordered by
`effective_from DESC`, which is only correct if supersession always closes the prior
version's `effective_to` at exactly the instant the new one opens. Part 7's
`activate_cadence_version` owns that invariant. It must:

- set the prior version's `effective_to` to the new version's `effective_from` in the same
  transaction that flips status, so the timeline has no gap and no overlap
- refuse to activate a version whose `effective_from` is earlier than the prior version's
  `effective_from`
- never touch `effective_from` on a version that has generated a task

Part 8 tests the invariant at four points, not one: two adjacent versions, a scheduled
version that activates in the middle of a report period, a rollback, and a template applied
to three facilities. Acceptance 16 as written tests one.

**D15. Acceptance item 1 is derived, never hardcoded.** The spec asserts 33 active
residents at Homewood and therefore 198 tasks, but the same spec reports three different
resident counts in defect 1 (200 listed, 25 on the form, 33 in production), and this build
has no way to confirm any of them. The test asserts
`generated = count(active residents) * count(enabled windows in the version in force)` and
prints both factors. Report the measured numbers. Do not tune a fixture until it reads 198.

**D16. The acceptance item 19 grep is defined here, before anyone can tune it green.**
"No literal `15`, `30`, `60`, `90`" across all of `src/` is not a runnable check: those
integers appear in Tailwind classes, timeouts, slices, and HTTP codes in thousands of
lines. Part 8 ships `scripts/smart-rounding/config-literals.mjs` which:

- scans only the rounding module, the settings surface, and the four Edge Functions in this
  scope, by explicit path list, with no per-line suppression mechanism
- flags time-of-day literals (`\b(0?[0-9]|1[0-9]|2[0-3]):[0-5][0-9]\b`) anywhere in scope
- flags the offsets and grace values only where they sit next to a minute, hour, grace,
  offset, window, escalation, or shift identifier, so it catches
  `graceMinutes = 60` and ignores `slice(0, 60)`
- flags `'day'`, `'night'`, `'evening'` string literals outside a type declaration
- exempts `*.test.ts`, `*.test.tsx`, fixtures, and `supabase/migrations/`, and lists every
  exemption it applied in its output

Its output goes in the transcript whether it is clean or not. A finding is either fixed or
recorded as a deliberate exception with a reason, never suppressed silently.

**D17. Nothing in this build has touched a real database, and the report must say so.**
Every green check is a replay against a scratch cluster with `scripts/pg-verify-stub.sql`
standing in for Supabase auth. RLS under real JWT claims, Supabase default privileges, and
the PostgREST schema cache are **not** exercised, and a prior Haven finding is that
`has_table_privilege(...) = false` assertions are replay-only artifacts that read the other
way on hosted. Part 8's RLS check therefore takes a target flag and ships runnable against
Haven HFO Staging, but this run does not apply a migration to any hosted project and does
not claim hosted verification. The exact commands go in the completion report as a parked
item for the owner.

**D18. `segment:gates` runs per part.** `AGENTS.md` and `CODEX.md` both make a PASS
artifact under `test-results/agent-gates/` the definition of done for a segment, and
process authority outranks the spec. Run
`SKIP_PG_VERIFY=1 npm run segment:gates -- --segment "25A-part-N" --no-chaos` after
integrating each part, with the native replay run separately as its own evidence. Add
`--ui` on the parts that change routes or visuals.

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

## 4a. Shapes later parts depend on

**Chip storage (Part 2).** `resident_observation_logs.chip_selections jsonb NOT NULL
DEFAULT '{}'::jsonb`, constrained to `jsonb_typeof = 'object'`. Keys are
`observation_vocab.field_name`; values are arrays of `value_code` ordered by the
vocabulary's `display_order`. **A group with no selection is absent, not present and
empty.** Index `idx_obs_logs_chip_selections` is GIN `jsonb_path_ops`, partial on
`deleted_at IS NULL`, so query it with containment:

```sql
WHERE chip_selections @> '{"med_response":["refused_meds"]}'::jsonb
WHERE chip_selections @> '{"mood_state":["agitated"]}'::jsonb
WHERE chip_selections @> '{"meal_intake":["refused_meal"]}'::jsonb
```

Chip codes: `meal_intake` = `ate_well`, `ate_some`, `refused_meal`, `ate_in_room`,
`no_meal_this_window`. `mood_state` = `pleasant`, `quiet`, `grouchy`, `agitated`,
`confused`, `tearful`. `med_response` = `took_meds`, `refused_meds`,
`no_meds_this_window`.

**`composed_summary text NOT NULL`** on the same table, with a `BEFORE INSERT` trigger
(`tr_resident_observation_logs_compose_summary`) that composes one from the row when the
writer does not supply it, so the column is never null whichever command wrote the log.

**The completion command is locked.** `public.complete_rounding_task_review` delegates to
`haven.complete_rounding_task_core`, both SYS-001 authoritative-actor functions.
`public.submit_observation` validates and composes, then calls the review command; it does
not write the log itself. **Do not replay either locked body again.** If a later part needs
a new log column, add the column and let the insert-time trigger fill it, or come to the
orchestrator.

**Evidence is immutable.** Migration `331` put a `BEFORE UPDATE` trigger
(`tr_rounding_logs_immutable`) on `resident_observation_logs` that refuses every update
from every role. A backfill must disable and re-enable it in the same transaction, as `413`
does.

## 4b. The compliance read, and the task kind contract

**Every compliance number in this module comes from
`public.v_resident_observation_compliance`.** Do not count `resident_observation_tasks`.

Grain: one row per `(resident_id, service_date, window_key)`, where the window is a
**projected** standard window occurrence. A resident on a 30 minute Monitoring Order has no
standard task rows at all and still produces six rows a day, which is the point.

```sql
SELECT count(*) AS expected, count(*) FILTER (WHERE satisfied) AS satisfied
FROM public.v_resident_observation_compliance
WHERE facility_id = $1 AND service_date = $2;
```

Useful columns beyond those: `absorbed` (an order check satisfied a standard window),
`expectation_source` (`monitoring_order` | `standard_task` | `projected_only`),
`covered_by_monitoring_order_id`, `satisfied_by_log_id`, `cadence_version_id`,
`cadence_version_matches_projection`.

**Task kinds.** Read these, never infer them:

| kind | `monitoring_order_id` | `window_key` | `plan_rule_id` |
|---|---|---|---|
| order task | set | null | null |
| cadence task | null | set | null |
| legacy plan task | null | null | set |

`window_key` is deliberately null on order tasks: a reserved key would put them in Part 1's
`(resident_id, window_key, service_date)` index and collide the moment an order started
inside a standard window. `service_date` **is** stamped on order tasks.

**The window projector has two entry points, one body.**
`facility_observation_windows_for_version(facility, version, date)` is the primitive; pass
it a version you already hold, such as a task stamp.
`facility_observation_windows_for_date(facility, date)` resolves the version in force at
local midnight and calls the primitive. **A compliance read must use the version explicit
form**, because on the day a cadence change activates mid shift the two answer differently,
and that is the one day the read most needs to agree with the tasks it is scoring.

**The interval scaled grace rule has one definition:**
`public.monitoring_order_grace_minutes(interval_minutes)`, reading its divisor and bounds
from `haven.observation_grace_formula()`. Part 4 uses it for the standard cadence too.
Part 7 replaces the formula function's body with a read from a facility row; no caller
changes.

## 4c. Escalation policy, and how Edge Function tests actually run

**Policy is versioned exactly like cadence.** `facility_escalation_versions` +
`facility_escalation_rungs` + `facility_escalation_rung_shift_overrides`. Seeded version 1
is active at every facility: `nudge` -15, `tier_1` +30, `tier_2` +60, `tier_3` +90 terminal,
all measured from `window_close`. Night overrides change **channels only**, never offsets.

`resident_observation_escalations` gains `escalation_version_id` and `rung_key`, backfilled
to version 1. The old Edge Function wrote `observation_task_id` and `severity_weight`,
neither of which ever existed; that drift is gone rather than accommodated.

**Two rung columns beyond the spec's list**, because spec 5.1 says tier 1 is "assigned staff
**plus** administrator" and tier 2 is "administrator **plus** standing alert audience", and
a single `assigned_staff_only` boolean cannot express either: `include_assigned_staff` and
`use_standing_alert_routes`, with CHECKs enforcing that `assigned_staff_only` implies
`include_assigned_staff` and that no rung reaches nobody.

**The nudge is not an escalation and must never be counted as one.** Every rung writes
`observation_escalation_dispatches` (one row per `(task_id, rung_key)`, the idempotency
anchor); only tiers write `resident_observation_escalations`. The nudge's `escalation_id` is
null. An escalation count is `count(*) from resident_observation_escalations`.

`public.observation_task_window_close(task_id)` is the single resolver: window grace for a
cadence task, interval scaled grace for an order task, both through
`public.monitoring_order_grace_minutes`.

**Edge Function tests need `npm run test:edge`.** `vitest.config.ts` includes only
`src/**/*.test.ts`, so **26 test files under `supabase/functions/` were never executed by
any gate** and were documentation rather than verification. Part 4's two are Deno tests
(`https://deno.land/std/assert`), so vitest was never going to run them; the runner is
`deno test`. `npm run test:edge` now runs this module's, and a part that adds an Edge
Function test must extend that script's path list. **The other 24 files remain unexecuted**
and are recorded as a finding below rather than folded into this build.

## 5. Part ledger

Filled in by the orchestrator as parts land.

| Part | Name | Status | Commit |
|---|---|---|---|
| 1 | Cadence and task generation | **done** | `412` + generator rewrite |
| 2 | Chip capture and composed narrative | **done** | `413` + capture surface |
| 3 | Monitoring Orders | **done** | `414` + compliance view + bridge |
| 4 | Escalation policy and engine | **done** | `415` + engine rewrite |
| 5 | Watchlist | pending | |
| 6 | Module shell and the nine defects | pending | |
| 7 | Cadence and Escalation Settings | pending | |
| 8 | Verification | pending | |

## 6. Open items carried by the orchestrator

- **One non-reproducible test failure.** A full `npm run test` reported `1 failed | 5881
  passed` once during Part 3 integration. Three consecutive full runs immediately after
  were clean at `5882 passed`. The failing test was not identified because the run output
  was truncated. Capture full vitest output to a file on every run from here so a
  recurrence is identifiable. Do not report the suite as reliably green until this either
  recurs and is fixed or goes a sustained number of runs without appearing.
- **No hosted verification.** See decision D17.
- **Acceptance 1 resident count unconfirmed.** See decision D15.
- **24 pre-existing Edge Function test files are executed by no gate.** Inventory:
  `_shared/` (5), `boldsign-send-contract-handler`, `care-event-dispatcher` (2),
  `exec-kpi-snapshot` (2), `export-audit-log`, `facility-launch-promote` (3),
  `grace-provider-errors`, `haven-ai-router`, `ingest` (2), `knowledge-agent`,
  `officer-catalog` (2), `stand-up-google`, `stand-up-history-publisher`,
  `stand-up-publisher`. They are outside this build's scope and may not all run under a
  single runner, but every one of them currently reads as passing test coverage that has
  never run. Worth a dedicated piece of work.
- **Channel names are literals in the engine on purpose.** `in_app`, `push` and `sms`
  appear in `observation-escalation-engine` as a discriminated union, because the code that
  sends an SMS has to name SMS. Which channels a rung uses is data; how a channel is
  delivered is code. The acceptance 19 scanner in D16 must distinguish the two rather than
  flag the transport.
