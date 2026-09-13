# COL-157 finance operations source handoff

## Scope and source truth

The task-bound panel covers 22 source items / 27 components through the canonical map in `col157-evidence/source-map-plan.md`. Explicit site-calendar lookup periods span 1–366 days, independently of any HFO due period or accounting close approval.

Four supported families expose authorized native context:

- Daily census UUID/date/content versions, missing dates and recorded counts. No physical-presence verification, manufactured billable days, census balancing approval or saved approved version.
- Immutable received-payment receipts/allocations with economic date separate from invoice service period and entry time. A linked invoice correction changes the HFO version while preserving the native event version. Reconciliation does not create another payment or collection.
- Canonical trust transactions and current account balances, with legacy entries explicitly separate. Current balance is not a historical opening/closing balance. Manager access to canonical trust does not imply legacy billing access. External reconciliation remains NOT_VERIFIED.
- Native Finance Integration queue/batch metadata: prepared, local approval and invalidation are distinct; dispatch and actual provider acknowledgment remain unavailable. Discovery uses the existing authorized paginated queue, not raw batch-table reads.

HFO stores only source observation/request history. Current native and HFO authority is enforced on direct inserts, retries and after waits. Latest-state deduplication preserves A → B → A; server-owned ordering rejects caller sequence values. Reads are complete within a 5,000-record family bound; overflow fails explicitly. History is retained and the newest 100 observations carry an explicit completeness flag.

## Remaining source and approval gaps

Deposit scans/bank receipt, DCF/SSA/Drive transmissions, accepted payer responsibility, executed family-payer signatures, Medicaid application/authorization finality, mailing acknowledgment, conference confirmation and externally verified income remain explicit gaps. FPC/MCD meaning, secured-payment meaning, current recipients, billable-day policy, trust/EOM approval and first-month full-payment rules are not invented. These gaps block only dependent completion/activation; they do not hide available native context. Native source existence never records administrative performance or verifies another receipt.

## Executed evidence

- Parent full suite: 639 files, 4,636 tests passed, two existing skips. Final focused backend: 14 passed; UI evidence is recorded separately in the evidence directory.
- Actual native rows validated all four families and the shared API schema. Probes cover prior-period payment replay, linked invoice correction, census correction/history, same UUID across canonical/legacy trust, DST boundaries, manager/native-access denial, direct ordering attack, rollback consistency, 101 native batch rows across pages, more than 100 guarded history observations, and 5,001-row overflow refusal.
- Five actual blocked-connection cases passed: same request key, native permission loss, source change, direct-insert capture revocation and history-phase revocation. Native-only denial retained positive HFO task access and rejected stale stronger-scope evidence.
- Mandatory gate passed all 11 required checks: 372 migrations / 52 SQL probes, build, lint, design and axe. `col157-evidence/strict-gate-final.json` is the exact result. All 3,244 source/config/asset/runner hashes matched the pre-start private manifest.

A first synthetic trust fixture correctly failed the existing nonzero-initial-balance guard. A real prepared batch exposed the raw-table read restriction and led to reuse of the native queue. A repeated full-refresh fixture exceeded the 120-second probe budget and was canceled on the exact owned backend; the expensive repeated-read observation is retained, not relabeled as a latency pass. Bounded history population now uses actual capture guards and synthetic source changes before the larger batch set. No native guard, RLS policy, scanner or hash assertion was disabled. Raw logs are privately preserved; committed copies differ only by reviewed trailing whitespace normalization.

## Delivery state

Authenticated staging proof passed on iwcnajanvjvynolltflw. Runtime/migration source remains1dacb3906c83de2502e18fb4e67d076c16e8b4ee9; executed revisionddce23956b4a12facab5cf3cbd2143c16e8b4ee9 changes only the fixture trust insertion to run after real owner login. The first hosted rows transaction failed with zero committed org/profile/site/financial rows; the same two Auth identities were retained. Exact local failure, intermediate replay-stub limitations, successful authenticated rollback proof and audited fixture source/checkpoint transition are preserved. Trust fixture setup uses authenticated native SQL with real issued owner claims and historical occurred_at; it is not claimed as an HTTP cash command.

Actual HFO HTTP proof preserved prior payment economicdate2026-08-04, serviceperiod2026-07-05–2026-08-03 and recordingtime2026-09-13. Missing censusday2026-08-05 stayed explicit. Census A→B→A plus actual local batch prepared→invalidated produced exactly four source transitions; retries did not duplicate history. Canonical trust$5 and legacy$9 were never combined. Scoped native hashes remained unchanged by HFO reads/reconciliation. No native financial performance or provider dispatch was created by HFO.

Both1440/375 actual viewport proofs passed UI refresh/history, axe, page/console/HTTP error checks and horizontal overflow. Twelve viewport images retain top/census/payment/trust/handoff/history. Parent inspected six representative images and accepted legible exact dollars, date axes, trust separation, unavailable acknowledgment and wrapped native references. Scope evidence is the exact task/site/period response binding, not global picker selection.

Positive HFO task access with native finance unavailable, wrongsite404 and revokedsite401 were verified. Exact fixtures are retired: both actors banned/inactive, grants revoked preserving history, sites/org retired; financial/census/source/audit history retained. Owned4357 listener is closed. Actual artifacts and initial failure lineage are in `col157-evidence/hosted-proof/OUTCOMES.md`.

Independent hosted review is `[PROOF PASS — CLEAN]` in `col157-evidence/independent-hosted-review.json`. Exact-head PR/CI→origin/main and applicable production release remain parent-runner obligations. Synthetic staged results do not establish bank clearing, full rent satisfaction, provider, staff, business-cycle or operating-policy acceptance. Controller classifications, reconciliation, recovery and production release gates remain separately routed.
