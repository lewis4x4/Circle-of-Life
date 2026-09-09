# Insurance servicing database contract

Migration 337 adds five restricted, human-reviewed workflows without sending external messages or modifying clinical incidents, canonical claims, or payroll source records.

## Commands and authority

`public.insurance_servicing(p_action text,p_payload jsonb DEFAULT '{}') RETURNS jsonb` is a SECURITY INVOKER wrapper over a restricted postgres-owned implementation. Every call resolves the current authorized session/profile/version and requires owner/org_admin. No caller organization or actor scope is accepted. Direct table access is revoked from browser and service roles; RLS remains enabled. Immutable version and export records reject update/delete. The core restrictive insurance audit boundary also covers these tables.

`list {kind?}` returns complete arrays `records`, `entities`, `facilities`, `policies`, `documents`, `vendors`, `contracts`, `owners`, plus `loss_totals` and `pagination:{complete:true}`. Each record includes ordered `versions`. Minimal choice rows use `{id,name}`; facilities include entity_id, policies include entity_id/policy_number/carrier_name/policy_type/verification_status/version, contracts use `{id,vendor_id,title}`. Only ready accepted-scan documents are choices. Owners are active current-org owner/org_admin users. No silent row limit.

`save {id,version?,kind,title,entity_id,facility_id,policy_id,document_id,owner_id,due_date,payload}` returns `{record}`. ID is a stable UUID. Same initial ID/content retry returns the existing record; conflicting content or stale versions fail. Updates require draft/review_required and exact version. Partial domain fields may be empty/null in drafts, but base identity and every supplied reference must be valid. Payload keys and row keys are strictly bounded in SQL, including aggregate-only workforce rows. Money is nullable nonnegative integer cents, maximum 2,147,483,647 per field.

`transition {id,version,status,note?,recipient?,acknowledgment?,reported_date?}` returns `{record}`. A retry with the same preceding version and identical transition details returns the original current state. Different details conflict. Approved payload never changes: sharing and acknowledgment details live in `event_metadata`; every event is also retained with the full record snapshot in `insurance_servicing_versions`.

`revise {id,version,new_id}` creates a fresh draft linked by `source_record_id`, preserving the finalized source. Non-loss finalized records, including rejected records, may be revised. Loss reports require an active approved predecessor; source identity and valuation must remain identical at correction approval.

`export {id,version}` returns `{record:<exact immutable snapshot>,version}` only for stored approved/shared/acknowledged renewal-package versions. It appends an immutable `insurance_servicing_exports` record and audit event without changing content, version, status, or claiming a handoff occurred.

## Link integrity and lifecycle

Every save and transition checks same-organization, nondeleted entity, policy, facility, source documents, qualified owner, vendor/contract, and incident links. A policy must belong to the selected primary insured or an explicit approved policy party. A facility must belong to the selected entity or be explicitly linked to that policy. Facility-scoped originals must match the record facility, or belong to its insured entity/policy when the record is group-scoped. Incident links require the record's exact facility. Linked rows are locked through mutations to avoid a concurrent soft deletion between validation and publication.

- **Renewal package:** draft → review_required → approved → shared → acknowledged. Draft/review_required may be rejected. Save generates a policy snapshot from the verified policy, ignoring caller snapshot contents; approval compares current policy version again under a lock. Changing a term requires saving/refeshing the draft. Approval requires period and recipient. Shared requires matching approved recipient and operator note; acknowledgment requires the same recipient and recorded evidence. It never sends a message.
- **Vendor evidence:** draft → review_required → approved / exception_approved / rejected. Requires a ready certificate, vendor/contract match, requirements, assessment, expiration and an explicit endorsement requirement. Approval of a required endorsement needs a separate ready policy/endorsement document and page. An exception requires an explicit reason; it is not normal approval or an inferred compliance state.
- **Loss report:** draft → review_required → approved / rejected. Requires source, carrier, valuation, period, coverage line and explicit completeness. Claim references are unique after case/space normalization, with evidence pages. Empty reports require confirmed no-loss statement and page. Reports preserve unknown amounts. Same document/valuation cannot be independently approved twice; same claim identity/valuation conflicts even in another source document.
- **Claim matter:** draft → review_required → approved → shared → acknowledged → closed. Incident links are manual and scope-checked. Sharing needs recipient/note; acknowledgment needs matching recipient, evidence and reported_date. Closing needs a completion note. The approved description and original reported-date field remain unchanged while subsequent reporting events are recorded separately.
- **Workforce exposure:** draft → review_required → approved / rejected. Requires period, nonempty distinct state/class rows, basis notes, explicit broker mapping confirmation and a ready source or manual source reason. No employee identity or medical keys are accepted. Actual and estimated payroll stay separate.

Prepared directory labels are captured in top-level `display_names:{entity,facility,vendor,contract,owner}` on draft save; inapplicable labels are null. Callers cannot supply this field. The package policy snapshot includes `entity_name`, party `entity_name`, and facility `facility_name`. These are directory labels recorded at preparation, not quoted legal wording from a source. Approval freezes labels with content, and versioned exports never look up current directory names. Revise copies the previous prepared labels; saving that new draft refreshes them.

All state changes create permanent versions. Organization-scoped advisory serialization and row locks make loss approval/correction authority atomic. A correction locks its approved direct predecessor, rejects already superseded sources, retains the same entity/policy/document/carrier/coverage/valuation identity, and records `superseded_by` plus a new immutable predecessor event. Only one correction can win; approved payload/history remain intact.

## Carrier totals

Authoritative reports are approved, nondeleted and nonsuperseded. Each claim key is organization + entity + normalized carrier + policy (nullable) + normalized coverage line + normalized claim reference. Totals select the newest valuation for each key; corrected same-valuation authority replaces its predecessor.

`loss_totals` includes `claim_count`, `report_count`, `history_complete`, and metrics `paid_cents`, `reserve_cents`, `recovery_cents`, `expense_cents`, `incurred_cents`. Each metric is `{known_subtotal_cents,missing_count,total_cents}`. Total is null if any selected claim amount is unknown, or no report has been approved. No-loss-only approved history can yield zero with explicit evidence. Period completeness remains a separate flag. These are carrier-reported amounts, never computed client-retained costs.

## Legacy preservation and evidence

A narrow legacy renewal_data_packages trigger clears narrative review/publication actor/timestamps whenever payload or narrative draft changes. Existing records remain readable to insurance managers; changed content cannot retain an old approval receipt.

`supabase/tests/review_insurance_servicing.sql` is a rollback-only local probe using real current actor/session helpers. It exercises all five kinds, stale/idempotent commands, current policy snapshots, foreign sources and mismatched policy/entity/vendor/incident links, independent endorsement evidence and exceptions, aggregate workforce rules, loss duplicate keys/valuations and supersession, unknown totals, payload/event separation, immutable history, exact audited exports, role restrictions and live revocation, and legacy approval invalidation. Local PostgreSQL/Supabase stubs do not constitute hosted acceptance or broker/customer approval.
