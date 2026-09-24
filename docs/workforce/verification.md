# COL-715 verification and release boundary

## Implemented scope

- Existing Workforce navigation now groups Today, Schedule, Timecards, Payroll and People. Secondary ledger, training, certification and directory routes remain reachable.
- Today compares published schedules with the recorded kiosk state. Empty, failed, disabled and unconfigured states remain distinct.
- Schedule has the people/week grid, configured shifts, bulk save, copy previous week and publish. Database guards enforce scope, publication stamps, immutable published plans, overlap handling and audited swap/call-out coverage.
- Timecards reads a completed Monday workweek on the server, includes Sunday carry-in, retains archived schedule history, and identifies incomplete punch time. No payroll approval or ADP claim is made.
- People reads the employee-file assessment engine, upcoming published shifts, recorded hours and dated requirements. It does not infer medical clearance or fabricate visiting-staff due dates.
- Legacy time records reject self-approval/pay/scope forgery; Manager staff scope follows Brian's dated COL-571 decision. This is not a claim of complete platform-wide role parity.

## Current review-fix evidence

The current source fixes all eight review findings: assignment ID/care-metadata preservation; original-plan copy without call-out replacements; reviewable completed long shifts; bounded correction-read concurrency; exact workweek navigation; recorded historical scheduled hours; outstanding employee-file deadlines; and the unsaved-grid route-leave guard. The additional SQL lock-order repair returns `55P03` for retry and preserves an atomic result.

The integration lane reports:

- **108 focused tests across 15 suites passed.**
- **Nine shared route-leave tests passed.** The regression first reproduced two confirmations where one was expected; the fix preserves a single confirmation.
- **Canonical typecheck passed again after that follow-up.**
- **Repository lint passed:** ESLint and the constitution check across 62 files on integrated main.
- **Targeted Workforce schedule SQL and affected compatibility probes passed.**
- **Direct-write concurrency proof passed:** the conflicting direct edit receives `55P03` without a partial write, the bulk RPC commits, and a later direct retry succeeds. Script: `scripts/workforce/verify-schedule-concurrency.py`.

- **Integrated application compilation passed.** Generated route types were refreshed after main removed obsolete routes; canonical typecheck also passed.
- **Full native PostgreSQL replay passed:** 488 migration files, 113 SQL probes, seven acceptance suites and 105 care-event parity cases. The initial replay exposed an autovacuum lock-order race in the drill-generator test. Its three-line early audit-table lock matches sibling probes; all assertions and autovacuum remain enabled.

Required CI, merge, migration application, application deployment and hosted verification remain pending. Successful compilation and replay do not override the migration sequence gate.

## Historical evidence before the review fixes

The following evidence belongs to the earlier source snapshot recorded in `evidence/verification.json`. It is retained for history and does not prove the current migration 497 tree:

- Initial focused run: 419 tests across 20 suites passed.
- Current-base integration: 58 tests across nine suites passed; separate source-scope/identity/race checks also passed.
- Full typecheck and repository lint passed. Ten loader regressions also cover unresolved employee identity, so hidden/missing staff metadata cannot silently become a zero attendance count.
- Standalone Next application build passed, including the new routes. This does not override the failing release sequence gate.
- Twelve desktop/tablet/phone screenshots and three axe route checks passed against production Workforce components/CSS with labelled synthetic source responses. An additional Schedule browser proof passed cell cycling, configured-time save/readback, publication/read-only state and phone scrolling; both additional captures have zero axe violations. These are not hosted authentication or staff acceptance.
- Expanded schedule SQL proof passed publication, direct/legacy writes, scope, swap atomicity, and Home compatibility. Two concurrent writers serialized; the second overlap was rejected and one assignment persisted.
- The earlier native PostgreSQL replay passed: **486 migration files, 113 SQL probes, all seven Smart Rounding acceptance suites, and 105 care-event parity cases**. That command exited 0.

## Required release gate

The current integrated gate, `test-results/agent-gates/2026-09-24T00-55-21-746Z-COL-715-WORKFORCE-REVIEW-FIXES.json`, records **FAIL**. Its sequence check expected 485 and found 497; production build and managed UI preview therefore could not run. The same receipt retains the drill-generator test deadlock, which the later full native replay resolved. Package-manager/environment hygiene, secret scans, dependency audit, repository lint and stress checks passed. No failed receipt is rewritten as passed.

`test-results/agent-gates/2026-09-23T22-24-50-306Z-COL-715-WORKFORCE.json` remains an unchanged historical **FAIL**. At that time, the source sequence expected 483 and found this branch's then-numbered 487. An RLS initplan check and outdated acceptance-fixture setup discovered during that run were corrected, and the earlier native replay subsequently passed. The historical receipt is preserved in `docs/workforce/evidence/verification.json`; it is not relabelled as a successful current gate.

The Workforce migration is now **497**. The integration lane's current predecessor map is:

| Migration(s) | PR | Current recorded state |
|---|---|---|
| 483–484 | #847 | Merged and integrated |
| 485 | #822 | Sequence reconciliation in progress |
| 486–487 | #848 | Sequence reconciliation in progress |
| 488 | #838 | Sequence reconciliation in progress |
| 489 | #839 | Sequence reconciliation in progress |
| 490 | #845 | Sequence reconciliation in progress |
| 491 | #841 | Sequence reconciliation in progress |
| 492 | #842 | Sequence reconciliation in progress |
| 493 | #843 | Sequence reconciliation in progress |
| 494–495 | #814 | Held COL-677 work; hold unchanged |
| 496 | #833 | Sequence reconciliation in progress |

This mapping replaces the earlier numbering, not the earlier failed evidence. It does not certify that the full sequence is merged, applied or released. Resolve the sequence on main, retain the held-work boundary, and run the required release-sensitive gates against the final integrated tree. Never bypass migration checks to claim completion.

Fresh ledger reads confirm that 494/495 are installed in staging but absent from production; 496/497 are absent from both. Reallocating those staging-installed identities to Workforce would conflict with recorded history. PR #814 still carries `do-not-merge` and `no-auto-merge`; its release boundary requires a separate decision.

## Separate correction release

PR #835 merged and published exact revision `4aa2861554737313aed063398c550d8c4320cf52` in Netlify deploy `6ab45712f16dd800089c7902` at 2026-09-23T22:50:07.515Z. Required PR CI and post-merge CI run `35930278514` passed. Its 42 focused tests and ten synthetic browser assertions passed; three fresh live browser contexts reached the expected login page.

The release is qualified: intermittent raw anonymous plain-text 500 responses were observed on the current and prior deployments. Cause remains unconfirmed and the specific raw-route smoke result remains false. [COL-729](https://linear.app/jarvislewis/issue/COL-729) records that finding separately. This publication does not release the broader Workforce draft.

Fresh investigation recorded 33 expected responses across curl transports/headers and Node fetch. Historical function logs showed no corresponding exception, which does not establish the source of the earlier failures. `evidence/col729-health.json` retains the dated revision and limits of this diagnostic; each final release still needs its own hosted smoke checks.

## Deferred product work

Brian will provide ADP/pay-rule details later. Payroll approval/snapshots, immutable period/export packets, ADP mapping/layout and submission remain pending. Open shifts, staff time-off/pick-up requests, staff notifications, configured staffing/compliance rules and credential evidence consolidation remain subsequent work. Kiosk/floor changes remain owned by COL-677. No vendor retirement, roster sign-off, human acceptance or production release of this draft is claimed.
