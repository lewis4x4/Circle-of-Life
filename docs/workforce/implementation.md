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

No missing rows above the API cap; missing clock-outs remain unresolved until corrected; draft shifts are private; schedule times come from configuration; normal assigned shifts are not gaps; staff cannot approve or alter payroll fields on their own records; facility switching does not show stale data; no fabricated all-clear or ADP success.

Manager staff and schedule read/write scope follows the live COL-571 decision (Brian, 2026-09-22) that Manager and Administrator share permissions. This delivery changes only the named Workforce boundaries; it does not claim complete platform role parity. The employee-file minimal identity projection and confidential medical access remain separately tested.
