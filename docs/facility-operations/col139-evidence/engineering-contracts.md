# COL-139 settled engineering contracts

Settled 2026-09-10 from the draft plan, the test specification and the architect amendments in `architecture-planning.md`. These are the contracts the implementation lanes build to. They amend nothing in COL-132/133/135/137; every existing guarantee (stable activity identity, current authority after waits, immutable published versions, the shared evaluator as the only recurrence authority) is preserved and reused, not re-implemented.

Migration: `supabase/migrations/340_hfo_occurrences.sql` (provisional branch-local slot, stacked on 339). Probe: `supabase/tests/review_hfo_occurrences.sql`. Lock race script: `scripts/facility-operations/test-occurrence-concurrency.py`.

## 1. Vocabulary

- **Occurrence**: a row of `operation_task_instances` that carries a managed identity (`occurrence_kind IS NOT NULL`). Legacy rows (`occurrence_kind IS NULL`) keep their existing behaviour untouched; nothing remaps or reclassifies them.
- **Identity**: activity + site + typed subject + period key + shift (`scheduled`), activity + site + subject + source event (`event`), or activity + site + subject + request key (`manual`). Never the template id, the requirement version id, the configuration id or the deadline.
- **Governing instant** (`governing_at`): the precise instant at which the central version and site configuration are chosen. Scheduled: the occurrence `due_at`. Event: the source event instant. Manual: the creation instant (`clock_timestamp()`).
- **Binding**: an explicit, effective-dated enrolment of one typed subject in one activity at one site. Registry existence and site configuration never enrol a subject.

## 2. Schema (migration 340)

### 2.1 `operation_activity_bindings`

| column | type | rule |
|---|---|---|
| id | uuid pk | |
| organization_id, facility_id | uuid not null | facility must be active and belong to the org |
| activity_id | uuid not null | FK (organization_id, activity_id) → operation_activities; activity `subject_kind` must be non-null and must equal the subject's kind |
| subject_id | uuid not null → operation_activity_subjects | subject must belong to the same org and site |
| authority_class | text not null | `facility`→{facility, financial}; `resident`→{resident}; `employee`→{employee_personnel, employee_medical}; `asset`→{asset} |
| shift | text null | `day`/`evening`/`night`; NULL = whole day |
| provenance | jsonb not null object | `{ "source": "admin_log"\|"interview"\|"facility_policy"\|"regulator"\|"other", "reason": text }`, reason required |
| effective_from | timestamptz not null | |
| effective_to | timestamptz null | > effective_from; set once by retirement |
| retired_by uuid null, retired_at timestamptz null, retirement_reason text null | | set together with effective_to; `retired_by` NULL when the service reconciliation closed it |
| created_by uuid not null, created_at | | session actor; the service never creates bindings |

Unique open binding: `(activity_id, subject_id, coalesce(shift,'all')) WHERE effective_to IS NULL`. Identity columns immutable after insert; the only permitted update sets `effective_to`, `retired_*` on an open row. No DELETE. RLS: SELECT for authenticated when the subject is accessible (`haven.operation_subject_accessible(subject_id, organization_id, facility_id, authority_class)`); no client DML (all writes through commands); service_role SELECT only. Audit trigger `haven_capture_audit_log`. No TRUNCATE (reuse `haven.guard_operation_catalog_truncate`).

Facility-kind activities need no binding: the site's `facility` subject (one per site, created on demand by the generation command as 337 did) is the subject, and the applicable, confirmed site configuration is the explicit enrolment. This is an engineering policy recorded in OWNER-DECISIONS.md, not an inference about people or assets.

### 2.2 `operation_task_instances` additions

| column | type | rule |
|---|---|---|
| occurrence_kind | text null | `scheduled` / `event` / `manual`; NULL = legacy row |
| binding_id | uuid null → operation_activity_bindings | required for non-facility subjects on `scheduled`/`event`; NULL for the facility subject |
| period_key | text null | scheduled: the evaluator `occurrence_date` (`YYYY-MM-DD`); event: `event_key` + `:` + validated `source_event_id`; manual: NULL |
| period_start_date, period_end_date | date null | inclusive local period from the evaluator; NULL for manual; start ≤ occurrence_date ≤ end |
| governing_at | timestamptz null | see §1; NOT NULL when `occurrence_kind` is set |
| grace_ends_at, remind_at | timestamptz null | evaluator outputs; represented, never delivered (HFO-15) |
| schedule_snapshot | jsonb null | `{ evaluator_version, rule_version, timezone, rule_sha256, occurrence_date, period:{start_date,end_date}, due_at, grace_ends_at, remind_at, adjustments[], queue_date_is_compatibility_only? }`; immutable |
| source_event_key, source_event_id, source_event_at | text, text, timestamptz null | required together for `event`; `source_event_id` matches `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$` |
| request_key | text null | manual creation idempotency key; unique where not null |
| request_hash | text null | sha256 hex of the canonical manual payload |
| occurrence_revision | text | fresh sha256 written by the identity guard on every managed insert and update (PostgreSQL rejects the originally planned generated column because `convert_to` is STABLE); the optimistic fingerprint clients echo back |

Indexes and constraints:

- `operation_occurrence_identity` UNIQUE `(activity_id, facility_id, subject_id, period_key, coalesce(assigned_shift,'all')) WHERE occurrence_kind IN ('scheduled','event')`. **Not** filtered on `deleted_at` or status: a cancelled or soft-deleted occurrence keeps its identity, so replay never recreates it.
- `operation_occurrence_request_key` UNIQUE `(request_key) WHERE request_key IS NOT NULL`.
- CHECK: `occurrence_kind IS NULL` ⇒ all new columns NULL except `occurrence_revision`. `scheduled` ⇒ period_key, period dates, governing_at, due_at, schedule_snapshot, requirement_version_id, facility_requirement_id NOT NULL, subject_id NOT NULL, authority_class ≠ unclassified, source_event_* NULL. `event` ⇒ same plus source_event_* NOT NULL. `manual` ⇒ period_key/period dates/due_at/grace/remind NULL, governing_at, request_key, request_hash, requirement_version_id NOT NULL, subject_id NOT NULL.
- `assigned_shift_date` for manual = the labelled compatibility queue date (facility-local date supplied or today); `schedule_snapshot.queue_date_is_compatibility_only = true`. It is never a period or a compliance date.
- Identity guard trigger (`haven.guard_operation_occurrence`, BEFORE INSERT OR UPDATE, fires before `zz_operation_current_authority`): on INSERT with `occurrence_kind` set, require the transaction-local setting `haven.operation_occurrence_command` to equal an unforgeable per-transaction token (`haven.operation_occurrence_token()`: sha256 of the current transaction id and a secret held in an owner-only table, executable only by the owner-run definer commands). A plain `set_config('…','approved')` by the service identity, which holds INSERT/UPDATE on the instance table for the legacy path, therefore cannot mint a managed identity; the independent SQL review demonstrated that the first version's fixed-string flag could be forged, and the token replaced it. On UPDATE: `occurrence_kind, binding_id, period_key, period_start_date, period_end_date, governing_at, schedule_snapshot, source_event_*, request_key, request_hash, grace_ends_at, remind_at` immutable; `due_at` immutable for managed rows; any UPDATE to a managed row by the service identity (`auth.uid() IS NULL`) requires the command setting (closes the service bypass); `deleted_at` on a managed row requires the command setting and `status = 'cancelled'`.

### 2.3 `operation_occurrence_associations`

| column | rule |
|---|---|
| id uuid pk; organization_id; facility_id | |
| occurrence_task_id → operation_task_instances | must be `scheduled` or `event` |
| work_task_id → operation_task_instances | must be `manual`; UNIQUE (one work row satisfies at most one occurrence) |
| association_kind | `early` / `late` / `unscheduled` (explicit cardinality one-to-one; no many-to-one) |
| expected_revision | the `occurrence_revision` the client saw; must match at command time |
| request_key UNIQUE, request_hash | idempotent replay; changed payload under the same key is a conflict |
| reason text not null | |
| created_by, created_at | session actor |

Immutable (no UPDATE/DELETE; trigger). RLS SELECT: both tasks readable. No client DML. Audit trigger. Association never changes either task's status, identity, snapshot or timestamps; it records the relation and two `operation_audit_log` rows (`event_type='associated'`) with the association id, kind and expected revision.

### 2.4 `operation_audit_log.event_type`

Extend the CHECK with `generated`, `associated`, `reconciled`. Generation writes one `generated` row per created occurrence (actor NULL, `event_data` = run id, evaluator version, rule sha256, configuration id, version id, governing instant). Cancellation writes `cancelled`. Binding retirement by the service writes `reconciled` on each cancelled occurrence. Manual creation writes `created`.

## 3. Commands

All are `haven.*` SECURITY DEFINER with `SET search_path=''`, public `SECURITY INVOKER` wrappers, EXECUTE revoked from PUBLIC/anon and granted only to the intended role. Session commands lock target rows and authority rows (reuse `haven.assert_operation_requirement_actor`, `haven.lock_operation_authority`, `haven.operation_subject_accessible`) before and re-check after DML, exactly as 337/338 do. Service commands run only with `auth.uid() IS NULL` and the `service_role` grant, and cannot record performed work (the 337 trigger already refuses created_by/completed/signed on service rows; the commands never set them).

### 3.1 Bindings (session)

- `public.enroll_operation_binding_review(p_activity uuid, p_facility uuid, p_subject uuid, p_authority_class text, p_shift text, p_provenance jsonb, p_effective_from timestamptz) → jsonb` (the binding row). Actor: `assert_operation_requirement_actor(org, facility)` (owner/org_admin/facility_admin with a current site grant) **and** `operation_subject_accessible(subject, org, facility, authority_class)` so a resident binding needs the resident scope. Refuses: facility-kind subject (needs no binding), activity subject_kind mismatch, subject not current, an open binding already present for the same (activity, subject, shift) → 23505 mapped to conflict, effective_from earlier than one day ago (`cannot rewrite history`, same wording as 338).
- `public.retire_operation_binding_review(p_binding uuid, p_effective_to timestamptz, p_reason text) → jsonb`. Sets effective_to/retired_* once. Does **not** touch occurrences (history stays; future pending work for a retired binding is cancelled only by the explicit cancel command or the service reconciliation).

### 3.2 Generation (service)

`public.generate_operation_occurrences_service(p_facility uuid, p_configuration uuid, p_occurrences jsonb, p_run jsonb) → jsonb`

Input `p_occurrences`: array of evaluator outputs `{ occurrence_date, period:{start_date,end_date}, due_at, grace_ends_at, remind_at, timezone, adjustments[], shift? }` (max 400 per call). `p_run`: `{ run_id, evaluator_version, rule_sha256, date_from, date_to }`.

Validation (any failure of the whole-call checks raises; per-item failures are reported, not raised):

1. Configuration exists, belongs to the facility, `status='published'`, `applicability='applicable'`, `schedule_status='confirmed'`, rule valid (`haven.operation_schedule_rule_valid`), `requirement_version_id` set. `rule_sha256` = `encode(sha256(convert_to(schedule_rule::text,'UTF8')),'hex')` recomputed in the database must equal `p_run.rule_sha256` (the scheduler evaluated exactly this rule). `evaluator_version = 'hfo-evaluator/1'`. `timezone` of every item = rule timezone. `date_from ≤ date_to`, span ≤ 800 days.
2. Per item: `occurrence_date` is a calendar date inside `[date_from,date_to]`; `period.start_date ≤ occurrence_date ≤ period.end_date`; `due_at` is a timestamp; `grace_ends_at ≥ due_at` when present; `shift` in day/evening/night or absent; reversed/invalid values → outcome `invalid` with reason.
3. Governing instant = `due_at`. The configuration must be in force at that instant (`effective_from ≤ due_at < coalesce(effective_to, 'infinity')`) and its central version must be in force at that instant → otherwise outcome `configuration_not_in_force` (this is what makes catch-up generate historical periods under the versions that governed them, and what makes a same-day cutover pick the right version).
4. Subject expansion: activity `subject_kind='facility'` → the site's facility subject (insert on demand). Otherwise every binding for (activity, site) whose window covers the governing instant, whose `shift` is NULL or equals the item shift, and whose subject is still current (`haven.operation_subject_current`) → one candidate each; a binding whose subject is no longer current → outcome `binding_not_current`; no binding → outcome `no_binding` (never a facility fallback for people or assets).
5. Serialization: `pg_advisory_xact_lock(hashtext(activity_id::text||facility_id::text||subject_id::text))` per candidate before the overlap check and insert.
6. Overlap: an active occurrence (`deleted_at IS NULL AND status <> 'cancelled'`) with the same (activity, site, subject), `occurrence_kind='scheduled'`, a **different** `period_key`, inclusive period ranges overlapping, and shifts not both non-null-and-different → outcome `conflict` with the existing id (no insert). Same period_key and same shift → `INSERT … ON CONFLICT ON CONSTRAINT/index DO NOTHING`; if nothing inserted → outcome `existing` with the existing id (cancelled and soft-deleted rows count as existing; they are never revived or recreated).
7. Insert: `status='pending'`, `template_id NULL`, `activity_id`, `subject_id`, `authority_class` from the binding (facility subject → `facility`), `template_name`/`template_category`/`template_cadence_type` from the central version title / `'compliance'` / `'scheduled'` (compatibility columns), `assigned_shift_date = occurrence_date`, `assigned_shift = shift`, `assigned_role` from the configuration owner role else central first recorder role, `due_at`, `grace_ends_at`, `remind_at`, `requirement_version_id`, `facility_requirement_id`, `governing_at`, `period_*`, `schedule_snapshot`, `occurrence_kind='scheduled'`, `binding_id`, priority `normal`, `requires_dual_sign = review_required`. Audit `generated`.
8. Return `{ run_id, configuration_id, requirement_version_id, evaluator_version, outcomes:[{occurrence_date, shift, subject_id, binding_id, outcome, task_id, existing_task_id, conflict_task_id, reason}], counts:{created, existing, conflict, no_binding, binding_not_current, configuration_not_in_force, invalid} }`.

Event occurrences use the same command with `occurrence_kind='event'` items carrying `source_event_key`, `source_event_id`, `source_event_at`; governing instant = `source_event_at`; period_key = `event_key:source_event_id`. No production adapter calls it; the probe does.

### 3.3 Service reconciliation

`public.reconcile_operation_occurrences_service(p_facility uuid, p_run jsonb) → jsonb`. For each open binding at the site whose subject is no longer current (`NOT haven.operation_subject_current(...)`): close it (`effective_to = clock_timestamp()`, `retired_by NULL`, `retirement_reason = 'subject no longer current'`), and cancel each of its occurrences that is `pending` with `period_start_date > ` the facility-local date of now (future work only) → `status='cancelled'`, `cancellation_reason = 'subject retired before the period'`, audit `reconciled`. Never touches in_progress, completed, missed, deferred rows, past or current periods, evidence or timestamps. Returns counts and ids.

### 3.4 Manual unscheduled occurrence (session)

`public.create_operation_manual_occurrence_review(p_activity uuid, p_facility uuid, p_subject uuid, p_request_key text, p_payload jsonb) → jsonb` (the row).

- Actor: `assert_operation_requirement_actor`-style session checks with the recorder rule from 337: `operation_subject_accessible(subject, org, facility, class)` and, for protected classes, a `can_record` subject grant; the app role must be in the union of the central version's `allowed_recorder_roles` and the site's `local_allowed_recorder_roles` (when set, the local list governs).
- Requires a central version in force now and a site configuration in force now with `applicability <> 'not_applicable'` (schedule may be `needs_confirmation`: that is the point). Snapshots both at `governing_at = clock_timestamp()`.
- Payload keys: `queue_date` (facility-local `YYYY-MM-DD`, default today), `shift` (optional), `note` (≤ 2000). `request_hash = sha256(jsonb_build_object('activity',…,'facility',…,'subject',…,'queue_date',…,'shift',…,'note',…)::text)`. Same key + same hash → returns the existing row with `replayed: true`; same key + different hash → raises `This request was already saved with different content` (P0001, mapped to 409).
- Row: `occurrence_kind='manual'`, `status='pending'`, no period, no due, `assigned_shift_date = queue_date`, `schedule_snapshot = { evaluator_version:'hfo-evaluator/1', queue_date_is_compatibility_only:true, timezone }`, `created_by = auth.uid()` (set by the 337 trigger). Audit `created`.

### 3.5 Association (session)

`public.associate_operation_occurrence_review(p_occurrence uuid, p_work uuid, p_kind text, p_expected_revision text, p_reason text, p_request_key text) → jsonb`.

- `lock_operation_authority` on both rows (both must be mutable by the actor after locks). Same activity, site and subject. Occurrence kind `scheduled`/`event`; work kind `manual`. Occurrence may be in any status including `completed` and `cancelled`? No: `cancelled` and soft-deleted occurrences refuse (`Occurrence is cancelled`); completed is allowed (a late receipt may still be reconciled to a completed occurrence; the association implies nothing about completion).
- `p_expected_revision` must equal the occurrence's current `occurrence_revision` → otherwise `Occurrence changed since it was read` (P0001 → 409).
- Replay: same key + same hash (`sha256({occurrence, work, kind, reason})`) → existing association, `replayed:true`; same key + different hash → conflict; work already associated to another occurrence → `Work is already associated` (23505 → 409).
- Writes the association row and two audit rows; changes nothing on either task.

### 3.6 Cancellation (session)

`public.cancel_operation_occurrence_review(p_task uuid, p_reason text, p_request_key text) → jsonb`. Managed rows only (legacy rows keep their existing paths). `lock_operation_authority`; from `pending`/`in_progress`/`missed`/`deferred` → `cancelled` with `cancellation_reason`, audit `cancelled`; identity, snapshot, started_at and every evidence column untouched; replay with the same key (stored in `event_data`) returns the same outcome; already cancelled → `replayed:true` when the key matches, else `Occurrence is already cancelled`.

### 3.7 Legacy paths protected

- `haven.defer_operation_task_review`: replaced in place with one added guard at the top: a managed row (`occurrence_kind IS NOT NULL`) raises `Managed occurrences cannot be deferred by the legacy command` (P0001). Legacy rows keep the exact 337 behaviour.
- `haven.operation_task_command`: `reinstate` on a managed row raises `Managed occurrences cannot be reinstated by the legacy command`; `start` stays allowed (it is the ordinary in-progress transition).
- `haven.sync_meeting_action_status`: unchanged (it already refuses meeting-driven task status).
- Service updates of managed rows outside the commands: refused by the identity guard (§2.2).

## 4. Runtime (Deno scheduler)

`supabase/functions/oce-task-scheduler/index.ts`:

1. Legacy template pass unchanged in shape, with two compatibility corrections: existence is keyed on `activity_id` (stable across template revisions; the DB binds `activity_id` from the template) instead of `template_id`, and the insert uses `upsert(..., { onConflict, ignoreDuplicates: true })` on the legacy generation index so a concurrent legacy run converges instead of failing. A legacy template whose activity has a confirmed applicable configuration in force at the site is skipped for that site (managed generation supersedes; reported under `superseded_templates`).
2. Managed pass: page through `operation_facility_requirements` (`status='published'`, `applicability='applicable'`, `schedule_status='confirmed'`, facility in scope, window intersecting the range) with `.range()` pages of 200 until a short page. For each configuration: `validateScheduleRule(schedule_rule)` (invalid → `unknown_schedules`, never generated), `listOccurrenceDates` over the range clipped to the configuration window in the rule timezone, `resolveOccurrence` per date, `event` rules reported under `event_rules_awaiting_source` (no adapter), then one `rpc('generate_operation_occurrences_service', …)` per configuration with `rule_sha256` computed over the JSON text exactly as PostgREST returns the column (`JSON.stringify` of the returned object is **not** guaranteed to match `jsonb::text`; the scheduler sends the rule back and the database recomputes the hash on the stored column and compares it with a hash the scheduler computes from the database's own `haven.operation_schedule_rule_sha256(id)` read in the same page query — see note). Per-run outcomes are summed and returned truthfully (`created`, `existing`, `conflict`, `no_binding`, `binding_not_current`, `configuration_not_in_force`, `invalid`, `rpc_failed` with the configuration id). An RPC error for one configuration never aborts the run; it is counted and reported.
3. After generation (not in dry run): `rpc('reconcile_operation_occurrences_service', { p_facility, p_run })` per facility; counts reported under `reconciled`.
4. `dry_run` previews managed candidates without calling either RPC.
5. Response keeps every existing field and adds `managed: { configurations, created, existing, conflict, no_binding, binding_not_current, configuration_not_in_force, invalid, rpc_failed, event_rules_awaiting_source, superseded_templates, reconciled }`.

Note on the rule hash: the migration exposes `haven.operation_schedule_rule_sha256(p_configuration uuid) → text` (STABLE, service EXECUTE) and the scheduler selects it alongside the configuration row (`select: "…, schedule_rule"` plus an RPC batch is heavier; instead the generation command itself recomputes the hash from the stored column and compares with `p_run.rule_sha256` only when supplied, and always records the database-computed hash in the snapshot). Contract: the scheduler passes the rule object it evaluated in `p_run.rule` and the database asserts `p_run.rule = schedule_rule` (jsonb equality, key-order independent) — this is the trusted-evaluator contract without text-canonicalisation ambiguity. `rule_sha256` in the snapshot is database-computed.

`supabase/functions/risk-nightly-scorer/index.ts`: untouched.

## 5. API (Next.js, session)

Under `src/app/api/admin/operations/occurrences/`:

| route | method | roles (`requireOperationsActor`) | RPC |
|---|---|---|---|
| `bindings/route.ts` | GET `?facility_id&activity_id?` | REQUIREMENT_VIEW_ROLES | session-client select on `operation_activity_bindings` (RLS) |
| `bindings/route.ts` | POST `{activity_id, facility_id, subject_id, authority_class, shift?, provenance, effective_from}` | REQUIREMENT_FACILITY_ROLES | `enroll_operation_binding_review` |
| `bindings/[id]/retire/route.ts` | POST `{effective_to, reason}` | REQUIREMENT_FACILITY_ROLES | `retire_operation_binding_review` |
| `route.ts` | GET `?facility_id&activity_id?&subject_id?&date_from?&date_to?` | OPERATIONS_VIEW_ROLES | session-client select of managed rows (identity, period, snapshot, revision) |
| `manual/route.ts` | POST `{activity_id, facility_id, subject_id, request_key, payload}` | OPERATIONS_VIEW_ROLES (DB decides recording authority) | `create_operation_manual_occurrence_review` |
| `[id]/associate/route.ts` | POST `{work_task_id, association_kind, expected_revision, reason, request_key}` | OPERATIONS_VIEW_ROLES | `associate_operation_occurrence_review` |
| `[id]/cancel/route.ts` | POST `{reason, request_key}` | OPERATIONS_VIEW_ROLES | `cancel_operation_occurrence_review` |

Pattern: `requireOperationsActor` → zod body → `actorCanAccessFacility` (404 before any read/command) → `revalidateOperationsActor` → RPC → `mapOccurrenceRpcError` (42501→403 "Operation unavailable", 22023→400 with the database's plain message, 23505/P0001 conflict wording→409, else 500 without echoing internals). Request keys are client-supplied UUID-ish strings (`^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$`); the DB stores them. Shared shapes in `src/lib/operations/occurrences.ts` (zod schemas, role sets, error mapping, `OccurrenceRecord` type guard). `src/lib/operations/types.ts` `OperationTask` gains optional `occurrence_kind`, `period_start_date`, `period_end_date`, `subject_id`, `occurrence_revision`; `server.ts` selects them (no behaviour change elsewhere).

## 6. Verification lanes

- SQL probe `review_hfo_occurrences.sql` (rolls back; fixtures synthetic; Supabase stubs): fixtures publish a central version and an applicable confirmed weekly configuration through the 338 commands; two same-type assets bound → two rows; replay → `existing`; revised configuration (v2 effective in one minute) → same-period replay keeps v1 snapshot and reports `existing`; same-day cutover → items due before/after the cutover instant snapshot v1/v2 respectively; timezone change between versions keeps the period identity and changes the due instant; shifted vs unshifted overlap → `conflict`; overlapping different period keys → `conflict`; binding retired before the governing instant → `no_binding`; subject transferred → `binding_not_current`; cancel → replay → `existing`, no new row; service soft-delete through the command path → replay does not recreate; manual: no period/due, queue date labelled, replay idempotent, changed payload conflict; association: early and late to a generated and to a completed occurrence, revision mismatch conflict, repeat idempotent, second association of the same work refused; legacy defer and reinstate on a managed row refused, legacy row defer still works; wrong-site admin, terminated employee subject, unpublished/not-in-force configuration, service impersonation of session commands, session revoked before the command: all denied atomically with no rows; direct service INSERT of a managed row refused; reads: the other site's binding/occurrence/association invisible; the ambiguity assertion from 137 still holds (no rule confirmed by migration).
- Lock race script (python, two connections on the run-owned cluster, like `test-current-authority.py`): two concurrent `generate_operation_occurrences_service` calls for the same configuration/period → exactly one row, both report the same task id (`created`/`existing`); a binding retirement committed while the generator waits on the advisory lock → `no_binding`/`binding_not_current` after the wait, no row.
- Vitest: scheduler harness (rpc stub added) proves managed configurations generate only through the evaluator, event rules are reported not generated, a legacy template with a confirmed configuration is superseded, partial pages are read to the end, one RPC failure is counted without aborting, dry run calls no RPC, the legacy existence key is the activity; route tests for each new route (site guard before read, zod refusal, RPC error mapping, request key forwarding); `occurrences.ts` schema tests.
- Gates: focused suite, `npm run typecheck`, `npm run lint`, `deno check --no-lock` on the scheduler, native replay (`migrations:verify:pg` with the three `PG_VERIFY_NATIVE_*` variables), strict `segment:gates --segment COL-139-HFO-OCCURRENCES --ui`.

## 7. Boundaries kept

No hosted migration, deployment, schedule confirmation for any facility, binding for any real subject, reminder delivery, completion receipt (COL-142), evidence transport (COL-143), external transmission. Finance-first integration order and provisional numbering stand. Q05 (source-event semantics) stays open: the `event` path exists in the database and the probe only.
