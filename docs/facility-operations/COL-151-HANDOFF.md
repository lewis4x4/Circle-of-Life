# COL-151 complete authorized activity-history export

Mission alignment: **pass**. Isolated branch `codex/hfo-col151-activity-export` starts from COL-150 `dd19b33e`; merge `e9c2ee37` incorporates the separately reviewed inherited CI repairs `196cc1cd` and `de8ed0e9` without rewriting the stack.

## Delivered

Corporate Facility → Activity → History now offers **Download complete CSV**. The server captures a private, immutable requester-scoped database snapshot with one MVCC statement, preserving every authorized occurrence, receipt/correction, evidence reference and readable source event. The manifest records exact facility/activity filters, generation time, database snapshot ID, source coverage and independent totals. The snapshot ID defines the stable source boundary; later changes appear only in a fresh export.

The download buffers and reconciles all immutable pages before returning any file bytes, then rechecks current authorization. Idempotent creation and retry retain the same snapshot. Partial retrieval, changed manifests, revoked access and interrupted responses do not create a completed file. The UI aborts stale downloads when the current person or selection changes. Complete empty history has an explicit manifest and label. CSV formula cells are neutralized. Files remain native protected references; no storage paths or bearer URLs are exported.

Migration365 enables RLS on a private snapshot table, denies direct client/service access, rejects snapshot update/delete/truncate, and records only creation metadata in the audit log. Current facility/activity, task/subject and linked-native source scope are checked on creation, after waits and on every retrieval. No policy, schedule, provider or staff acceptance is activated.

## Verified evidence

- Full suite: **4,500 passed**, two existing skips across623 files.
- Repo typecheck passed. Final strict UI gate passed every required check, including lint/security/build/public preview/axe and **368 migrations/48 SQL probes**.
- Independent `/root/release_preflight` review: **[PROOF PASS — CLEAN]**, all10 implementation hashes verified.
- Three real two-connection cases passed: concurrent correction/new record during snapshot materialization; grant revocation while creation waits; revoked empty-export denial.
- Criterion details and actual failed attempts are retained under `col151-evidence/`; the first strict gate's cluster-global role contention is retained as FAIL and superseded by the serialized final PASS. The original tied-page test assumption was repaired to inspect every page.

## Release boundary and next action

This checkpoint proves local/native engineering delivery. Hosted HTTP proof and main/production release are still pending. Guarded `col151-evidence/apply-staging.py` applies only reviewed364/365 to verified staging, with DDL and ledger in one transaction. The independent-reviewed hosted proof runner creates only fresh synthetic COL151 fixtures and checks real CSV/evidence/auth behavior. Read its README before execution.

Production remains at50bc07c4 with schema through339. Reconciled340–364 includes finance and audit-export write-permission changes; release requires a coordinated compatible frontend/Edge/schema transition, reviewed backup and recovery. Reverting only Netlify to50bc07c4 after340/341 is not a compatible recovery. No production migration or merge is implied by this checkpoint. COL-140 and COL-161 retain separate activation/operating acceptance.

Rollback: before hosted application, revert the bounded source commit. After additive364/365 application, retain immutable exports/audit history and disable/revert the new application route or forward-fix; do not drop retained history. Existing app code can ignore the additive export table. This does not replace the separate340–364 coordinated production recovery plan.

Continue the overnight loop: verify staged HTTP proof, push/PR, satisfy main/release gates or park exact gates and continue next live dependency-ready Haven Delivery. A draft PR or one finished source issue is not the overnight completion condition.
