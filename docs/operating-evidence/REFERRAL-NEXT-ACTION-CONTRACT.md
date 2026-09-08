# Bounded HCOL-08 accountable referral action

Implementation contract after the inventory repair, 8 September 2026. This adds explicit work ownership to existing referral episodes. It does not approve Jessica's stage/closure vocabulary, default deadlines, notification cadence, clinical readiness or person matching.

One open action per lead. Required action text and owner; an explicit due_at ISO instant or waiting condition (both allowed); optional backup and dependency text. Status is open/completed/superseded. Updates increment version; substantive term updates increment terms_version and reset acceptance. Acknowledgment is only by the named owner; backup acceptance only by the named backup. Assignment is never acceptance. Existing accepted backup coverage survives an unavailable owner. Dynamic eligibility determines whether either person can currently act.

Reads preserve the existing authorized referral audience (current organization and accessible facility); writer permissions are derived separately. Assignee selection is writer-only.

Use existing referral writer roles: owner, org_admin, facility_admin, nurse. These roles can manage and complete with evidence; do not invent a new requirement that only an acknowledged owner may complete. Completion records the actual actor. Candidate eligibility checks current active profile/Auth record and facility scope, without requiring an online session. Actor authorization checks the signed current session/claim version and revalidates after lock waits.

Commands are atomic with immutable history and receipts. Request UUID binds actor, lead/action scope, command, expected version and exact payload. Exact replay returns original result under current authority; conflicting reuse or stale versions cannot change state. Lead is locked first consistently. One-open uniqueness also protects competing creates. History/receipt failures roll back the command.

Guard lead organization/facility moves, merge and deletion while an action is open. Retain history without cascading deletion. Converted/lost status and actual move-in remain compatible and never auto-complete work. No communication is sent automatically.

## Public RPCs

SECURITY INVOKER wrappers call narrow, fully authorizing private implementations. No ordinary authenticated direct table mutation.

- `haven_command_referral_next_action(p_request_id uuid, p_lead_id uuid, p_action_id uuid, p_expected_version integer, p_command text, p_payload jsonb)` returns `{request_id, action: ActionView, previous_action?: ActionView}`. Create has null action_id and expected_version 0.
- `haven_list_referral_next_actions(p_facility_id uuid, p_lead_id uuid default null, p_open_only boolean default true, p_before_created_at timestamptz default null, p_before_id uuid default null, p_limit integer default 25)` returns `{items: ActionView[], next_cursor: {created_at,id}|null}`. Descending stable keyset pagination. Include lead_name for hub display.
- `haven_list_referral_next_action_events(p_lead_id uuid, p_action_id uuid default null, p_before_created_at timestamptz default null, p_before_id uuid default null, p_limit integer default 25)` returns `{items: ActionEvent[], next_cursor: {created_at,id}|null}`.
- `haven_list_referral_next_action_assignees(p_facility_id uuid, p_after_user_id uuid default null, p_limit integer default 50)` returns `{items: {id,full_name,app_role}[], next_cursor: string|null}`; ascending user-ID keyset pagination.
- `haven_get_referral_next_action_receipt(p_request_id uuid,p_lead_id uuid)` returns same actor's original command result or null. Revalidate current authority before exposing any receipt.

`ActionTerms`: action_text:string, owner_id:uuid, backup_id:uuid|null, due_at:ISO|null, waiting_condition:string|null, dependency_text:string|null.

Command payloads:

- create: ActionTerms
- update: ActionTerms plus change_note:string
- acknowledge: acknowledgment_note:string|null
- accept_backup: acceptance_note:string|null
- complete: completion_evidence:string
- supersede: replacement:ActionTerms plus supersede_evidence:string

`NextAction`: ActionTerms plus id, organization_id, facility_id, lead_id, status, version, terms_version, owner_acknowledged_at, owner_acknowledged_version, backup_accepted_at, backup_accepted_version, completed_at, completed_by, completion_evidence, superseded_by_action_id, created_at, created_by, updated_at. Nullable acceptance/completion fields until recorded.

`ActionView`: NextAction plus lead_name:string, owner_name:string, backup_name:string|null, owner_eligible:boolean, backup_eligible:boolean, owner_acknowledged:boolean, backup_accepted:boolean, can_manage:boolean, can_acknowledge:boolean, can_accept_backup:boolean, can_complete:boolean.

`ActionEvent`: id, request_id, action_id, lead_id, command, actor_id, actor_name, created_at, payload:object, before_state:NextAction|null, after_state:NextAction. Supersede event uses old action_id and after_state is its superseded state; receipt result also retains replacement action.

## Operator and recovery behavior

Referral-detail panel shows active work, explicit owner/backup acceptance, due/waiting/dependency, unavailable-person status, completion/supersede with evidence, and paginated history. Preserve drafts on uncertain/stale saves; keep an explicit refresh control. Facility/user/lead changes must invalidate pending async updates.

Before dispatch, store an identifier-only journal of request IDs and user/organization/facility/lead/action identifiers in sessionStorage. Do not cache action text, notes, names or other PHI. On reload, look up that receipt under current authority. If absent, show Save not confirmed; never resend changed form data under the old UUID. This is uncertain-result recovery, not offline draft persistence. A confirmed result clears only its own recovery identifier; older uncertain attempts remain recoverable. A definite SQL rejection retires only that rejected attempt. stale/denied writes retain draft and expose conflict. Session-storage failure must not falsely claim reload recovery.

Referral hub adds scoped indicators/filter for missing action, unacknowledged owner, explicit overdue date and unavailable owner; show accepted backup coverage separately. Waiting without a date is not overdue. Completed/lost/converted stage rules remain unchanged; unresolved actions remain accessible after conversion/loss.

## Required evidence

Create due/waiting validation; exact duplicate versus conflicting request; competing creates; stale updates/complete; self-only acceptance; reassignment invalidates acceptance; backup survives owner deactivation; evidence-required completion; rollback on receipt failure; actor/candidate revocation while waiting; denied cross-scope read/write; uncertain successful response then reload; no-receipt result; conversion/loss preserves unresolved work; merge/delete/scope guards; normal notes/tour save unaffected. Run rendered tests, local HTTP/browser workflow, native SQL and concurrent authorization probes, independent review and strict UI segment gate.


## Implementation limits

Eligibility means current account/facility authority, not staffing schedule or physical availability. Accepted coverage is an explicit action record; it does not approve a staffing plan. Read access for completed work remains available after conversion/loss while the lead remains in scope. After a closed lead is moved or deleted, ordinary APIs fail closed; privileged archived retrieval is separate follow-on work. Browser recovery stores identifiers only, not draft text or an offline command queue. Lead roster pagination removes default caps but offset pages are not a transactional cutoff under concurrent edits. Existing admissions handoff classifications and export limits are unchanged.

Business conflicts use `PT409`, not PostgreSQL serialization failure `40001`: actual PostgREST 14.4 verification reproduced repeated retries of deterministic stale versions. Migration 338 forward-corrects three such error sites in earlier import/return functions without modifying migrations 335/336. See [PostgREST custom errors](https://docs.postgrest.org/en/v14/references/errors.html#raise-errors-with-http-status-codes) and [upstream retry issue](https://github.com/PostgREST/postgrest/issues/3673).
