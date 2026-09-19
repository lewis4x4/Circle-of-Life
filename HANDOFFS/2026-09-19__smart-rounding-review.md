# Smart Rounding review and source integration — 2026-09-19

Mission alignment: **pass** for this source change. Historical compliance, facility boundaries, visible configuration gaps, and honest delivery receipts support accurate resident-care oversight. Production activation remains **held**, not accepted or deployed by this review.

## Scope and authority

Reviewed PR #595 from `ca34fdf2` and integrated current main `7e3ede8e`. The supplied narrative described migrations through 438, but the available PR contained 417–432. Read-only hosted ledger checks confirmed staging through 432 and production through 416. This review therefore implements verified corrections in new, transaction-wrapped migrations **433–434**, without modifying the already-applied 417–432 files. No hosted migrations, secrets, cron changes, or deployments were performed.

## Findings corrected

| Problem | Result and proof |
| --- | --- |
| A facility-only resident transfer changed old compliance and counted the full transfer day at both buildings. RLS could also hide history from the former building or invent morning occupancy at the destination. | Facility changes capture status-history intervals; compliance uses facility-scoped, occurrence-time occupancy. Signed source-only and destination-only role probes preserve the old building and split the transfer day. Admission dates begin at facility-local midnight. |
| A midday cadence activation selected one version for the entire day; the mismatch flag compared the stamped value with itself. | Each occurrence resolves the version in force at its due time; completed task evidence is retained and the independent projection is compared with its stamp. Midday and mismatch regressions exercise both. |
| A shift deactivation rewrote taskless closed history; a shift-key rename cascaded into historical cadence windows. | Effective shift-state history preserves prior workability. New shifts start at creation time. Keys referenced by active or superseded cadence cannot change; labels remain editable. Configuration gaps are separate from expected and missed windows in SQL, summaries, and Watchlist. Existing visible, completable tasks remain actual obligations. |
| An unassigned nudge at the front of a limited query starved later escalation tiers; cadence activation could leave new current-shift windows ungenerated. | Unresolvable assigned-only nudges are filtered before LIMIT. Generation repairs open current-shift windows and creates the next shift, using each shift's own roster. Monitoring Orders and transfer stand-down still run when cadence is absent. |
| Transient SMS or push failure permanently ended delivery; two notification queues had no worker. | Bounded provider retries and claim/outcome contracts are exercised through the real adapter and SQL. Monitoring Order and Acute Watchlist notifications drain through the existing worker. Partial failures are reported as failures. |
| Hosted row caps truncated reports and boards; old completed tasks could hide current caregiver tasks. | Exact-count pagination advances by actual returned rows and rejects incomplete/changing counts. Caregiver queue filtering and exact task lookup have API regressions. |
| A delayed old-facility response overwrote the newly selected building; report columns clipped on narrow layouts. | Scope remounts/request sequencing isolate facility results. Scrollable, keyboard-accessible cuts retain the unconfigured column. Component browser tests cover delayed facility switching and phone capture. |
| Gate success could mean the step never ran; migration-number allocation missed local files; constitution lint passed with its subjects deleted. | Core CI always executes. Regression tests prove failure paths, including remote claims API failure and paginated PR file discovery. Replay now requires all seven SQL acceptance suites in both supported transports. Placeholder stress checks were replaced with an 18,000-row compliance/pagination scenario and actual failure cases. |
| A merge could publish UI and Edge Functions against production's missing schema. | Production Netlify and Edge deployment check their target's migration ledger first. The integration carries explicit source-only deployment holds. A read-only production run proved the publish guard blocks the 18 pending migrations. |

## Verification

- Application suite: **6,357 passed, two skipped** in the final complete run. The subsequent rounding-route hydration fix passed its focused 20-test shell/summary/API suite and the final production build.
- Complete Edge Function suite: **396 passed**. An inherited 5 ms QBO stalled-body deadline test failed once while other suites ran, then passed both its 98-test file and the complete rerun. Smart Rounding entrypoints also passed Deno typechecking.
- SQL: original function controls failed for transfer history, midday cadence resolution, nudge starvation, and false Watchlist gaps; corrected functions passed. The new regression also tests real role claims, foreign simulation refusal, inclusive window-close boundaries, current/next generation, historical shift changes, and audit-derived backfill.
- All seven existing SQL acceptance suites passed against the corrected schema. Fixtures now explicitly establish historical shift state and facility-local admission boundaries; they no longer depend on retroactively applying today's inserted shift configuration.
- Typecheck, production build, lint, dependency audit, migration claims, and six gate regression tests passed.
- Component browser proof: two Chromium tests, phone capture with zero WCAG A/AA axe violations, plus delayed facility switching. These use real components with synthetic API fixtures and are distinct from full-app verification.
- Two earlier combined gates are retained as **failed** artifacts. The first caught an intermediate SQL syntax error and correctly rejected a missing authenticated browser storage file. The second caught an outdated seven-argument procedure-identity assertion after the retry contract added two optional arguments. The full probe sweep also replaced obsolete source-text checks with behavior checks; a deliberately broken hospital-status fallback made the replacement fail. Neither failed artifact is release evidence.

Final combined gate: **PASS**, [machine-readable artifact](../test-results/agent-gates/2026-09-19T20-20-08-587Z-SMART-ROUNDING-REVIEW-20260919.json). Replay applied **437 migrations**, ran **81 SQL probes**, **seven acceptance suites**, and **105 care-event parity cases**. Required security/lint/build/stress checks passed; authenticated Integrity design review captured four viewports and axe passed.

Full-app browser [evidence](../test-results/smart-rounding-full-app/proof.json): normal administrator and caregiver logins, all five rounding tabs returning HTTP 200, unauthorized facility compliance returning 403, and zero page/hydration errors. Phone capture used the actual API and production cadence-generation RPCs: its target window changed from `satisfied=false` to `true`, the task persisted `completed_on_time`, and its stamped/projected versions matched. The report preserves the correction of an initially inconsistent synthetic task fixture. Seven clean screenshots accompany the evidence. Two synthetic component browser regressions also passed and now run unconditionally in CI.

The PHI shape scan and configuration-literal scan passed. The exact resident-name scan could not run because its private import source is absent; acceptance 14 is not claimed fully proven by that scanner.

## Evidence limits and activation handoff

Audit-derived transfer backfill only repairs boundaries with a recorded facility change and a covering status-history interval. Missing history produces a warning requiring review; it does not invent dates. Initial shift history uses the recorded configuration plus available audit transitions. Unknown, unaudited prior changes cannot be reconstructed with certainty.

Roles without an available in-app delivery surface now receive an explicit `in_app_surface_unavailable` skipped receipt; their push/SMS channels drain independently. Existing executive alerts and eligible escalation surfaces are verified before recording in-app delivery. This does not invent a caregiver inbox.

Local SQL replay uses Supabase stubs; the separate full local Supabase browser rehearsal uses actual Auth/PostgREST with synthetic people. The local stack's missing baseline table grants are copied from read-only production ACL metadata, preserving real RLS. No local proof is Homewood staff depth UAT or hosted deployment acceptance.

For activation, obtain the repository-required approval, rehearse 433–434 on staging, verify the target ledger, and then apply production's 417–434 in order through the established hosted migration process. Deploy all four Smart Rounding workers after schema parity and verify the documented cron schedules, including cadence activation. Source-only merge markers intentionally prevent this merge from deploying automatically; later activation must deliberately publish the frontend and all required functions. Provider delivery and staff/device rehearsal remain operational acceptance tasks. Track A A3 remains open; A5 is not reopened.

## CI accessibility follow-up

The first pushed review commit passed finance/schema CI, but application CI timed out at five seconds while axe scanned the existing facility-profile fixture (91 source items and 110 components). The other 6,357 application tests passed, with two intentional skips. The test now has a localized 15-second timeout; its full DOM scan and zero-violation assertion are unchanged. All 16 tests in that file pass locally. The test-only follow-up segment passed [its required gate](../test-results/agent-gates/2026-09-19T20-41-39-205Z-SMART-ROUNDING-CI-A11Y-20260919.json). Mission alignment: **pass**; accessibility coverage is preserved under shared CI load. Final-head CI must pass before merge.
