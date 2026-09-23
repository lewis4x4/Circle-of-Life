# COL-715 verification and release boundary

## Implemented scope

- Existing Workforce navigation now groups Today, Schedule, Timecards, Payroll and People. Secondary ledger, training, certification and directory routes remain reachable.
- Today compares published schedules with the recorded kiosk state. Empty, failed, disabled and unconfigured states remain distinct.
- Schedule has the people/week grid, configured shifts, bulk save, copy previous week and publish. Database guards enforce scope, publication stamps, immutable published plans, overlap handling and audited swap/call-out coverage.
- Timecards reads a completed Monday workweek on the server, includes Sunday carry-in, retains archived schedule history, and identifies incomplete punch time. No payroll approval or ADP claim is made.
- People reads the employee-file assessment engine, upcoming published shifts, recorded hours and dated requirements. It does not infer medical clearance or fabricate visiting-staff due dates.
- Legacy time records reject self-approval/pay/scope forgery; Manager staff scope follows Brian's dated COL-571 decision. This is not a claim of complete platform-wide role parity.

## Evidence

- Initial focused run: 419 tests across 20 suites passed.
- Current-base integration: 58 tests across nine suites passed; separate source-scope/identity/race checks also passed.
- Full typecheck and repository lint passed. Ten loader regressions also cover unresolved employee identity, so hidden/missing staff metadata cannot silently become a zero attendance count.
- Standalone Next application build passed, including the new routes. This does not override the failing release sequence gate.
- Twelve desktop/tablet/phone screenshots and three axe route checks passed against production Workforce components/CSS with labelled synthetic source responses. An additional Schedule browser proof passed cell cycling, configured-time save/readback, publication/read-only state and phone scrolling; both additional captures have zero axe violations. These are not hosted authentication or staff acceptance.
- Expanded schedule SQL proof passed publication, direct/legacy writes, scope, swap atomicity, and Home compatibility. Two concurrent writers serialized; the second overlap was rejected and one assignment persisted.
- Final native PostgreSQL replay passed: **486 migration files, 113 SQL probes, all seven Smart Rounding acceptance suites, and 105 care-event parity cases**. The final command exited 0.

## Required release gate

`test-results/agent-gates/2026-09-23T22-24-50-306Z-COL-715-WORKFORCE.json` records FAIL. The source sequence expects 483 and finds this branch's 487. Production build and the gate-managed UI preview therefore remain blocked. An RLS initplan check and outdated acceptance-fixture setup discovered during that run were corrected. The final native replay passed in full; its supplemental receipt is `docs/workforce/evidence/verification.json`. No failed artifact is rewritten as passed.

Predecessors are held PR #814 (483–484), PR #822 (485) and PR #833 (486). This branch does not copy those files, change their holds, or relax migration checks. Reconcile against main and rerun the required release-sensitive gates after that sequence lands.

## Separate correction release

PR #835 carries only the independently releasable pagination and explicit missing-end correction fixes. Its release evidence is separate from this larger draft.

## Deferred product work

Brian will provide ADP/pay-rule details later. Payroll approval/snapshots, immutable period/export packets, ADP mapping/layout and submission remain pending. Open shifts, staff time-off/pick-up requests, staff notifications, configured staffing/compliance rules and credential evidence consolidation remain subsequent work. Kiosk/floor changes remain owned by COL-677. No vendor retirement, roster sign-off, human acceptance or production release of this draft is claimed.
