# Independent clinical safety review

Reviewer: business/office lane, separate from clinical implementation. Scope: new clinical migration, operations completion API boundaries and UI, admission create/arrival API, care-plan approval, med-pass confirmation, caregiver log writes and outbreak helper. Read-only findings sent to clinical owner for correction; no clinical implementation edited by reviewer.

## Blocking findings sent to owner

1. **High — medication slot collision.** `complete_med_pass_review` initially locked only the cockpit pass and inserted another eMAR row, while caregiver recording used a different medication/time lock. No unique medication/time index exists. Both roles could resolve the same intended dose. Require shared canonical slot ownership, reuse scheduled eMAR row and reject already resolved doses. Also validate caller-supplied non-PRN schedule against a real prescribed/generated slot.
2. **High — dual-sign completion could be forged directly.** The new OCE trigger checked two distinct IDs but existing `oti_update` allows assigned actors and broad roles to write signature fields, status and `requires_dual_sign`. Protect those fields/transition through trusted commands; test direct bypass attempts and clearing the requirement flag.
3. **High — care-plan archival was too late.** Migration035 enforces an immediate partial unique active-plan index. The new revision archiver ran AFTER UPDATE, so activation with a prior active plan fails before archival. Archive and activate under one validated, serialized transaction, with rollback proof.
4. **High — existing draft submission mismatch.** Admission creation RPC returned an existing draft unchanged when intent was submit, but the API then emitted pending-clearance events and moved referral status forward. Apply a validated submission transition or reject with explicit existing-draft conflict.
5. **Medium — bulk completion outcome mislabeled.** Bulk RPC returned every task ID, including first signatures awaiting verification; API counted all as `completed_count`. Current UI only reloads, but response semantics need distinct completed/awaiting-verification outcomes.
6. **Medium — SQL NULL validation holes.** NULL care-plan item JSON could bypass minimum-item validation; NULL shift-note text could bypass nonempty validation; NULL pharmacist NPI could bypass regex evidence validation. Reject null/type-invalid payloads explicitly and test each.

## Positive checks and limits

Clinical observation writes use invoker/RLS scope, derive resident/facility from stored resident, append immutable observations and retain partial measurement fields. New clinical table has RLS plus audit trigger. Service-only RPC grants prevent arbitrary browser-supplied actor UUIDs from calling administrative commands; observed server routes derive actor and check resident/facility scope. Vitals UI distinguishes saved observation from failed alert evaluation; medication UI requires a returned durable MAR receipt before success.

This review does not establish hosted parity, legal/clinical acceptance or browser UAT. Clinical owner must record fixes and regression evidence for the findings above; a later review addendum will record verification, not silently replace this initial challenge.
