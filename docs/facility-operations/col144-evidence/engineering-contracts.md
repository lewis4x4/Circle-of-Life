# COL-144 settled engineering contracts

Settled 2026-09-10 from the live COL-144 acceptance, BUILD-SCOPE section 5 (principle 8: report a problem without pretending the task was performed; assign a next action and keep it visible through handover; OPS-002 minimal corrective-work loop in core) and the COL-142 issue identity. Migration: `supabase/migrations/342_hfo_issue_lifecycle.sql` (provisional branch-local slot, stacked on 341). Probe: `supabase/tests/review_hfo_issue_lifecycle.sql`. Race script: `scripts/facility-operations/test-issue-concurrency.py`. Q02 (who does, checks and covers each item) and Q29 (urgency, notification route, escalation timing) stay open: ownership is recorded as explicit assignments with effective history, never guessed from a role name, and no notification is sent.

## 1. Vocabulary

- **Issue**: the COL-142 `operation_issues` row (kind, summary, severity, subject scope, optional occurrence and receipt links, reporter). Its identity columns stay immutable; this issue adds a lifecycle.
- **Status**: `open` (nobody owns it), `assigned` (an owner is named), `waiting` (blocked on someone or something, with a reason and a follow-up instant), `resolved`. Reopening returns to `assigned` when an owner is still named, else `open`. Problem status is independent of performance: no lifecycle command touches a receipt or an occurrence.
- **Owner / backup**: a named user (`owner_user_id`) and/or a role (`owner_role`), likewise for the backup. Users must be active organisation members with a current site grant at assignment time; later loss of that grant does not rewrite history but makes the owner "not current" in reads, so the backlog shows uncovered work.
- **Event**: an immutable row of `operation_issue_events` for every lifecycle transition, with actor, expected issue revision, request key and fingerprint. The issue row is the current projection; the events are the history.
- **Revision**: `issue_revision`, a fresh fingerprint on every write; every command takes `p_expected_revision` and refuses a stale one (`Issue changed since it was read`, P0001) after the replay lookup.

## 2. Schema (migration 342)

### 2.1 `operation_issues` additions

`status` CHECK widened to `open`/`assigned`/`waiting`/`resolved`; `owner_user_id`, `owner_role public.app_role`, `backup_user_id`, `backup_role`, `assigned_at`, `accepted_at`, `accepted_by`, `waiting_reason`, `follow_up_at timestamptz`, `resolved_at`, `resolved_by`, `resolution_summary`, `resolution_receipt_id → operation_execution_receipts`, `reopen_count integer NOT NULL DEFAULT 0`, `issue_revision text`, `updated_at`. CHECKs: `assigned` ⇒ owner user or role present; `waiting` ⇒ `waiting_reason` and `follow_up_at` present; `resolved` ⇒ `resolved_at`, `resolved_by`, `resolution_summary` present; `open` ⇒ owner columns NULL. Existing rows (all `open`, created by 341 only in probes) satisfy the CHECKs; `issue_revision` is backfilled for any existing row.

`haven.guard_operation_issue` replaced in place: identity columns (`id`, `organization_id`, `facility_id`, `activity_id`, `subject_id`, `authority_class`, `task_instance_id`, `issue_kind`, `summary`, `severity`, `reported_by`, `reported_role`, `reported_at`, `request_key`, `request_hash`, `created_at`) immutable; `receipt_id` set once (341 rule kept); every other change only under the occurrence-command token; no DELETE; the guard writes `issue_revision` and `updated_at` on insert and update.

### 2.2 `operation_issue_events`

| column | rule |
|---|---|
| id; organization_id; facility_id; issue_id → operation_issues | |
| event_kind | `assigned`, `reassigned`, `accepted`, `covered`, `waiting`, `resumed`, `resolved`, `reopened`, `linked`. The report itself is not an event row: the 341 command bodies stay untouched and the issue row's `reported_by`/`reported_at` is the reporting fact, presented first in the read history. |
| from_status, to_status | |
| actor_id → user_profiles, actor_role | server-owned |
| expected_revision text | what the actor saw |
| request_key UNIQUE, request_hash | idempotent replay |
| details jsonb | owner/backup before and after, reason, follow_up_at, resolution summary and receipt, previous owner currentness |
| created_at | |

Immutable (guard: insert only, token required; no UPDATE/DELETE/TRUNCATE). RLS SELECT: the issue is readable (`task readable` when linked, else `subject accessible`). No client DML; service_role SELECT only. Audit trigger.

### 2.3 Read projection

`public.operation_issue_backlog` (`security_invoker`): every non-resolved issue with `owner_current boolean` (owner user active, not deleted, current site grant not revoked and not expired) and `backup_current boolean` computed at read time, `follow_up_overdue boolean` (`waiting` and `follow_up_at < clock_timestamp()`), the occurrence's `execution_state` when linked, and the last event kind and time. Unassigned, waiting and reassigned work is therefore visible in one authorized read.

## 3. Commands (session; SECURITY DEFINER with pinned search_path, public INVOKER wrappers, EXECUTE to authenticated only; token = `haven.operation_occurrence_token()`)

Common: `haven.lock_operation_issue_authority(p_issue uuid) RETURNS public.operation_issues`: issue FOR UPDATE; when task-linked, the task FOR SHARE and its template links; native subject pins FOR SHARE; facility, `user_facility_access`, `operation_subject_access`, `employee_medical_access`, profile/auth.users/auth.sessions FOR SHARE; `current_authorized_actor` managed; site authority `haven.operation_facility_access`; subject authority `haven.operation_subject_accessible(subject, org, facility, authority_class)` (for a task-linked issue also `operation_task_readable`). Everything before any issue fact is disclosed raises `Operation unavailable` (42501). Actor classes derived after the lock: `manager` = app role in the COL-133 broad list (`owner`, `org_admin`, `facility_admin`, `manager`, `admin_assistant`, `coordinator`, `nurse`, `dietary`, `maintenance_role`); `owner` = actor is `owner_user_id` or holds `owner_role`; `backup` = actor is `backup_user_id` or holds `backup_role`; `reporter` = actor is `reported_by`.

Every command: validate shape (22023) → lock → replay lookup on the event request key (same key + same hash → the existing event with `replayed:true`; different hash → `already saved with different content`) → `p_expected_revision = issue_revision` else `Issue changed since it was read` (P0001) → transition rule → write issue + event + `operation_audit_log` row on the linked task when any (`event_type='updated'`, event_data with the issue event) → re-lock → return `{ issue, event, replayed }`.

| command | who | from → to | payload |
|---|---|---|---|
| `assign_operation_issue_review(p_issue, p_request_key, p_expected_revision, p_payload)` | manager | open → assigned (`assigned`); assigned/waiting → same status (`assigned` when no owner was named before, else `reassigned` with details carrying the previous owner/backup and whether the previous owner was current; an acceptance by someone who is no longer owner, owner-role holder or the new backup is cleared and recorded) | `owner_user_id?`, `owner_role?`, `backup_user_id?`, `backup_role?`, `note?`; at least one owner field; users must be active org members with a current site grant and an operations role; roles must be operations roles (the list `haven.operation_facility_access` enforces); the backup role must differ from the owner role when neither user is named |
| `accept_operation_issue_review(p_issue, p_request_key, p_expected_revision, p_payload)` | owner (`accepted`) or backup (`covered`, only when the owner user is not current or `payload.cover_reason` is given) | assigned → assigned | `note?`, `cover_reason?` |
| `wait_operation_issue_review(…)` | manager, owner or backup | open/assigned → waiting | `reason` (required), `follow_up_at` (required, ≥ now) |
| `resume_operation_issue_review(…)` | manager, owner or backup | waiting → assigned when an owner is named else open | `note?` |
| `resolve_operation_issue_review(…)` | manager, owner or backup | open/assigned/waiting → resolved | `resolution_summary` (required), `resolution_receipt_id?` (an execution receipt readable by the actor on the same activity and subject; validated, never modified) |
| `reopen_operation_issue_review(…)` | manager or reporter | resolved → assigned when an owner is named else open; `reopen_count + 1`; resolution columns cleared on the row but preserved verbatim in the `reopened` event details and in the earlier `resolved` event | `reason` (required) |
| `link_operation_issue_review(p_issue, p_request_key, p_expected_revision, p_payload)` | manager, owner, backup or reporter | any non-resolved status, unchanged | `receipt_id` (a performance receipt on the same activity and subject); sets the 341 `receipt_id` once (`linked` event); a failed check whose receipt already created its own issue can additionally be linked to an earlier open issue this way, without reversing the inspection or completing anything |

Nothing in these commands writes to `operation_execution_receipts` or `operation_task_instances` other than the audit row on the linked task. In the other direction, an occurrence that still carries an unresolved linked issue cannot be cancelled or removed (`Occurrence has an open issue`), so open work never leaves the backlog through a cancellation; an issue whose native subject stops being current hides with the subject under the COL-133 rule (recorded as an owner decision, not changed here). Currentness helpers used by the backlog projection answer only for the caller's own organisation and sites they hold; the `wait` request hashes the supplied follow-up text so the same instant replays across session time zones, and its future check runs after the replay lookup.

## 4. Runtime and API

- `src/lib/operations/issues.ts`: zod schemas (strict) for each command body (`request_key`, `expected_revision` as a 64-hex fingerprint, `payload`), `ISSUE_SELECT`, `ISSUE_EVENT_SELECT`, `BACKLOG_SELECT`, `mapIssueRpcError` with the same outcome classes as receipts (`receipt`→ here `event`, `validation`, `denied`, `missing`, `conflict`, `uncertain`) and per-command nouns; trusted fragments for the plain 22023/P0001 wordings of 342.
- Routes: `GET /api/admin/operations/issues/[id]` (issue + events through the session client, RLS), `GET /api/admin/operations/issues/backlog?facility_id` (the projection; grant checked first), `POST /api/admin/operations/issues/[id]/assign|accept|wait|resume|resolve|reopen|link`. Pattern as COL-142: `requireOperationsActor(OPERATIONS_VIEW_ROLES)` → strict body → session read of the issue (404) → `actorCanAccessFacility` (404) → `revalidateOperationsActor` → RPC → mapping; replies strip `request_hash`.
- The existing `GET /api/admin/operations/issues` list gains `status` filtering and the new columns in its select.

## 5. Verification

- Probe (rolls back; fixtures reuse the 341 shape: versions, bindings, generated occurrences, a failed receipt that created an issue, a standalone help request, two managers at site A, a site B admin, an aide who is not a manager): assign open → assigned with event and audit; reassign records the previous owner; owner accepts; backup cannot accept while the owner is current without a cover reason, can with one, and can without one after the owner's site grant is revoked (`covered`); wait requires reason and future follow-up, then `follow_up_overdue` flips in the projection once the instant passes (fixture uses a past instant through the owner token); resume returns to assigned; resolve requires a summary, accepts a same-subject receipt and refuses a receipt from another subject or an unreadable one; resolving changes nothing on the receipt or occurrence (row hashes before/after); reopen by the reporter and by a manager, refused for the aide, increments the count, keeps the resolution in events; link a second open issue to the failed receipt without touching the receipt or the occurrence; every command: replay idempotent, changed content conflicts, stale revision conflicts, wrong status refused with the plain message; site B admin denied and sees no issue, event or backlog row; aide (not manager, not owner) denied on assign/reopen but allowed on wait/resolve once made owner; revoked session denied before any row; direct DML denied for authenticated and for service_role with a forged setting; events immutable; unassigned, waiting and reassigned issues all visible in the backlog with correct `owner_current`; 341 probe still passes.
- Race script: two managers assign concurrently with the same expected revision → one wins, the other gets the stale-revision conflict; two identical replays → one event; two resolutions with the same expected revision → serialised, the second refused by the moved revision (the revision check precedes the status check, so that is the only reachable refusal).
- Vitest: issues library (schemas, mapping), route tests for every route (session read before RPC, grant, revalidation, exact RPC args, outcome classes, no internal detail), list route filter.
- Gates: focused suite, typecheck, lint, native replay, strict gate `--segment COL-144-HFO-ISSUES --ui`.

## 6. Boundaries kept

No notification, reminder, escalation route or urgency policy (Q29 open; HFO-15 owns reminders). No inference of who covers whom from role names (Q02 open): every owner and backup is an explicit assignment with history. Corrections to receipts are HFO-08; verified evidence COL-143; the staff workspace HFO-10 consumes the backlog projection. Source only.
