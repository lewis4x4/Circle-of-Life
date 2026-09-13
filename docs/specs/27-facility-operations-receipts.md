# Facility operations execution receipts — COL-142

Status: PARTIAL — HFO-06 foundation. September 10, 2026. Extends the [catalog](27-facility-operations-catalog.md), [current authority](27-facility-operations-authority.md), [applicability](27-facility-operations-applicability.md), [evaluator](27-facility-operations-evaluator.md) and [occurrences](27-facility-operations-occurrences.md) contracts under BUILD-SCOPE section 5 ("Execution receipt", "Command receipt", "Record work"). This is source implementation: it records no real work, verifies no real occurrence, creates no real issue and establishes no hosted or operating acceptance.

## One click, one attributable fact

`operation_execution_receipts` is the immutable record of one act on one managed occurrence. A **performance** receipt records the work; a **verification** receipt records the independent review a rule requires. The recorder is the authenticated server identity, never a caller-supplied id; `recorded_at` is the server clock at acceptance; `performed_at` is the recorder's statement of when the work was done, defaults to now, is stored separately and can never be in the future. The performer defaults to the recorder; `other_staff` (a current member of the site), `vendor` (a vendor linked to the site) and `unknown_historical` (a label) are explicit, and every non-routine entry (`late`, `on_behalf`) carries a reason. A saved receipt is the only evidence of server acceptance.

Each receipt carries a client request key and a server-computed content fingerprint. The same key with the same content returns the one existing receipt (`replayed: true`); the same key with different content is a conflict; a different key against an occurrence that already holds an effective performance receipt is a conflict that names the current receipt. One occurrence has one effective performance receipt and at most one effective verification receipt (partial unique indexes); the record command locks the occurrence and the actor's authority rows first, so two differing concurrent attempts serialise and the loser sees the winner instead of overwriting it. Corrections and supersession are HFO-08; the receipt keeps a `revision` fingerprint for them.

## What a receipt can and cannot claim

The outcome is `performed`, `failed` (an issue is created atomically) or `not_performed` (a reason is required). Recorded `values` are validated against the governing inputs (the site's local inputs when set, else the central version's) with the same key, type, choice and range rules the versions were published with; unknown keys are refused. Required evidence rules that apply to the outcome (`always`, `on_success` for performed, `on_failure` for failed) are listed on the receipt as `missing_evidence` when unmet. Before COL-143 supplies verified evidence, every such rule is unmet, so an evidence-requiring activity records truthfully as `performed_missing_evidence` and its occurrence stays `in_progress`; nothing here reports it complete.

Completion state is computed by the server and mirrored on the occurrence (`execution_state`): `completed` only when the outcome is performed, no required evidence is missing and either no review is required or the verification receipt exists; `awaiting_verification` when the central version requires review; `performed_missing_evidence`; `failed`; `not_performed`. Only `completed` moves the occurrence's status to `completed`; every other state leaves it `in_progress` with the reason visible. `sla_met` compares the performed instant with the grace end or deadline. The legacy dual-sign columns are mirrored (performance → `signed_by`; verification → `second_sign_by`, `verified_by`) so existing views keep reading, and `completed_at` is the recorded instant of the receipt that completed the occurrence, distinct from `performed_at`.

Verification requires a reviewer role from the central version and independence (the reviewer is neither the performance recorder nor the named performer); it re-evaluates evidence and refuses while required evidence is missing, and refuses a cancelled or removed occurrence. An occurrence that carries recorded work can no longer be cancelled; changing recorded work is a correction (HFO-08).

Who may record is the published recorder list (the site's local list when set, else the central version's), checked together with the COL-133 site grant, subject scope and `can_record` under the same locks as every other command. The legacy queue hint `assigned_role` does not gate recording on managed occurrences. The replay lookup runs before any clock- or authority-drift-sensitive validation, so an exact replay of an accepted request returns the same receipt even after the performer's access changed or the late-entry window passed.

## Issues

`operation_issues` is the minimal corrective-work identity this issue owns: kind (`problem`, `help_request`, `failed_result`), summary, severity, subject scope, optional occurrence and receipt links, reporter and time, idempotent by request key, `open` only. Staff can report a problem or ask for help without pretending the work was performed: `report_operation_issue_review` changes no occurrence state. A report linked to a managed occurrence is gated on that occurrence's published recorder list under the same work-authority lock as recording, and refuses legacy tasks; a report scoped to an activity, site and subject needs only current subject authority. Assignment, waiting, resolution and reopening are HFO-14.

## Legacy paths

Legacy rows keep the legacy completion command; a managed occurrence refuses it (`Managed occurrences are recorded through the receipt command`) and is completed only through the receipt commands. The occurrence identity guard now also holds the execution and completion columns of managed rows to the commands (the `start` transition stays available), so neither the service identity nor a session can complete a managed row by direct update. Bulk completion stays closed.

## API

`POST /api/admin/operations/occurrences/[id]/record`, `POST …/[id]/verify`, `GET …/[id]/receipts`, `POST /api/admin/operations/issues`, `GET /api/admin/operations/issues?facility_id`. Every response names its server-authoritative outcome class (`receipt`, `validation`, `denied`, `missing`, `conflict`, `uncertain`) so a client never infers success from an HTTP status alone; a conflict carries the current receipt id when the database supplies it.

## Verification

1. `npm test -- src/app/api/admin/operations src/app/api/admin/meetings src/lib/operations src/lib/admin/operations src/lib/auth/current-api-actor.test.ts`
2. `npm run typecheck`; `npm run lint`; `npm run segment:gates -- --segment COL-142-HFO-RECEIPTS --ui`
3. Native replay executes `supabase/tests/review_hfo_execution_receipts.sql` and `scripts/facility-operations/test-receipt-concurrency.py` observes two differing concurrent attempts, two identical concurrent replays and a `can_record` revocation committed during the lock wait on the run-owned PostgreSQL 17 cluster.

## Migration and rollback

`341_hfo_execution_receipts.sql` (provisional number) follows this branch's unapplied 336–340 and replaces in place the 337 bodies of `complete_operation_task_review` (one managed-row refusal) and `guard_operation_current_authority` (one line: an approved occurrence command has already taken the governing authority lock, so the trigger does not repeat the legacy assigned-role lock on a managed update), and the 340 bodies of `guard_operation_occurrence` (execution columns held to the commands) and `cancel_operation_occurrence` (recorded work refuses cancellation). Numbers are branch-local; integrate after COL-139 in the recorded Finance-first order and re-read the hosted ledger before assigning final numbers. Before application, rollback is reverting this segment. After application, drop the two new tables, the three commands and `lock_operation_work_authority`, and restore the four replaced bodies; the new instance columns are additive.

Open questions: Q10 (what allows marking an item done) and Q12 (hands-on time) stay open; the outcome vocabulary and the evidence states express the possibilities without choosing a rule for any activity. Engineering policies recorded for confirmation in `docs/facility-operations/OWNER-DECISIONS.md` (3d).

Mission alignment: PASS for the bounded foundation. Operating readiness: RISK pending verified evidence (COL-143), corrections (HFO-08), issue lifecycle (HFO-14), hosted release and Homewood configuration.
