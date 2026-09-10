# COL-142 settled engineering contracts

Settled 2026-09-10 from the live COL-142 acceptance, BUILD-SCOPE section 5 ("Execution receipt", "Command receipt", "Record work", server-authoritative outcomes) and the delivered COL-133/135/139 contracts. Migration: `supabase/migrations/341_hfo_execution_receipts.sql` (provisional branch-local slot, stacked on 340). Probe: `supabase/tests/review_hfo_execution_receipts.sql`. Race script: `scripts/facility-operations/test-receipt-concurrency.py`. Nothing here decides Q10 (what allows marking an item done) or Q12 (hands-on time): outcomes and evidence states are expressed, never inferred, and no activity is given a rule.

## 1. Vocabulary

- **Receipt**: an immutable row of `operation_execution_receipts` recording one act on one managed occurrence: a `performance` (the work) or a `verification` (the independent review the rule requires). The saved receipt is the only evidence of server acceptance.
- **Recorder**: the authenticated session actor (`auth.uid()`), never caller-supplied. **Performer**: who did the work; defaults to the recorder (`self`); `other_staff`, `vendor` and `unknown_historical` are explicit.
- **performed_at**: recorder-supplied instant of the work, never in the future (server clock + 2 minutes skew), defaults to the server clock. **recorded_at**: the server clock at acceptance. They are stored separately and never conflated.
- **Entry kind**: `routine` (self, performed within 15 minutes of recording), `late` (performed earlier than 15 minutes before recording), `on_behalf` (performer is not the recorder). `late` and `on_behalf` require `entry_reason`. `unknown_historical` performers are only allowed with `late`.
- **Outcome**: `performed`, `failed`, `not_performed`. `failed` requires an issue (created atomically). `not_performed` requires `entry_reason` and may carry an issue.
- **Completion state** (server-computed, on the receipt and mirrored on the occurrence): `completed`, `performed_missing_evidence`, `awaiting_verification`, `failed`, `not_performed`.
- Legacy rows (`occurrence_kind IS NULL`) keep the legacy completion command untouched; managed occurrences are recorded only through the receipt commands.

## 2. Schema (migration 341)

### 2.1 `operation_execution_receipts`

| column | rule |
|---|---|
| id uuid pk; organization_id; facility_id | |
| task_instance_id → operation_task_instances | managed occurrence (`occurrence_kind` set) |
| activity_id, subject_id, authority_class, requirement_version_id, facility_requirement_id | copied from the occurrence at acceptance (RLS and history; never re-resolved) |
| receipt_kind | `performance` / `verification` |
| recorder_id → user_profiles, recorder_role text | `auth.uid()` and `haven.app_role()` at acceptance |
| recorded_at timestamptz | `clock_timestamp()` |
| performed_at timestamptz | ≤ recorded_at + 2 minutes; performance only (verification uses recorded_at) |
| performer_kind | `self` / `other_staff` / `vendor` / `unknown_historical` |
| performer_user_id → user_profiles (other_staff), performer_vendor_id → vendors (vendor), performer_label text (vendor or unknown_historical) | exactly the one that fits the kind |
| entry_kind | `routine` / `late` / `on_behalf`; `entry_reason` text required unless routine |
| outcome | `performed` / `failed` / `not_performed` (performance); NULL for verification |
| values jsonb | object validated against the governing inputs (central `required_inputs` plus site `local_required_inputs` when set); every `required: true` key present; types, choices, min/max and unknown keys enforced; `{}` when the version has no inputs |
| note text (≤ 4000) | |
| evidence_status | `not_required` / `complete` / `missing`; `missing_evidence jsonb` lists the unmet rules (`kind`, `label`, `min_count`, `when`) |
| completion_state | see §1 |
| issue_id → operation_issues | the issue created with this receipt, when any |
| request_key text UNIQUE, request_hash text | idempotency; hash = sha256 of the canonical payload plus task and recorder |
| revision text | fresh fingerprint (like `occurrence_revision`) for HFO-08 corrections |
| superseded_by_receipt_id | NULL here; HFO-08 owns supersession |
| created_at | |

Constraints: one effective performance receipt per occurrence (`UNIQUE (task_instance_id) WHERE receipt_kind='performance' AND superseded_by_receipt_id IS NULL`) and one effective verification (`… WHERE receipt_kind='verification' AND superseded_by_receipt_id IS NULL`). Immutable: no UPDATE except HFO-08's future supersession (guard denies every update now; token-gated), no DELETE, no TRUNCATE. RLS SELECT: `haven.operation_task_readable(task_instance_id)`. No client DML; service_role SELECT only. Audit trigger.

### 2.2 `operation_issues` (minimal identity; HFO-14 extends lifecycle)

| column | rule |
|---|---|
| id; organization_id; facility_id; activity_id; subject_id; authority_class | subject scope copied from the task or supplied and validated |
| task_instance_id (nullable) → occurrence; receipt_id (nullable) → receipt | |
| issue_kind | `problem` / `help_request` / `failed_result` |
| summary text (1..2000); severity `low`/`normal`/`high` | |
| status | `open` only in this issue (CHECK); HFO-14 adds states |
| reported_by, reported_role, reported_at | server-owned |
| request_key UNIQUE, request_hash | idempotent creation |
| created_at | |

RLS SELECT: task readable when linked, else `haven.operation_subject_accessible(subject_id, org, facility, authority_class)`. No client DML; immutable except future HFO-14 commands (token-gated guard). Audit trigger; no TRUNCATE.

### 2.3 `operation_task_instances` additions

`effective_receipt_id`, `verification_receipt_id` (FKs), `performed_at timestamptz`, `execution_state text` (`none` default for managed rows; NULL for legacy; the completion states of §1). Written only by the receipt commands (extend `haven.guard_operation_occurrence`: these columns and, for managed rows, `status`/`completed_at`/`signed_*`/`second_sign_*`/`verified_*`/`sla_met` change only under the command token — the legacy complete and bulk paths cannot touch a managed row). Legacy dual-sign columns are mirrored for compatibility: performance receipt → `signed_by`/`signed_at`; verification → `second_sign_by`/`second_signed_at`/`verified_by`/`verified_at`; `completed_at` = the recorded_at of the receipt that completed the occurrence; `sla_met` = `performed_at <= coalesce(grace_ends_at, due_at)` (NULL when the occurrence has no deadline).

Status mapping: `completed` → `status='completed'`; every other completion state → `status='in_progress'` (the occurrence is not satisfied; the state column says why). `missed`/`deferred` occurrences may be recorded (late entry).

### 2.4 Legacy paths

`haven.complete_operation_task_review` replaced in place with the 337 body plus one guard: a managed row raises `Managed occurrences are recorded through the receipt command` (P0001). `haven.operation_task_command` `start` stays allowed. Bulk completion is already closed.

## 3. Commands (session; all SECURITY DEFINER with pinned search_path, public INVOKER wrappers, EXECUTE to authenticated only; token = `haven.operation_occurrence_token()`)

### 3.1 `public.record_operation_work_review(p_task uuid, p_request_key text, p_payload jsonb) → jsonb`

Payload keys (strict): `performed_at?`, `performer? { kind, user_id?, vendor_id?, label? }`, `entry_kind?`, `entry_reason?`, `outcome` (required), `values?`, `note?`, `issue? { kind, summary, severity? }`.

Order: validate shape (22023) → `haven.lock_operation_work_authority(p_task, governing recorder roles)` (the 337 locks on the task, subject, native rows, grants and session; task readable; `can_record` for protected classes and the resident role rule as COL-133; the actor's role must be in the governing list: the site's local recorder roles when set, else the central `allowed_recorder_roles`. The legacy `assigned_role` gate of `operation_task_mutable` does not apply to managed rows, because the published list is the rule someone wrote down and the assigned role is only a queue hint) → managed row check → replay lookup before any drift-sensitive validation: same key + same hash → return the existing receipt with `replayed:true`; same key + different hash → `already saved with different content`; a different key on an occurrence that already holds an effective performance receipt → `Work is already recorded for this occurrence` (23505 → 409 with the current receipt id) → status in `pending`/`in_progress`/`missed`/`deferred`, not cancelled or removed, `execution_state = none` → performer validation (other_staff: active user_profile in the org with a current site grant, no label; vendor: vendor linked to the site; unknown_historical: label required and entry_kind must be late) → performed_at ≤ clock_timestamp()+2 min (22023 `Performed time cannot be in the future`); lateness applies to every entry kind: performed earlier than 15 minutes before now requires `late` (a non-self performer that is also late uses `late`); performer not self otherwise requires `on_behalf`; both require a reason → values validated against inputs → evidence rules applicable to the outcome (`always`; `on_success` when performed; `on_failure` when failed; none for `not_performed`) with `min_count ≥ 1` are unmet (no verified evidence exists before COL-143) → completion state: failed/not_performed by outcome; else `performed_missing_evidence` when unmet rules exist; else `awaiting_verification` when the central version `review_required`; else `completed` → insert receipt (and issue when supplied or required) under the token, update the occurrence (state, mirrors, status), audit rows (`completed`, `signed` for awaiting verification, `recorded` with event_data for the other states; `issue_reported` on the task when an issue is created) → re-lock authority → return `{ receipt, occurrence: { id, status, execution_state, occurrence_revision, performed_at }, issue|null, replayed:false }`.

Cancellation of a managed occurrence that carries recorded work (`execution_state <> 'none'`) is refused (`Occurrence has recorded work`); corrections are HFO-08. Verification of a cancelled or removed occurrence is refused (`Occurrence is cancelled`).

### 3.2 `public.verify_operation_work_review(p_task uuid, p_request_key text, p_payload jsonb) → jsonb`

Payload: `note?`, `decision` (`verified` only in this issue; rejection is HFO-08/14). Requires an effective performance receipt in `awaiting_verification`; reviewer role in `allowed_reviewer_roles`; independence: reviewer ≠ performance recorder and ≠ performer_user_id (42501 `A different authorized staff member must verify this task`, the legacy wording). Evidence re-evaluated: if still missing → `performed_missing_evidence` stays and verification is refused (P0001 `Required evidence is missing`). Otherwise inserts the verification receipt, sets `completed`, mirrors, audit `verified` and `completed`. Idempotent by key/hash.

### 3.3 `public.report_operation_issue_review(p_request_key text, p_payload jsonb) → jsonb`

Payload: `task_instance_id?` or (`activity_id`, `facility_id`, `subject_id`), `kind`, `summary`, `severity?`. Authority: task readable and mutable when linked; else `operation_subject_accessible`. Creates an `open` issue; idempotent by key/hash; audit on the task when linked. Never changes any occurrence state (reporting a problem is not performing the work).

## 4. Runtime and API

- `src/lib/operations/receipts.ts`: zod schemas (strict), role handling, `mapReceiptRpcError` returning `{ status, error, outcome }` where `outcome` is the server-authoritative class from BUILD-SCOPE (`receipt`, `validation`, `denied`, `missing`, `conflict`, `uncertain`): 22023 → 400 `validation` (trusted message); 42501 → 403 `denied` ("Operation unavailable"); 23505 / "already recorded" / "already saved with different content" / "changed since" → 409 `conflict` (trusted message, plus `current_receipt_id` when the database supplies it); P0002 or a session read miss → 404 `missing`; anything else → 500 `uncertain` ("Record could not be confirmed; check the occurrence before retrying").
- Routes: `POST /api/admin/operations/occurrences/[id]/record`, `POST /api/admin/operations/occurrences/[id]/verify`, `GET /api/admin/operations/occurrences/[id]/receipts` (session select, RLS), `POST /api/admin/operations/issues`, `GET /api/admin/operations/issues?facility_id&task_instance_id?` (session select). Pattern as COL-139: `requireOperationsActor(OPERATIONS_VIEW_ROLES)` → strict body → session read of the occurrence (404) → `actorCanAccessFacility` (404) → `revalidateOperationsActor` → RPC → mapping. Successful responses echo `outcome: "receipt"`.
- `tasks/[id]/complete/route.ts`: add the managed-row refusal wording to the trusted set (409) and nothing else.
- `server.ts`/`types.ts`: pass through `execution_state`, `performed_at`, `effective_receipt_id` when selected; `tasks/route.ts` selects them.

## 5. Verification

- Probe: fixtures reuse the 340 probe shape (published versions with `required_inputs`, `required_evidence`, `review_required`, a site with local recorder roles; two bindings; generated occurrences; a legacy row). Cases: routine self record → completed, receipt fields, mirrors, `completed` audit, `sla_met`; same key/content replay → same receipt, no second row; same key/different content → conflict; different key on a recorded occurrence → `already recorded` with the current receipt id; future performed_at rejected; performed 2 hours ago without `late` rejected, with `late` and reason accepted and `performed_at`/`recorded_at` distinct; on-behalf other staff (current site staff) accepted with reason, terminated staff rejected, vendor accepted when linked to the site, unknown historical only when late; values: missing required key, wrong type, out-of-range number, unknown key, choice outside list rejected; photo-required activity → `performed_missing_evidence`, status in_progress, unmet rule listed, never completed; `on_failure` evidence applies only to failed outcomes; failed outcome without issue rejected, with issue creates an `open` issue atomically (issue visible, linked, audit); not_performed requires reason; review-required activity → awaiting_verification, self-verification refused, wrong role refused, independent reviewer completes with verification receipt and mirrors; verification with evidence missing refused; standalone issue report creates no receipt and changes no state; legacy complete on a managed row refused, legacy row still completes; managed row cannot be completed by direct UPDATE (service, authenticated); receipts and issues immutable (UPDATE/DELETE denied); other-site admin sees nothing and is denied; revoked session and revoked `can_record` denied before any row; cancelled occurrence refuses recording; missed occurrence accepts a late entry and keeps `missed_at`.
- Race script (two connections): two differing record attempts for the same occurrence → exactly one receipt, the loser gets the conflict naming the winner; two identical replays concurrently → one receipt, both return it; a `can_record` revocation committed while the recorder waits on the task lock → denied, no receipt.
- Vitest: receipts library (schemas, error classes), route tests (session read before RPC, grant, revalidation, exact RPC args, outcome classes, no internal detail), task-list pass-through, complete route trusted wording.
- Gates: focused suite, typecheck, lint, native replay, strict gate `--segment COL-142-HFO-RECEIPTS --ui`. Deno untouched (no Edge function changes).

## 6. Boundaries kept

No verified evidence exists before COL-143, so every evidence-requiring activity records as `performed_missing_evidence`; that is the truthful state, not a defect. Corrections/supersession are HFO-08; issue assignment, waiting, resolution and reopening are HFO-14; staff workspace is HFO-10. Q10 and Q12 stay open. Source only: no merge, hosted migration, deployment, schedule activation, external transmission.
