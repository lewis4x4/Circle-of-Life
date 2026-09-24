# Workforce in-place delivery — COL-715

Mission alignment: pass. Build the existing Workforce into a daily and weekly operating flow, using real facility-scoped data and preserving audited history. The 2026-09-23 teardown and HTML are reference inputs; no sample staff or payroll policy is production configuration.

## Sequence and ownership

1. Verify and repair timeclock pagination, missing-out resolution and time-record self-approval.
2. Build the existing schedule detail into a people/week grid; save, copy and publish through scoped locked database commands.
3. Connect Today, Schedule, Timecards, Payroll and People with a shared loop and retained secondary workflows.
4. Review, focused regression tests, mandatory segment gates, PR/current-base CI, merge and production verification where dependencies permit.

## Preservation and cleanup plan

Reuse facility shift definitions, existing correction ledger, employee-file requirements and payroll freshness contracts. Keep existing detail URLs and audit history. Reduce top-level navigation to five entries while secondary workflows remain reachable from their parent pages. Do not delete kiosk or uPunch paths during the parallel run. No new dependency. Isolate all edits from COL-677 floor/kiosk work. Disposable evidence is tracked under the current private run directory.

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

The Workforce migration is now `497_workforce_in_place.sql`. Main-sequence reconciliation is still in progress; the current predecessor map is documented in `verification.md`. The held COL-677 PR #814 owns migrations 494–495 and remains a separate approval boundary.

The integration lane reports 108 focused tests across 15 suites, nine shared route-leave tests, canonical typecheck, repository lint, targeted SQL and the direct-write concurrency proof passing. The route-leave regression first reproduced two confirmations where one was expected; the fix now passes. Final full gates and release verification remain pending. These source checks do not establish a production release, staff acceptance or ADP readiness.
