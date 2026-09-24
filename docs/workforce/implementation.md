# Workforce in-place delivery — COL-715

Mission alignment: pass. Build the existing Workforce into a daily and weekly operating flow, using real facility-scoped data and preserving audited history. The 2026-09-23 teardown and HTML are reference inputs; no sample staff or payroll policy is production configuration.

## Sequence and ownership

1. Verify and repair timeclock pagination, missing-out resolution and time-record self-approval.
2. Build the existing schedule detail into a people/week grid; save, copy and publish through scoped locked database commands.
3. Connect Today, Schedule, Timecards, Payroll and People with a shared loop and retained secondary workflows.
4. Review, focused regression tests, mandatory segment gates, PR/current-base CI, merge and production verification where dependencies permit.

## Preservation and cleanup plan

Reuse facility shift definitions, existing correction ledger, employee-file requirements and payroll freshness contracts. Keep existing detail URLs and audit history. Reduce top-level navigation to five entries while secondary workflows remain reachable from their parent pages. Do not delete kiosk or uPunch paths during the parallel run. No new dependency. Preserve the reviewed COL-677 schema identities and import only the backend compatibility needed by those foundations; the separate floor application remains outside this release. Disposable evidence is tracked under the current private run directory.

## Explicit external dependencies

Brian replied on 2026-09-23 that ADP details will be provided later. ADP product/layout, employee mapping, workweek, meal, rounding and cross-building overtime rules remain unconfirmed. Submission and final payroll approval must remain gated; no agent action constitutes roster or staff acceptance. Existing COL-428 and COL-570 preserve those boundaries.

## Verification target

No missing rows above the API cap; genuine missing clock-outs remain unresolved until corrected; completed long shifts can be reviewed; draft shifts are private; published assignments retain recorded times; historical totals never substitute current shift configuration for missing evidence; normal assigned shifts are not gaps; staff cannot approve or alter payroll fields on their own records; facility switching does not show stale data; no fabricated all-clear or ADP success.

Manager staff and schedule read/write scope follows the live COL-571 decision (Brian, 2026-09-22) that Manager and Administrator share permissions. This delivery changes only the named Workforce boundaries; it does not claim complete platform role parity. The employee-file minimal identity projection and confidential medical access remain separately tested.

## Review fixes in the current source

1. Schedule cell edits preserve the existing assignment ID, unit, assigned residents, classification and notes. Selecting Off retires the assignment without deleting its evidence.
2. Copy previous week uses the original planned slots and excludes call-out replacement rows. It copies planning metadata, resets attendance state, and rejects inactive original staff instead of silently substituting a replacement.
3. A completed shift longer than 16 hours is a reviewable `long_shift`; a missing clock-out or meal end still requires an actual correction.
4. Correction reads use bounded concurrency of eight requests instead of a sequential batch waterfall, retaining pagination and exact-count checks.
5. Completed-week Timecards links carry `period_start`, exclusive `period_end`, and `period_mode=workweek`. The destination retains that week even when the organization uses biweekly pay periods.
6. Completed-week scheduled totals use recorded assignment times. Legacy rows without those times remain unknown; current shift configuration remains available for current attendance display.
7. Pending, rejected or incomplete employee-file evidence cannot replace an outstanding completion deadline with a proposed future expiry. Renewal dates come from verified evidence.
8. Unsaved schedule changes participate in the shared route-leave guard, including navigation outside the grid.

The additional direct-write concurrency repair returns PostgreSQL `55P03` when an assignment write encounters a parent schedule lock, so the operation can be retried without a lock-order deadlock or partial mutation. Existing cells are changed in one SQL statement and checked against the expected row count.

## Current integration and release boundary

The integrated source now contains verified prerequisites 490–496, Workforce migration `497_workforce_in_place.sql`, and forward migrations 498 and 501. The already-hosted family invoice migration 499 and onboarding manual sign-off migration 500 are included with their matching probes. The 22 pinned prerequisite imports are listed in `evidence/prerequisite-provenance.json`. Main now contains the released floor/kiosk migrations 494/495 from `b5c844a6`; migration 498 remains the recorded forward reconciliation applied earlier in staging and production, with explicit private/service-only permissions. It does not roll staging back or repurpose existing migration identities.

The observation-task-generator includes its matching backend and defers staffing-alert resolution until task writes and unowned-assignment repair succeed. Ten generator tests and the full 50-test Edge suite pass. Migration 496 contributes disabled database configuration and an inactive cron scaffold. Only its two canonical contract files and native proof helpers are included: there is no publisher `index.ts`, config section, endpoint, secret provisioning or outbound roster transfer.

The integrated canonical gate passed at `test-results/agent-gates/2026-09-24T03-11-49-296Z-COL-715-WORKFORCE-INTEGRATED.json`: 501 migration files, 119 SQL probes, seven acceptance suites, 105 care-event parity cases, the 6,687-byte synthetic publisher contract proof, root build, lint, security, stress, four design screenshots and one accessibility route. Canonical typecheck and focused regressions also pass. Five earlier CI failures were repaired and checked with 88 focused guard tests plus component checks.

COL-736 was canceled because it was an unnecessary agent-authored approval gate; no recorded human hold blocks this source release. Staging migrations 496–498 and 501–502 are applied. Production has 494/495, the independent 499/500 migrations, and Workforce 496–498 and 501; migration 502 awaits refreshed CI. The full production ledger passed before 502 was added. The branch has incorporated current main through 495, including the released floor/kiosk application. The final native replay passed 505 migration files, 122 SQL probes, seven acceptance suites and 105 parity cases on current main, including independent onboarding migration 500 and Workforce migrations 501–502. The new setting defaults to the existing 960-minute boundary. The shared admin bundle check now passes below its existing 450 kB cap. Current-base PR CI, merge/post-merge CI, production migration and deployment, and hosted exact-revision proof remain. Local success is not a production release, staff acceptance or ADP readiness.
