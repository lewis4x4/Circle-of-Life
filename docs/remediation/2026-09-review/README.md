# Haven review remediation

**Deployment update, 7 September 2026:** SYS-001 and its routed facility-revocation overlap are merged to main in PR #453. Haven's database is through 329 with the exact token/pre-request hooks enabled. Production application commit 99f40096 and all37 real selected Edge Functions deployed; the scheduled lifecycle worker executed naturally. Hosted current-owner access and revoked-session rejection passed in the application/Data API/Edge boundary. See [production verification](production-release-verification.json) and [current closeout](SYS-001-RESUMED-CLOSEOUT.md). The remaining independent-review roadmap and clinical/customer UAT are not declared complete.

The sections below retain the original 6 September baseline evidence; their source-only deployment statements describe that earlier checkpoint.

The 119 indexed review entries are accounted for: **117 corrected in source (including five locally verified access boundaries), two explicitly mitigated**. Production has not been deployed or populated by this work. Authenticated operational UAT remains open.

## What changed

- Database-enforced profile/grant/signature boundaries; isolated credential verification; protected admission patches and scoped, transactional Grace execution/undo.
- Real medication and tray receipts, manual temperature logging, preserved ADL/vital/note drafts, repeated PRN handling, clinical order/plan authoring and signature-aware operations completion.
- Atomic journal/cash/training/collection operations; complete payroll inputs; consistent dietary fields and preserved medication revisions.
- Durable meeting follow-ups, versioned workspace writes, team creation, accessible required reading and recoverable document Trash.
- Restored operational pages **and their provider layouts**; role-filtered navigation, Today work first, literal status labels, correct cents/calendar dates and resident/facility context.
- Operator-owned offline Outbox with retained conflicts, serialized onboarding saves and actual scheduled-report output/history with calendar recurrence.
- Removed simulated completion, fabricated saved-view receipts, inactive controls and unused imports. Patched transitive security advisories without new direct dependencies.

## Evidence

The post-review SYS-001 hardening is split into the database authority proof in [SYS-001-DATABASE-AUTHORIZATION.md](SYS-001-DATABASE-AUTHORIZATION.md), the general user-derived Next/service-role route proof in [SYS-001B-NEXT-AUTHORIZATION.md](SYS-001B-NEXT-AUTHORIZATION.md), the fourteen-route rounding boundary in [SYS-001C-ROUNDING-AUTHORIZATION.md](SYS-001C-ROUNDING-AUTHORIZATION.md), and the mapped user Edge boundary in [SYS-001D-EDGE-AUTHORIZATION.md](SYS-001D-EDGE-AUTHORIZATION.md). All remain source-only until the matched migration, application build, and changed Edge Functions pass their hosted signed-token checks.

The current integrated release candidate passed the canonical UI-inclusive gate `test-results/agent-gates/2026-09-06T22-51-06-713Z-REVIEW-LIVE-MERGE-20260906.json`. Required hygiene, tracked-secret scanning, dependency audit, gitleaks, lint, migration sequence, production build, stress, design-review, and accessibility checks passed. Design review covered **4 screenshots**; axe covered **1 route**. Full Vitest also passed **3,026 tests across 500 files**, with **2 skipped**, **0 failed**, in **67.19 seconds**; its source-map warning was nonfatal. The canonical gate's Docker migration replay was optional and returned a successful **SKIP** because Docker was unavailable; it is not the database proof.

The earlier non-UI PASS remains prior evidence at `test-results/agent-gates/2026-09-06T22-32-04-029Z-REVIEW-MERGE-20260906.json`.

A separate required native PostgreSQL 17 replay passed all **328 migration files and 10 SQL probes** through a repository run-owned socket path. The scratch cluster was stopped and cleaned after proof. The integrated tree is numbered **`001`–`325`**; the hosted ledger is recorded through **`318`**, and remediation migrations **`319`–`325`** remain pending. Authenticated operational UAT remains separate from the passing UI checks above.

- [Every finding and its evidence](findings.json)
- [Independent final review](FINAL-INDEPENDENT-VERIFICATION.md)
- [Independent clinical challenge and corrections](CLINICAL-INDEPENDENT-REVIEW.md)
- [Independent access/data-integrity challenge](INDEPENDENT-ROOT-REVIEW.md)
- [Report deployment requirements](REPORTING-OPERATIONS.md)

## Two deliberately gated workflows

**B-12: Schedule publication.** Draft assignments and exports work. Publishing awaits the approved RN/LPN minimums or exemptions for each facility/shift, eligible roles counted toward care-staffing ratios, and required-credential mappings. Existing ratios/rest/hour limits were found; these three policy inputs were not. The question is pending with the owner.

**C25: Executable compliance presets.** Unimplemented presets are disabled configuration drafts and cannot masquerade as enabled checks. A verified runnable preset catalog is not delivered. Custom configured checks remain available.

The seven remediation migrations are numbered **`319`–`325`** and replay in ordinary repository order. Migration **`326`** is the next free numbered version. See [migration ordering](MIGRATION-ORDER.md).

## Before operational use

Deploy the new migrations, application, and changed Edge Functions together in a controlled rollout. Configure the report worker URL/shared secret. Reconcile existing payroll exceptions, conflicting legacy dietary data, historical financial balances and older acknowledgment requirements as described in the lane ledgers. No clinical/financial historical records were rewritten here.

Exercise the real roles and facility boundaries, failed-save/retry paths, two-person handoffs and post-refresh receipts in an approved environment. Existing customer/clinical acceptance requirements remain in force.

## Branch and existing work

The operational branch is `codex/haven-review-remediation-20260906`, in the sibling `Haven Remediation 2026-09-06` worktree. The release candidate now includes the reconciled public-site and root layout/configuration changes; the current production build covers them. No production deployment is implied by the integrated PASS or branch publication.
