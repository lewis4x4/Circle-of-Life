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

**D12 (CORRECTED). The facility pool must be solved by assignment, never by
authorization. There is no pool branch in either locked completion body.**

The earlier version of this decision was wrong and is reversed. `supabase/tests/
review_authoritative_actor.sql` nulls `assigned_staff_id`, releases every assignment row,
and asserts that a caregiver is **refused**. That is a deliberate, tested SYS-001
authorization invariant, and a tested security invariant outranks the spec's wording. Both
`haven.complete_rounding_task_core` and `public.complete_rounding_task_review` now match
their approved 327 and 333 text exactly, differing only by the two disclosed column
additions each.

**The conflict, recorded.** Spec 25A sections 2.2 and 3.5 say an unassigned shift change
task goes to the facility pool and is "satisfiable by any staff member with observation
permission at that facility." The security model says an unassigned task is completable by
nobody below `nurse`. Both cannot hold.

**The resulting functional gap, which is real and currently open.** The generator leaves a
shift change task unassigned whenever no incoming `shift_assignments` row covers the
resident. Those tasks are right now completable by nobody below `nurse`, so the 06:00 check
that spec section 2.2 calls the entire point of the shift change window can sit unworkable
on the board.

**The correct fix is assignment, not a looser guard.** `resident_observation_assignments`
already exists with `assignment_type` of `primary`, `reassignment` and `rescue`, and the
guard passes for any staff member holding a live assignment row. A pool task should
therefore either receive assignment rows for the on duty staff at generation, or offer an
explicit claim step that writes a `rescue` row before completion. Either satisfies the
spec's intent and the security invariant at once, and leaves an audit trail naming who took
the check, which a bare authorization bypass does not.

**Owner decision required before this is built.** Auto-assign every on duty staff member,
or require a claim. Until then the generator's pool fallback is a known gap, not a working
path. Do not close it by widening the assignee guard.

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

**D19. The version timeline is a database constraint, not a convention.**
`facility_cadence_versions` and `facility_escalation_versions` both carry an
`EXCLUDE USING gist (facility_id WITH =, tstzrange(effective_from, effective_to, '[)') WITH &&)`
constraint over `status IN ('active','superseded') AND deleted_at IS NULL`. Before it, an
overlapping version inserted cleanly and `facility_cadence_in_force` answered from it, so a
past compliance report silently recomputed against a cadence that was never in force.
Verified: overlap is rejected, exact adjacency (`effective_to` of the outgoing equal to
`effective_from` of the incoming) is accepted. Draft, pending and scheduled versions sit
outside the constraint because the active version is open ended until superseded.

**Part 7's `activate_cadence_version` must close the outgoing version's `effective_to` and
open the incoming one in the same transaction.** Doing it in the wrong order now aborts the
transaction rather than corrupting the timeline. D14's four test points still apply; the
constraint is the floor, not the ceiling.

**D20. Two accepted tradeoffs, recorded rather than left silent.**

- **Chip codes are jsonb, not a child table.** `chip_selections` has no foreign key to
  `observation_vocab`, so a retired vocab code leaves an orphan code in history that nothing
  validates, and Part 5's signal reads use containment operators rather than a join. Taken
  for a single-row log write and because the composed sentence, not the code list, is the
  record of what happened. A child table would have given referential integrity and plainer
  queries. If chip-derived signals get materially more complex than containment, revisit it.
- **`submit_observation` takes 16 positional parameters** where the locked command it
  delegates to takes one `jsonb` payload. Two adjacent RPCs with opposite conventions, and
  a wide positional signature invites a mis-call. Left as is because changing a shipped RPC
  signature is a breaking change for any caller already written against it; worth folding
  into the next change that touches the function anyway.

**D21. The module now has its own probe, and probes are the only regression net that runs.**
`supabase/tests/review_smart_rounding_authority.sql` asserts, by named object: invoker
rights on `observation_compliance_for_range`, `anon` holding nothing on the eleven new
tables, the definer-only RPCs staying off `authenticated`, a non-empty `search_path` on
every `SECURITY DEFINER` function in the module, no UPDATE or DELETE policy on the three
append-only ledgers, the facility predicate in all seven UPDATE `WITH CHECK` clauses, the
refusal to edit an in-force escalation version's rungs, and the pool-task refusal.

Before it, **nothing in `supabase/tests/` referenced any object this module created**. The
pool-branch regression was caught only because it happened to touch a function an unrelated
SYS-001 probe exercises. Any part that adds a table, an RPC or a policy extends this file,
or that object has no regression cover at all.

**D22. Two RLS facts that will otherwise cost someone a day.**

- **A permissive `WITH CHECK` can be masked by a facility-scoped SELECT policy.** On
  PostgreSQL 17 a bare `UPDATE` that moves a row out of the reach of the table's SELECT
  policy raises `42501` on its own, whatever the UPDATE policy's `WITH CHECK` says. The
  seven omitted facility predicates were real and are fixed, but the cross-facility move
  they appeared to allow was already refused. A demonstration of that "exploit" almost
  certainly ran as owner, where RLS does not apply. Fix policies so they stand alone; do
  not report a masked gap as an exploitable one.
- **`UPDATE ... RETURNING` re-applies the SELECT policy to the new row**, so an RLS test
  written with `RETURNING` passes against a broken policy. Every behavioural UPDATE in the
  probe and the acceptance scripts uses a bare `UPDATE` plus `GET DIAGNOSTICS ROW_COUNT`
  for that reason. Do not simplify it back.
- A `WITH CHECK` failure **raises** `42501`; a `USING` failure filters silently to
  `UPDATE 0`. Assert the right one.

**D23. The spec's diagnosis of defects 5 and 6 is wrong. Part 6 must not "fix scoping" and
call them closed.**

Three tabs on the deployed module fail with "Could not load X. Confirm facility scope and
retry." That string is a generic catch, not a diagnosis, and the spec attributes them to
facility scoping (defect 1). They are three distinct query bugs, each confirmed against the
replayed schema:

- **Watches** embeds `residents(first_name, last_name, preferred_name, room_number)`.
  **`residents.room_number` does not exist.** PostgREST answers `42703` and the whole query
  fails. That tab has never been able to load.
- **Plans** carries the identical `room_number` embed and fails the same way. Its KPI tiles
  render zeros because they come from a different query that succeeds.
- **Integrity** embeds a bare `staff(first_name, last_name, preferred_name)`.
  `resident_observation_integrity_flags` has **two** foreign keys to `staff`
  (`staff_id` and `assigned_to_staff_id`), so the embed is ambiguous and PostgREST answers
  `PGRST201`. Disambiguate it as `staff:staff_id(...)`, the way the same query already
  disambiguates `assigned_staff:assigned_to_staff_id(...)` one line below.

**Room lives on `rooms.room_number`**, reached `residents.bed_id` to `beds.room_id` to
`rooms`. Part 5's `v_watchlist_facility` already resolves it that way; copy that, do not
reintroduce the column that does not exist.

Watches and Plans are both removed by Part 6, so their bugs die with them. **Integrity
survives the collapse to five tabs and must actually be fixed**, not inherited.

**The wider lesson for Part 6:** a generic error string hid three unrelated defects for
long enough that a spec was written attributing all of them to a fourth cause. Error copy
that names what the operator can do is right; error copy that replaces the diagnosis is how
this happened. Log the underlying PostgREST code.

**D9. American spelling. No em dashes** in code comments, UI copy, or documentation.

---

## 3. Migration numbers, pre-allocated. Do not deviate.

| Part | File | Spec number |
|---|---|---|
| 1 | `414_col_observation_cadence_2026_09_16.sql` | `404` |
| 2 | `415_observation_chip_vocabulary.sql` | `405` |
| 3 | `416_resident_monitoring_orders.sql` | `406` |
| 4 | `417_observation_escalation_policy.sql` | `407` |
| review fix | `418_observation_compliance_occupancy.sql` | n/a (C3) |
| review fix | `419_escalation_completed_task_guard.sql` | n/a (C1) |
| majors + probe | `420_smart_rounding_authority_fixes.sql` | n/a (M1, M2, M3, M0) |
| 5 | next free at the time it is written | `408` |
| 7 | next two free | `409`, `410` |

**Numbers are allocated when a migration is written, never reserved in advance, and the
whole stack has already moved twice.** This module started at `412`; `origin/main` then
merged its own `412` and `413` while this branch was open, so everything shifted to
`414`-`419`.

Use the tooling that arrived with that merge, not the directory listing:

- `npm run migrations:next` gives the next free number **counting numbers claimed by open
  pull requests**, which the directory cannot see
- `npm run migrations:check:claims` reports collisions with open PRs

**The two checks currently disagree and you need to know why.** `migrations:next` says
`416`, because open PRs #580 and #581 claim `414` and `415`. But `migrations:check`
requires a contiguous sequence from `001`, and `npm run build` gates on it while it does
**not** gate on claims. Taking `416` leaves a gap at `414`-`415` and fails the build today;
taking `414` keeps the build green and races those two PRs.

This branch holds `414`-`419` deliberately. Whoever merges second renumbers, which is what
the claims tool itself advises. **Re-run both checks immediately before any push**, and
expect to renumber again.

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

**Correction.** An earlier version of this section listed `night_restlessness` among the
chip-containment signals. It is not one and cannot be: `chip_selections` carries only those
three groups. `night_restlessness` reads `resident_observation_logs.resident_state` at the
`overnight` window against the settled states (`resting_in_bed`, `sleeping`), which is where
that vocabulary actually lives. Chip containment covers `med_refusal_trend`,
`behavior_change` and `meal_refusal_trend` only.

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
`public.observation_compliance_for_range`.** Do not count
`resident_observation_tasks`. The `v_resident_observation_compliance` view is
**gone**, dropped by migration `419`. A view cannot generate a date spine, and
that was the defect: a resident day with no task rows and no Monitoring Order
contributed no rows at all, so `expected` was zero, and a dashboard read zero
over zero as a hundred percent or as "no data". Three routes reached that state
and all three are now defects you can see.

### The signature

```sql
public.observation_compliance_for_range(
  p_facility_id uuid,   -- null means every facility the caller can reach
  p_from        date,   -- inclusive, facility local service date
  p_to          date    -- inclusive; pass the same date twice for one day
) RETURNS SETOF record
```

A reversed range and a range longer than 366 days both **raise**. A compliance
read may not answer an impossible question with silence.

Invoker rights, not `SECURITY DEFINER`. Row level security on `residents`,
`facilities`, the task tables, the log tables and `resident_status_history`
applies to the caller, so a reader sees exactly the facilities they can reach.

### The grain

One row per `(resident_id, service_date, window_key)`, where the window is a
**projected** standard window occurrence, **plus exactly one row per
`(resident_id, service_date)` with a null `window_key`** when that resident day
projects no window at all.

```
expected  = count(*)
satisfied = count(*) FILTER (WHERE satisfied)
```

A resident on a 30 minute Monitoring Order has no standard task rows at all and
still produces six rows a day, which is absorption. A resident whose facility
generated nothing has no task rows either, and now produces six **unsatisfied**
rows rather than none.

### Where the resident days come from

Three sources, unioned. Occupancy is the floor, not the filter.

1. **Occupancy.** `generate_series(p_from, p_to)` crossed with the residents who
   were in the building on that date: `admission_date <= date`,
   `discharge_date IS NULL OR discharge_date >= date`, `deleted_at IS NULL`,
   status not `inquiry` and not `pending_admission`. This is the source the view
   lacked and the only one that can speak about a day nothing was written for.
2. Days that carry standard cadence task rows.
3. Days covered by a Monitoring Order.

`resident_status_history` (migration `217`) is read, but **only to subtract days,
never to supply them**, because `217` installs its capture trigger without
backfilling and every resident admitted before it ran has no history row until
their status next changes. Driving occupancy from that table would silently drop
those residents, which is the identical failure this function exists to fix.
Used subtractively its gaps can only leave a day expected, which is the
direction that shows a defect. Where history does exist it removes the days a
resident was on `hospital_hold`, `loa`, `discharged`, `deceased` or not yet
admitted, probed at facility local **noon**, so a resident in hospital does not
read as six missed checks a day.

One further exclusion: a resident whose status is `discharged` or `deceased`
with no `discharge_date` and no history row has an unknown occupancy end and is
left out of the occupancy source rather than expected forever. Their real task
rows still bring their real days in through source two.

### The projection is `LEFT JOIN LATERAL`, never `CROSS JOIN`

A resident day for which no cadence version resolves, or whose version defines
no enabled window, yields **exactly one row** with `window_key` null,
`satisfied` false and `expectation_source = 'no_cadence'`. It reads as a defect,
never as silence. The `CROSS JOIN` in `414` deleted that row, which is how a
Monitoring Order running 09-10 to 09-20 produced compliance rows only from 09-16
onward: version 1's `effective_from` is 09-16, and six days of hourly checks on
a resident who had just fallen were silently absent from the record.

### The columns

| column | note |
|---|---|
| `organization_id`, `facility_id`, `resident_id`, `service_date` | the resident day |
| `window_key`, `window_label`, `shift_key` | null on a `no_cadence` row |
| `cadence_version_id` | the version resolved for the day; null when none is in force |
| `stamped_cadence_version_id` | the version the day's tasks carry, null when there are none |
| `projected_cadence_version_id` | the version the projection answered from |
| `cadence_version_matches_projection` | true by construction; **null** on a `no_cadence` row, because there is no projection to agree with |
| `no_cadence_in_force` | true when no version resolved at all. False on a `no_cadence` row means a version was in force and projected nothing |
| `due_at_utc`, `window_opens_at_utc`, `window_closes_at_utc` | null on a `no_cadence` row |
| `task_id`, `task_status` | the standard task behind the window, when one exists |
| `covered_by_monitoring_order_id` | an order was in force over this window |
| `satisfied_by_log_id`, `satisfied_at`, `satisfied_by_monitoring_order_id` | what met the window |
| `satisfied` | boolean, never null. Always false on a `no_cadence` row |
| `absorbed` | an order check satisfied a standard window |
| `expectation_source` | `standard_task` \| `monitoring_order` \| `projected_only` \| `no_cadence` |

### The caller shape

```sql
SELECT count(*)                                              AS expected,
       count(*) FILTER (WHERE satisfied)                     AS satisfied,
       count(*) FILTER (WHERE expectation_source = 'no_cadence') AS unconfigured
FROM public.observation_compliance_for_range($1, $2, $3);
```

From TypeScript it is an RPC, not a table read:

```ts
const { data } = await supabase.rpc("observation_compliance_for_range", {
  p_facility_id: facilityId,   // or null for every facility in reach
  p_from: serviceDate,
  p_to: serviceDate,
});
```

`unconfigured` is not decoration. A surface that shows `satisfied / expected`
and hides the `no_cadence` count has reintroduced the defect at the UI layer:
those rows are unsatisfied expectations whose cause is a configuration gap, not
a missed check, and they must be named differently and never rounded away.

### A new facility inherits

`public.ensure_facility_observation_defaults(p_facility_id uuid)` gives one
building the observation configuration its organization is already running: the
shift model, an active cadence version with its windows, and an active
escalation version with its rungs and shift overrides, copied from the
organization's oldest active cadence version and that facility's escalation
policy. It is idempotent and it never opens a version inside a timeline a
facility already owns. An `AFTER INSERT` trigger on `public.facilities` calls
it, so a sixth building inherits automatically, and the trigger cannot fail a
facility insert.

It **inherits** rather than restating the `412` and `415` seed values, so every
observation time, grace value and escalation offset in the module still lives in
exactly one place and a building added next year starts on the policy the
organization is running rather than the one it stopped running. The `412` and
`415` seeds are deliberately **not** refactored to call it: they run before it
exists in a replay from `001`.

When the organization has nothing to inherit from, which is the first facility
of a brand new organization, the command returns `seeded: false` with a reason,
the trigger records an open `exec_alerts` row, and every resident day at that
building reads as `no_cadence`. Nothing is guessed from another tenant's rows.

### The generator reports per facility

`supabase/functions/observation-task-generator` no longer answers `ok: true`
when a building produced nothing. The response carries
`facilities_attempted`, `facilities_succeeded`, `facilities_failed`,
`facilities_without_cadence`, `failed_facility_ids` and
`facility_ids_without_cadence`, and answers `ok: false` with HTTP 207 when
either failure count is above zero. A facility with no cadence in force is a
failure, not a quiet success.

**Task kinds.** Read these, never infer them:

| kind | `monitoring_order_id` | `window_key` | `plan_rule_id` |
|---|---|---|---|
| order task | set | null | null |
| cadence task | null | set | null |
| legacy plan task | null | null | set |

`window_key` is deliberately null on order tasks: a reserved key would put them
in Part 1's `(resident_id, window_key, service_date)` index and collide the
moment an order started inside a standard window. `service_date` **is** stamped
on order tasks.

**The window projector has two entry points, one body.**
`facility_observation_windows_for_version(facility, version, date)` is the
primitive; pass it a version you already hold, such as a task stamp.
`facility_observation_windows_for_date(facility, date)` resolves the version in
force at local midnight and calls the primitive. **A compliance read must use
the version explicit form**, because on the day a cadence change activates mid
shift the two answer differently, and that is the one day the read most needs to
agree with the tasks it is scoring.

**The interval scaled grace rule has one definition:**
`public.monitoring_order_grace_minutes(interval_minutes)`, reading its divisor
and bounds from `haven.observation_grace_formula()`. Part 4 uses it for the
standard cadence too. Part 7 replaces the formula function's body with a read
from a facility row; no caller changes.

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

**A rung never fires against a task that was completed while the engine was
walking its queue.** `observation_escalations_due` returns up to 500 rows in one
read and the engine fires them one round trip at a time, so seconds to minutes
separate the read from the call. Migration `420` makes
`record_observation_escalation_rung` re-select the task `FOR UPDATE` and return
`{"fired": false, "reason": "task_completed"}` before any dispatch, escalation,
delivery or alert write when the status is terminal
(`completed_on_time`, `completed_late`, `excused`, `missed`, `reassigned`, which
is exactly the set the due read excludes, so the two cannot drift). The
idempotency answer is checked first and still wins: an already dispatched rung
answers `already_fired` whatever the task did afterwards.

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

- **IDENTIFIED: one load-sensitive flaky test, and it is not this module's.**
  `src/app/(admin)/admin/operations/profile/page.test.tsx > Facility profile review > has
  accessible controls and source details` fails intermittently under the full parallel
  suite (observed twice) and passes 3 of 3 in isolation. It took 5808 ms when it failed.
  The body runs `axe.run(container)`, a full accessibility scan, inside a unit test with no
  explicit timeout, which is timing fragile once the runner is saturated by 791 files. It
  arrived from `origin/main` (`dfae9cc5`) and belongs to another issue's acceptance, so it
  is reported rather than patched here. **Do not report the full suite as reliably green
  without naming this.** A re-run of that one file is the discriminator.
- **No hosted verification.** See decision D17.
- **Acceptance 1 resident count unconfirmed.** See decision D15.
- **Replay idempotency is proven.** Applying `412` through `415` a second time to an
  already migrated database produces no error and no duplicate seed rows (10 shifts,
  5 cadence versions, 30 windows, 5 escalation versions, 20 rungs, 15 overrides, 14 chip
  vocabulary rows, all exact). Re-run this after any new migration in the module; hosted
  applies do get retried.
- **`src/types/database.ts` is hand maintained and drifts silently.** Part 4 shipped three
  tables with zero type entries. The entries now in the file for the escalation tables were
  generated by introspecting the replayed schema rather than transcribed from the DDL.
  Do that rather than hand writing them.
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

---

## 7. Part 8 verification: what runs, what it proves, and what is still unproven

Appended by the Part 8 specialist. The ledger in section 5 and the open items in
section 6 stay the orchestrator's.

### 7.1 The D16 literal scan, and its four findings

`scripts/smart-rounding/config-literals.mjs` (`npm run smart-rounding:literals`)
is D16 implemented as specified: an explicit path list of 14 entries covering
142 TypeScript files, no per-line suppression, time-of-day literals flagged
anywhere in scope including comments, the offsets flagged only next to a minute,
hour, grace, offset, window, escalation or shift identifier, `'day'` / `'night'`
/ `'evening'` flagged outside a type declaration, and every exemption listed in
the output by file class.

**One stated departure from D16's letter**, because it serves D16's own example
rather than contradicting it. A Tailwind opacity suffix is excluded: on
`src/app/(caregiver)/caregiver/rounds/[residentId]/page.tsx` the class list
`hover:bg-primary/90 ... focus-visible:ring-offset-0` reads as "90 next to an
offset identifier", which is the same class of false positive as D16's own
`slice(0, 60)`. The exclusion is structural and declared in the script's header;
it cannot hide a real value, because nothing writes a grace value as a class
suffix.

**Eighteen of the twenty two original findings were fixed**, not tuned away:

- Six comments named an observation time or a grace value out loud
  (`MonitoringOrderAction.tsx`, `MonitoringOrderForm.tsx`, `monitoring-orders.ts`
  twice, `generate-observation-tasks.ts`, `CadenceRungEditor.tsx`). A comment
  that names 10:00 is a second copy of the cadence, and the module's whole point
  is that there is exactly one. Rewritten without the numbers.
- `src/lib/rounding/generate-observation-tasks.ts` defaulted grace to `15` when
  a plan rule did not carry one. `resident_observation_plan_rules.grace_minutes`
  is `NOT NULL DEFAULT 15`, so the branch was a second copy of the column default
  living in TypeScript. It is now `?? 0`: no grace of our own invention.
- The millisecond conversions moved into `src/lib/rounding/duration-units.ts`,
  which is the one place in the module a unit conversion is written.
- `CadenceWindowStrip.tsx` converted an hour to minutes on every render for its
  axis labels. The whole strip already speaks in minutes of the day, so the
  ticks now do too.

**Four findings remain and are recorded here rather than suppressed.** Both are
the same shape: a threshold that belongs in a row and currently sits in code.

| Finding | What it decides | Why it was not fixed in Part 8 |
|---|---|---|
| `src/components/rounding/IntegrityFlagCard.tsx:147-148` — `LAG_NOTABLE_MINUTES = 15`, `LAG_SERIOUS_MINUTES = 60` | how concerning a documentation lag reads on the Integrity tab | `public.facility_observation_thresholds` (migration `425`) is exactly where this belongs, next to `maximum_unobserved_gap_minutes`. It has no documentation-lag column, so the fix is a migration plus a probe extension. Part 8 adding a migration races the numbers `414`-`427` have already moved twice over. |
| `src/lib/rounding/update-task-status.ts:18-19` — `UPCOMING_LEAD_MINUTES = 30`, `OVERDUE_CEILING_MINUTES = 30` (and `CRITICALLY_OVERDUE_CEILING_MINUTES = 120`, which the scanner's number set does not cover) | which status a task renders as while it sits on the board | Same table, same migration. This file also arrived from `origin/main` rather than this branch, and `/api/rounding/tasks` reads it. |

Both are display bands rather than any of the six things acceptance 19
enumerates, and neither changes when a check is due, when its grace closes or
when a rung fires. **Acceptance 19 is therefore substantially but not fully
proven, and the honest statement is that four literals remain, named, with the
migration that would remove them identified.** They were lifted into named
constants with the reason in a comment next to them, so the next person finds
the decision rather than the number.

### 7.2 What the acceptance surface now is

| Artifact | Command | Acceptance items |
|---|---|---|
| seven SQL acceptance scripts (Parts 1-7) | `node scripts/smart-rounding/run-*-acceptance.mjs` | 1 (counted), 5, 7, 8, 9, 15, 16, 17, 18, 20, 21 |
| `supabase/tests/review_smart_rounding_authority.sql` | inside `npm run migrations:verify:pg` | the module's only regression net; D21 |
| `scripts/smart-rounding/config-literals.mjs` | `npm run smart-rounding:literals` | 19, with the four findings above |
| `scripts/smart-rounding/phi-scan.mjs` | `npm run smart-rounding:phi-scan` | 14 |
| `scripts/smart-rounding/rls-check.mjs` | `npm run smart-rounding:rls-check -- --target=staging` | **6 and 12, and unrun** |
| Playwright project `smart-rounding` | `SMART_ROUNDING_E2E=1 npm run smart-rounding:e2e` | 1 (rendered), 2, 3, 4, 10, 11, and **unrun** |
| `npm run typecheck`, `lint`, `test`, `build` | | 13 |

### 7.3 D17 still stands, and two acceptance items are unproven

`scripts/smart-rounding/rls-check.mjs` and the Playwright project both exist, both
refuse to run silently, and **neither has been run**. They need credentials for a
hosted project that the Part 8 session did not hold. Until they run:

- **Acceptance 6 and 12 are unproven.** The replay cannot reach them: it stands
  a fake `auth` schema in for Supabase and grants no Supabase default privileges.
- **Acceptance 2, 3, 4, 10 and 11 are proven only at the unit level**, by the
  component and library tests, not against a rendered surface.

The RLS check takes a target flag with no default, resolves `--target=staging` to
`iwcnajanvjvynolltflw`, and refuses `manfqmasfqppukpobpld` without
`--i-understand-this-is-production` because it calls `create_monitoring_order`
against a real resident. Its eight environment variables are listed in its
header; a missing one exits 2 and names every variable, never a skip.

### 7.4 The pilot resident count, for D15

`scripts/homewood/data/homewood-residents.csv` is the gitignored import source
for the pilot building and carries **32 residents**, not the 33 the spec's
acceptance item 1 asserts, and not the 200 or 25 the spec's defect 1 reports
elsewhere. That is the import source rather than the current active roster, so it
does not settle the number; it does mean **no discoverable source on this machine
supports 33**, and the acceptance script's derived assertion
(`residents x enabled windows`) stays the right shape. Do not tune a fixture to
reach 198.

### 7.5 The `phi-scan` design note worth keeping

The first two versions of `scripts/smart-rounding/phi-scan.mjs` both reported
dozens of things that were not PHI, for two separate reasons, and both are worth
knowing about before anybody writes another scanner over this data:

- The pilot import's `primary_diagnosis` column is quoted and full of commas, so
  a naive split on comma shifted every field to its right and the "emergency
  contact name" cell arrived holding fragments of a diagnosis. The scan then
  reported ordinary clinical English as a resident name in five unrelated files.
  It is quote aware now.
- A single surname is far too often an ordinary word. Sixty six of the import's
  ninety eight name tokens already appear somewhere in `origin/main`, so a lone
  token match is close to meaningless. The scan's primary test is a first and
  last name **pair** from one row of the import on one line, which has almost no
  false positive, plus exact dates of birth and phone numbers, plus a single
  token only when a resident **name column** is on the same line.

It is negative-control tested: planting one real resident's first and last name
into a file under `scripts/smart-rounding/` is caught by name, by line, and
without printing the name. It also caught a real name the Part 8 specialist had
written into one of its own comments.
