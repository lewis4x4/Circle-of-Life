# COL-715 verification and release boundary

## Implemented scope

- Existing Workforce navigation now groups Today, Schedule, Timecards, Payroll and People. Secondary ledger, training, certification and directory routes remain reachable.
- Today compares published schedules with the recorded kiosk state. Empty, failed, disabled and unconfigured states remain distinct.
- Schedule has the people/week grid, configured shifts, bulk save, copy previous week and publish. Database guards enforce scope, publication stamps, immutable published plans, overlap handling and audited swap/call-out coverage.
- Timecards reads a completed Monday workweek on the server, includes Sunday carry-in, retains archived schedule history, and identifies incomplete punch time. No payroll approval or ADP claim is made.
- People reads the employee-file assessment engine, upcoming published shifts, recorded hours and dated requirements. It does not infer medical clearance or fabricate visiting-staff due dates.
- Legacy time records reject self-approval/pay/scope forgery; Manager staff scope follows Brian's dated COL-571 decision. This is not a claim of complete platform-wide role parity.

## Current integrated evidence

The current source fixes all eight review findings: assignment ID/care-metadata preservation; original-plan copy without call-out replacements; reviewable completed long shifts; bounded correction-read concurrency; exact workweek navigation; recorded historical scheduled hours; outstanding employee-file deadlines; and the unsaved-grid route-leave guard. The additional SQL lock-order repair returns `55P03` for retry without a partial mutation. The shared navigation follow-up prevents duplicate confirmation prompts.

**The full canonical local gate passed:** `test-results/agent-gates/2026-09-24T03-11-49-296Z-COL-715-WORKFORCE-INTEGRATED.json`. Its summary is 13 passed, zero failed and one skipped check; the skipped secondary `apps/web` build is not applicable to this repository layout.

- Native PostgreSQL: **501 migration files, 119 SQL probes, seven acceptance suites and 105 care-event parity cases passed.**
- Native publisher contract proof: **6,687 synthetic bytes**, exact scoped HMAC accepted, with five units, two people, three assignments, two roles and zero reporting assertions. No roster was transferred.
- Package-manager/environment hygiene, tracked-secret and Gitleaks scans, dependency audit, repository lint, migration sequence, root build and stress checks passed.
- Design review passed with **four screenshots**; axe passed for **one route**. These local preview checks do not establish hosted authentication or staff acceptance.
- Observation-task-generator: **10 focused tests and the full 50-test Edge suite passed.** The before-fix run reproduced three failures; alert resolution now follows successful cadence writes and unowned-assignment repair. The current-owner handoff-grace case also passes.
- Canonical typecheck passed. Five earlier CI failures were repaired, with **88 focused guard tests plus component checks** passing. Earlier focused evidence includes 108 tests across 15 suites and nine shared route-leave tests; these counts are separate proof points, not an additive total.
- Direct-write concurrency proof passed: a conflicting direct edit receives `55P03` without a partial write, the bulk RPC commits, and a later retry succeeds.

The subsequent native replay **passed 504 migration files, 122 SQL probes, seven acceptance suites and 105 care-event parity cases**, including the already-hosted family migration 499, onboarding migration 500, and Workforce policy migration 501. The SQL policy scanner failed before migration 501 and passed after it; a behavior probe failed against the old hardcoded cutoff and passed with the configurable setting. Local bundle checks passed at 448.9 kB for `/admin` and 449.4 kB for `/admin/executive` under the unchanged 450 kB cap. Staging has 496–498 and 501, and its migration ledger is complete. Production has 494/495 and the independent 499/500 migrations. Current-base required PR CI, merge and post-merge CI, production migration/application/function deployment, and hosted readback remain **not yet completed**.

## Historical evidence before the review fixes

The following evidence belongs to the earlier source snapshot recorded in `evidence/verification.json`. It is retained for history and does not prove the current migration 497 tree:

- Initial focused run: 419 tests across 20 suites passed.
- Current-base integration: 58 tests across nine suites passed; separate source-scope/identity/race checks also passed.
- Full typecheck and repository lint passed. Ten loader regressions also cover unresolved employee identity, so hidden/missing staff metadata cannot silently become a zero attendance count.
- Standalone Next application build passed, including the new routes. This does not override the failing release sequence gate.
- Twelve desktop/tablet/phone screenshots and three axe route checks passed against production Workforce components/CSS with labelled synthetic source responses. An additional Schedule browser proof passed cell cycling, configured-time save/readback, publication/read-only state and phone scrolling; both additional captures have zero axe violations. These are not hosted authentication or staff acceptance.
- Expanded schedule SQL proof passed publication, direct/legacy writes, scope, swap atomicity, and Home compatibility. Two concurrent writers serialized; the second overlap was rejected and one assignment persisted.
- The earlier native PostgreSQL replay passed: **486 migration files, 113 SQL probes, all seven Smart Rounding acceptance suites, and 105 care-event parity cases**. That command exited 0.

## Prerequisite integration and remaining release work

The branch incorporates main through migration 493 and now has a verified source sequence through 501. It needs current-base required CI before merge. The pinned import receipt covers 22 files; its sanitized copy is `evidence/prerequisite-provenance.json`.

| Migration(s) | Source and integration boundary |
|---|---|
| 483–489 | Existing main history integrated, including approved sequence placeholders |
| 490–493 | Exact reviewed schema and required probe imports; unrelated application work from the original PRs was not copied |
| 494–495 | Original `af7193f9` migration bytes and identities preserved; matching observation generator included; separate floor application excluded |
| 496 | Exact `4ea46b88` disabled database/cron scaffold, two canonical contract files and native proof helpers only |
| 497 | Workforce in-place delivery |
| 498 | Forward reconciliation from `c26af4a7`, SHA-256 `b46e8c2dc96a0c0ee1b4f7144fb85361bea84f923d00be85a006834a1165131b` |
| 499 | Exact already-hosted family invoice RLS migration and probe from PR #863; original PR retains its remaining application scope |
| 500 | Exact already-hosted onboarding manual sign-off migration and probe from PR #868; remaining application work stays with that PR |
| 501 | Configurable rounding owner clock evidence age, default 960 minutes; original 495 stays unchanged |

The forward reconciliation passed independent review after an ACL omission was repaired. All nine function definitions and their owner ACL/comment contracts match the canonical source. Six private helpers deny PUBLIC/anon/authenticated/service-role execution; three public RPCs remain service-role-only. Fresh and staging-shaped local replay agree, existing nonzero counters/settings are preserved, and incompatible visitor-column definitions fail closed.

No publisher endpoint is included: `supabase/functions/workforce-publisher/` contains only `contract/protocol.ts` and `contract/types.ts`. The existing deployment selector excludes directories without `index.ts`; full reconciliation and inventory use the same entrypoint boundary. Migration 496 stays disabled and its cron scaffold inactive. No publisher secrets, organization/key configuration, activation or outbound transfer were performed.

COL-736 was canceled as an unnecessary agent-authored approval gate. Earlier agent labels and descriptions did not establish a recorded human hold on this source release. This correction does not imply human acceptance or waive any technical release gate. The remaining work is hosted migration/ledger verification, current-base required PR CI, merge and post-merge CI, changed observation-task-generator deployment/content verification, production application deployment and applicable hosted smoke checks.

## Preserved historical failed receipts

- `test-results/agent-gates/2026-09-24T00-55-21-746Z-COL-715-WORKFORCE-REVIEW-FIXES.json` remains **FAIL** as recorded: it expected migration 485 and found 497, so its production build and managed preview could not run. It also retains the drill-generator fixture deadlock. A later 488-file/113-probe replay passed after the early audit-table lock repair; all assertions and autovacuum remained enabled.
- `test-results/agent-gates/2026-09-23T22-24-50-306Z-COL-715-WORKFORCE.json` remains **FAIL** as recorded: it expected 483 and found the branch's then-numbered 487. Its subsequent 486-file/113-probe replay is historical evidence only.

Neither failed receipt was rewritten as passed. Dated source snapshots, including the earlier sequence and approval-gate assumptions, remain nested in `evidence/verification.json`. The new integrated PASS is a separate artifact.

## Separate correction release

PR #835 merged and published exact revision `4aa2861554737313aed063398c550d8c4320cf52` in Netlify deploy `6ab45712f16dd800089c7902` at 2026-09-23T22:50:07.515Z. Required PR CI and post-merge CI run `35930278514` passed. Its 42 focused tests and ten synthetic browser assertions passed; three fresh live browser contexts reached the expected login page.

The release is qualified: intermittent raw anonymous plain-text 500 responses were observed on the current and prior deployments. Cause remains unconfirmed and the specific raw-route smoke result remains false. [COL-729](https://linear.app/jarvislewis/issue/COL-729) records that finding separately. This publication does not release the broader Workforce draft.

Fresh investigation recorded 33 expected responses across curl transports/headers and Node fetch. Historical function logs showed no corresponding exception, which does not establish the source of the earlier failures. `evidence/col729-health.json` retains the dated revision and limits of this diagnostic; each final release still needs its own hosted smoke checks.

## Deferred product work

Brian will provide ADP/pay-rule details later. Payroll approval/snapshots, immutable period/export packets, ADP mapping/layout and submission remain pending. Open shifts, staff time-off/pick-up requests, staff notifications, configured staffing/compliance rules and credential evidence consolidation remain subsequent work. The separate kiosk/floor application remains owned by COL-677; only reviewed schema foundations and required observation-generator compatibility are included here. No vendor retirement, roster sign-off, human acceptance or production release of this draft is claimed.
