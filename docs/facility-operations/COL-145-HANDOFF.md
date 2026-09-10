# COL-145 — corrections, reversals, bound reviews and legacy write paths

**Implemented, independently reviewed and verified locally on the feature branch as source only.** No hosted migration, deployment, real correction or operating acceptance has occurred. Nothing is merged to `main`.

Worktree: `/Users/brianlewis/Circle of Life/Haven Facility Occurrences`; branch `codex/hfo-col145-corrections`, stacked on COL-143 at `45ea4ea9` (the checksum amendment over `c7b5cc30`). Built under the owner's **limited dependency exception** recorded on the Linear issue: COL-143 stays In Progress with its hosted Storage proof open, and this segment builds against its reviewed interface without marking that acceptance complete.

## Delivered

- Migration `344_hfo_corrections.sql` (provisional): receipt chain, correction and supersession columns, `reversal` kind and `reversed` state, review binding columns; the 343 receipt guard replaced in place with structural pairing of corrected and correcting rows; `operation_evidence_rule_met` counting over the chain; `record_operation_work` replaced on a shared statement helper with behaviour unchanged (341 probe unchanged, cross-version replay-hash experiment); `verify_operation_work` replaced with binding; commands `correct_operation_work_review` and `reverse_operation_work_review` under the owner-secret token and the 341 lock order; audit event types `corrected` and `reversed`.
- Library `src/lib/operations/receipts.ts` (correction, reversal and bound-verify schemas, chain columns, conflict mapping naming the current receipt and revision) and routes `occurrences/[id]/correct`, `…/reverse`, `…/verify` (bound), `…/receipts` (full history); the legacy `defer`, `reinstate` and `complete` routes answer managed rows with the trusted refusal.
- Inventory `col145-evidence/legacy-writers.md` (made before code) and the probe proofs for every legacy path.
- Canonical contract: [corrections](../specs/27-facility-operations-corrections.md). Settled engineering contracts: `col145-evidence/engineering-contracts.md`.

## Acceptance

1. Correction retains original receipt, actor, time, evidence and missed or late facts; a conflicting correction returns a reviewable conflict: probe (corrected receipt byte-identical except `superseded_by_receipt_id`/`superseded_at`; original performer, performed-at and recorded-at unchanged; a finalized photo on the original satisfies the correction; stale revision, wrong id and a second correction of a superseded receipt conflict naming the current receipt and revision) and the race script (two corrections with one expected revision: one winner, the loser conflicts naming the winner).
2. Review is independent of performance and bound to the exact source version: probe (verification carries `verifies_receipt_id` and `verified_receipt_revision`; a stale id or revision conflicts; a correction supersedes the review and the occurrence awaits review again; independence enforced) and the race script (correction racing verification in both orders).
3. All reachable legacy mutation paths reject bypasses; task and audit cannot partially save; a generic reset cannot erase prior completion history: probe (legacy complete, defer, reinstate, escalate refused; bulk and meeting-action creation not executable by any role; meeting-to-task synchronisation refused with both tables unchanged; session and service updates of performance columns, status, removal and generic reset refused with and without the forged setting; DELETE and TRUNCATE refused; forced audit-insert failure leaves receipts, occurrence and issues untouched; the start transition still works and leaves receipts byte-identical).

## Boundaries kept

No UI (COL-148), no substep receipts, no reminder or urgency rule (Q29), no translation of legacy writers. Q10 open. Seven engineering policies listed for confirmation in `OWNER-DECISIONS.md` (3g).

## Evidence

Focused suite, typecheck, lint, native replay of 347 migration files with 28 probes including `review_hfo_corrections.sql` (174 assertions), the race script in five orderings, independent SQL and TypeScript reviews with dispositions and re-verification, strict gate artifact: see [verification](col145-evidence/verification.json) and [review](col145-evidence/independent-review.json). Local PostgreSQL uses Supabase stubs and synthetic fixtures; hosted, browser and staff acceptance are not established.

## Resume and rollback

Next in the stack: COL-146 (`codex/hfo-col146-recovery`, migration 345) then COL-148 (`codex/hfo-col148-workspace`, no migration). Before deployment, rollback is reverting this segment. After application, drop the two commands, their wrappers and helpers, restore the four replaced bodies and the event-type check; the receipt columns are additive. Mission alignment: **PASS** for the bounded foundation; hosted and operating readiness: **RISK**.
