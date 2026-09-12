# Facility operations corrections, reversals and bound reviews — COL-145

Status: PARTIAL — HFO-08 foundation. September 10, 2026. Extends the [receipts](27-facility-operations-receipts.md) and [evidence](27-facility-operations-evidence.md) contracts under BUILD-SCOPE section 5 ("Correction chain", "Review", "Correct work", "Record review") and section 7 ("Corrections cannot alter the immutable recorder/server timestamp"). Source implementation only: it corrects no real work, reverses nothing and establishes no hosted or operating acceptance. Built under the owner's limited dependency exception against the reviewed COL-143 interface while COL-143's hosted Storage proof stays open.

## A correction is a new receipt, never an edit

`correct_operation_work_review` appends a new performance receipt that supersedes the current effective one: it carries the corrected statement of the work in full (the same fields a recording carries), the correction reason, the exact receipt it corrects and the expected revision of that receipt. The corrected receipt stays verbatim; only its `superseded_by_receipt_id` and `superseded_at` are set, once, under the owner-secret token, and the guard pairs the two rows structurally. Receipts of one act of work share a `chain_id`; a correction extends the chain (`correction_seq`), and the original performer, performed-at and recorded-at stay where they were recorded. The corrector is the new receipt's recorder and states the performer explicitly when it is someone else, exactly as a recording would; a correction that omits `performed_at` keeps the instant it corrects. The late rule for a correction is anchored on the chain root's recording instant, and a corrected performed time can never follow that recording.

Conflicts are explicit: a stale expected receipt or revision, a second correction of a superseded receipt, or a concurrent correction that lost the occurrence lock returns `Receipt changed since it was read` naming the current receipt and its revision, never last-write-wins. Replays by request key return the one correction.

## Evidence follows the chain; a reversal ends it

Finalized evidence counts for every receipt in its chain, so a correction of a note or a value does not demand a new upload; a correction whose outcome changes which evidence rules apply is re-evaluated against the chain, may be `complete` at insert, and otherwise leaves the occurrence `performed_missing_evidence`. An upload in flight during a correction cannot finalize onto the superseded receipt (COL-143 refuses it) and is re-prepared against the effective receipt.

`reverse_operation_work_review` appends a `reversal` receipt with a reason: the effective performance receipt and its review are superseded, the occurrence returns to unrecorded (`execution_state='none'`, every completion mirror cleared, `pending` or `missed` by its deadline, `missed_at` set when missed), and a later recording starts a new chain for which the reversed chain's evidence counts for nothing. A reversal is never corrected or reversed.

## Review is bound to the exact receipt it reviewed

A verification receipt now records `verifies_receipt_id` and `verified_receipt_revision`; the verify command accepts the receipt id and revision the reviewer read and conflicts when the effective receipt has moved. When the reviewed receipt is corrected, the review is superseded with it and the occurrence visibly awaits review again whenever the rule requires review. Independence is judged against the effective receipt: the reviewer is neither its recorder nor its named performer.

## Legacy writers are refused, not translated

Every reachable legacy mutation of a managed occurrence was inventoried before this work (`docs/facility-operations/col145-evidence/legacy-writers.md`): legacy complete, defer, reinstate and escalate are refused for managed rows, bulk completion and meeting-action creation are revoked from every role, the meeting-to-task synchronisation refuses a linked managed task, and service-role or session updates of performance columns, status or removal are refused by the occurrence guard. The ordinary start transition stays. The probe re-proves each refusal with no partial write, proves a forced audit-insert failure leaves receipts and occurrence untouched, and proves that no generic reset, delete or truncate can erase prior completion history. The legacy routes now answer managed rows with the trusted refusal as a 409.

## API

`POST /api/admin/operations/occurrences/[id]/correct` (`request_key`, `expected_receipt_id`, `expected_receipt_revision`, payload = record payload plus `reason`), `POST …/[id]/reverse` (payload `{ reason }`), `POST …/[id]/verify` (payload gains required `receipt_id` and `receipt_revision`), `GET …/[id]/receipts` (the whole history: recordings, corrections, reversals and reviews, with chain and supersession columns, ordered by recorded time then id). A conflict carries `current_receipt_id` and `current_receipt_revision`.

## Verification

1. `npm test -- src/app/api/admin/operations src/lib/operations`
2. `npm run typecheck`; `npm run lint`; `npm run segment:gates -- --segment COL-145-HFO-CORRECTIONS`
3. Native replay executes `supabase/tests/review_hfo_corrections.sql` (174 assertions) and `scripts/facility-operations/test-correction-concurrency.py` observes two corrections with the same expected revision, a correction racing an evidence finalization and a correction racing a verification, in both orders, on the run-owned PostgreSQL 17 cluster.

## Migration and rollback

`344_hfo_corrections.sql` (provisional number) follows this branch's unapplied 336–343, replaces in place the 343 receipt guard, `operation_evidence_rule_met` (chain counting), `record_operation_work` (on the shared statement helper; behaviour unchanged, proven by the unchanged 341 probe and a cross-version replay-hash experiment) and `verify_operation_work` (binding), and widens the audit event-type check with `corrected` and `reversed`. The supersession foreign key is deferrable so the corrected receipt can be superseded before its correction row exists; each command ends its window with `SET CONSTRAINTS … IMMEDIATE` inside the same call. Numbers are branch-local; integrate after COL-143 in the recorded Finance-first order and re-read the hosted ledger before assigning final numbers. Before application, rollback is reverting this segment. After application, drop the two commands, their wrappers and helpers, restore the four replaced bodies and the event-type check; the receipt columns are additive.

Open: Q10 (what counts as done) and Q29 (correction rights and urgency). Engineering policies recorded for confirmation in `docs/facility-operations/OWNER-DECISIONS.md` (3g). Mission alignment: PASS for the bounded foundation. Operating readiness: RISK.
