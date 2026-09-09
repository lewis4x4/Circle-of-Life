# Insurance verified workspace database contract

Migration `336_insurance_verified_workspace.sql` provides CORE intake, review, policy terms and dated schedules, renewal work, and certificate request/storage. It does not issue certificates or send communications.

## Authority

`public.insurance_workspace(p_action text,p_payload jsonb DEFAULT '{}') RETURNS jsonb` is an authenticated SECURITY INVOKER wrapper. Its restricted `haven.insurance_workspace_impl` implementation derives actor, organization and role from `haven.current_authorized_actor()` including live profile/session/version checks. Owner/org_admin manage. Facility admins receive only explicit approved effective facility summaries and their facility certificate/work records. All other roles fail closed.

`public.insurance_processing(p_action text,p_payload jsonb)` and its restricted haven implementation are executable only by service_role. Server supplies `actor_id` and `organization_id` after current request authorization; SQL rechecks active, nondeleted, unbanned owner/org_admin. Browser role cannot invoke processing even with arbitrary flags or actor IDs.

All new tables have RLS enabled and browser DML revoked; overview is the sole read projection. Legacy raw policy, claim/activity, workers comp, renewal/package, loss-run, premium allocation, and COI registers now have restrictive manager-only policies, including their audit snapshots; existing manager workflows remain accessible. An invoker trigger rejects browser insertion/promotion of verified rows and any mutation of approved policies; only the trusted postgres-owned publication function changes them. No user-set GUC enables publication. Immutable version and original-access rows cannot be updated or deleted. A restrictive insurance audit-log policy prevents raw snapshots leaking through the generic facility audit feed. Insurance originals are a private bucket with an explicit restrictive authenticated policy; the manager API streams authorized ready originals and records original access.

## Returns

- `overview {facility_id?,policy_id?,as_of?}` returns complete arrays: `entities`, `facilities`, manager-only `owners:[{id,name}]` limited to active owner/org_admin profiles, `policies`, `documents`, `drafts`, `work_items`, `certificate_requests`, `versions`, manager-only `claims` and `premium_allocations`, plus `can_manage`, `as_of`, `pagination:{complete:true}`. No limit silently truncates rows. Default as-of is the America/New_York business date. Managers see historical schedules; facility projections filter approved schedules by as-of and omit money, other parties, original paths, drafts and history.
- `get_document {id}` returns a direct ready document row and appends immutable access audit. Unavailable/quarantined documents return not found.
- `save_draft {id?,document_id?,kind,policy_id?,expected_version?,revision?,payload,evidence}` returns direct draft row. Kinds are `new_policy`, `verification`, `endorsement`, `renewal`. Partial objects can be saved; editing compares revision. Verification requires the existing legacy term ID/version and preserves that ID and existing lifecycle status after review, including cancelled/expired states. Endorsement requires a verified term, unchanged identity/dates, effective date and preserved prior schedule intervals. New links cannot predate the endorsement; the old and new intervals clipped to the period before that date must match exactly, preventing both removals and backdated extensions.
- `approve_draft {id,revision,confirm_evidence:true}` returns `{policy_id,version}`. It locks the draft and target, checks version, validates evidence and current organization references, publishes all rows/history/work in one transaction, and returns the original receipt on retry. Duplicate verified identities conflict; legacy duplicates require explicit verification. `reject_draft {id,revision,reason}` returns a rejected draft.
- `configure_renewal {policy_id,owner_id,milestone_days}` returns all policy work rows. One to twelve distinct milestones, 1–730 days, are stable by policy/expiration/day. Superseded open work is dismissed with history retained. Explicitly re-adding a system-superseded milestone restores the same task; completed or manually dismissed work remains finalized. Approval creates 120/90/60/30-day reminders assigned to the reviewer. Completed work is retained on rescheduling.
- `update_work_item {id,version,status,owner_id?,due_date?,note?}` returns a row. Status is open/completed/dismissed; completion/dismissal requires a note. Owner is an active current-org owner/org_admin able to access insurance; facility admins may assign only themselves on their own facility certificate request.
- `create_certificate_request {id,entity_id,facility_id?,holder_name,holder_details,requirements,owner_id?,due_date?}` returns a row. Facility admins must use an accessible facility and its entity; they may only assign themselves. `update_certificate_request {id,version,status,document_id?,note?}` is manager-only. Issued requires a ready certificate-family document in the organization and compatible facility. Issued/cancelled requests cannot reopen; these records do not create or bind coverage.

## Facts and evidence

All money remains nullable nonnegative **integer cents, max 2,147,483,647**. No inference turns unknown into zero. Shared-limit is null in incomplete drafts and must be an explicitly reviewed boolean to publish. Root premium is stored once per policy term.

`parties:[{entity_id,role,effective_from,effective_to}]` and `facilities:[{facility_id,role,effective_from,effective_to}]` require explicit intervals inside the term. Primary entity must appear with role `primary_named_insured`. Null end means term expiration.

Optional `coverages:[{coverage_type,occurrence_limit_cents,aggregate_limit_cents,deductible_cents,shared_limit_group}]` stores package lines without per-line premiums. Absent coverage array retains legacy single root policy-type behavior.

Evidence map keys are critical field names, all nonnull money, `shared_limit`, `change_effective_date` for endorsements, and `parties.0`, `facilities.0`, `coverages.0` etc. Every supplied evidence item must be valid. Manual evidence requires reason. Document evidence requires a same-org ready document, positive page and excerpt. Snapshot rows retain immutable evidence plus `before_snapshot`, `snapshot` (direct policy fields with parties/facilities/coverages), `kind`, `change_effective_date`, reviewer and timestamp.

## Trusted processing

- `register_document` receives `{id,actor_id,organization_id,filename,sha256,mime_type,byte_size,family,facility_id?}`. SQL derives `storage_path = organization_id/id`; org/hash deduplicates. Ready originals never overwrite. Families: policy/declarations/endorsement/certificate/renewal/cancellation/nonrenewal/loss_run/other. Urgent notices create assigned same-day work.
- `finish_document {id,actor_id,organization_id,status,scan_status,error?}` requires the exact object to exist for ready and clean/not_configured scan disposition. `not_configured` explicitly means no malware scanner; it is not an AV certification. Already-ready finalization is idempotent.
- `start_extraction {document_id,actor_id,organization_id,run_id}` locks and issues a five-minute lease. `finish_extraction {...,run_id,status,error?,payload?,evidence?}` rejects stale/expired runs, creates one new unapproved draft for review_required, and records recoverable failed/manual_review outcomes. It never alters approved records. SQL allows automatic draft output only for policy/declarations; the server additionally requires configured validated family enablement.
- Direct row returns use `status` uploading/ready/quarantined/failed, `scan_status` not_configured/clean/quarantined/failed, `extraction_status` pending/processing/review_required/failed/manual_review, plus `run_id`, `lease_expires_at`, `error`.

Errors use 28000 authentication, 42501 forbidden, P0002 missing, 40001 stale/conflict, 23505 duplicate, and 22023 invalid. PostgreSQL cast/check errors also represent invalid input.

## Verification

`supabase/tests/review_insurance_workspace.sql` uses disposable rollback fixtures with real current-actor/session checks. It probes publication/idempotency, stale revisions, money limits, duplicate identities, legacy ID-preserving verification, package lines, endorsement history, direct table/GUC bypass attempts, scoped facility summaries/as-of filters, audit/storage isolation, certificate proof and stale edits, extraction run fencing/retry, quarantine, immutable history/access receipts, and live actor revocation. These are database acceptance checks using local Supabase stubs, not hosted authorization or extraction accuracy evidence.
