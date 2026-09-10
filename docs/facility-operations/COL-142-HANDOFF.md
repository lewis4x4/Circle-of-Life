# COL-142 — record work with atomic, idempotent execution receipts

**Implemented, independently reviewed and verified locally on the feature branch; see the evidence for the gate artifact.** No hosted migration, deployment, real work record, real verification, real issue or operating acceptance has occurred. Nothing is merged to `main`.

Worktree: `/Users/brianlewis/Circle of Life/Haven Facility Occurrences`; branch `codex/hfo-col142-receipts`, stacked on COL-139 (`335bd6c7` over `120b7f03`) over COL-137 `caca9592`. COL-132, COL-133, COL-135, COL-137 and COL-139 are Done in Linear as reviewed, gated, unmerged source; COL-142 integrates after COL-139 in the recorded Finance-first order.

## Delivered

- Migration `341_hfo_execution_receipts.sql` (provisional): `operation_execution_receipts` (immutable performance and verification receipts with server recorder and recorded-at, distinct performed-at, explicit performer and entry kind, validated values, unmet-evidence list, server-computed completion state, request key and fingerprint, revision for HFO-08), `operation_issues` (minimal `open` issue identity for HFO-14), occurrence columns `effective_receipt_id`, `verification_receipt_id`, `performed_at`, `execution_state`; commands `record_operation_work_review`, `verify_operation_work_review`, `report_operation_issue_review` on a work-authority lock (`haven.lock_operation_work_authority`: the COL-133 locks and checks with the published recorder or reviewer list as the role gate instead of the legacy assigned role); the 337 legacy completion body kept verbatim with one managed-row refusal and the 337 authority guard with one line (no repeated legacy lock under an approved command); the 340 identity guard extended so completion columns of managed rows change only through the commands, and the 340 cancel command refusing recorded work.
- Library `src/lib/operations/receipts.ts` and routes `occurrences/[id]/record`, `occurrences/[id]/verify`, `occurrences/[id]/receipts`, `issues`, each returning a server-authoritative outcome class.
- Canonical contract: [receipts](../specs/27-facility-operations-receipts.md). Settled engineering contracts: `col142-evidence/engineering-contracts.md`.

## Acceptance

1. Same key/content returns one authorized receipt; changed content conflicts; concurrent differing attempts cannot silently overwrite: probe (replay returns the same receipt even after the performer's access or the late-entry window changed; changed content and a second key conflict naming the current receipt) and the race script (two differing attempts, two identical replays, a revoked recorder, two reviewers).
2. Performed-at and recorded-at remain distinct; future performance rejects; another performer or unknown historical actor is explicit: probe (future time refused; older-than-fifteen-minutes work requires a late entry with a reason for every entry kind; other staff, vendor and unknown-historical performers explicit and validated).
3. Execution, occurrence state, issue linkage, audit and receipt commit atomically or roll back; incomplete required evidence cannot return fully completed: probe (failed outcome without an issue refused, with an issue created in the same transaction; evidence-requiring activity records as performed-with-missing-evidence and never completes; review-required work awaits an independent verifier; recorded work cannot be cancelled and a cancelled occurrence cannot be verified; no direct DML by service or session completes a managed row).

## Boundaries kept

Verified evidence is COL-143 (until then every evidence-requiring activity records as performed with missing evidence); corrections and supersession HFO-08; issue lifecycle HFO-14; staff workspace HFO-10. Issue reports linked to a managed occurrence are gated on its published recorder list and refuse legacy tasks. Q10 and Q12 stay open. Seven engineering policies are listed for confirmation in `OWNER-DECISIONS.md` (3d).

## Evidence

Focused suite, typecheck, lint, native replay of 344 migration files with 25 probes including `review_hfo_execution_receipts.sql`, the four-case race script, independent SQL and TypeScript reviews with dispositions and the SQL re-verification, strict gate artifact: see [verification](col142-evidence/verification.json) and [review](col142-evidence/independent-review.json). Local PostgreSQL uses Supabase stubs and synthetic fixtures; hosted Auth, browser and staff acceptance are not established.

## Resume and rollback

Next dependency-ready issues after this closes: check live Linear (COL-147 needs COL-145 too; COL-143 / HFO-07 needs HFO-05 and HFO-06). Before deployment, rollback is reverting this segment. After application, drop the two new tables, the three commands and the work-authority lock, and restore the four replaced bodies (337 `complete_operation_task_review` and `guard_operation_current_authority`; 340 `guard_operation_occurrence` and `cancel_operation_occurrence`); the instance columns are additive. Mission alignment: **PASS**; hosted and operating readiness: **RISK**.
