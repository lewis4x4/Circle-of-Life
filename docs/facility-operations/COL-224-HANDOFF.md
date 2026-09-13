# COL-224 billing timestamp hydration

## Proven mechanism and historical limit

The original375px report from COL217 retains only300 characters of a React hydration error. The original component stack and server/client text diff were not retained, so the historical incident cannot be conclusively attributed. `col224-evidence/original-error-reference.json` preserves the exact retained error and the whole original report hash.

A new controlled test uses the actual BillingArOverviewHero, identical facility state, server time23:54:59.999Z and client time23:55:00.001Z. It produces one recoverable hydration error with server7:54PM/client7:55PM text. A same-minute control has no errors and identical text. Full local diagnostic HTML, text and error stacks are retained in `col224-evidence/diagnostic-hydration-report.json`, with exact source metadata and the original diagnostic in adjacent files.

## Narrow repair and regression

The hero starts with a deterministic missing-time placeholder on the server and first client render. Its existing clock effect schedules the initial timestamp callback, retains the60-second interval, and cancels both timers on unmount. No hydration warning suppression or whole-page client-only rewrite was added. The prior contrast fix and scope controls remain intact.

A failing regression was retained before application changes: minute-boundary and Eastern-midnight cases failed, while three controls passed. Final focused testing passes11 tests across3 files, including six hero hydration/clock/scope tests and five existing billing tests. Tests verify no recoverable errors, preservation of the server-rendered heading node, interval/manual/external refresh, scope-cookie behavior and cleanup before the first clock tick. Typecheck and targeted lint pass. Direct synchronous state-setting in the effect was rejected by project lint; the actual initial clock callback is tested and cleaned up, with no lint waiver.

## Remaining verification

Independent code review is clean. Fresh authenticated375/1440 initial+reload proof passed against staging iwcnajanvjvynolltflw using real browser time and exact source hashes. All four cases confirmed the actual server placeholder, a hydrated Eastern timestamp and manual Refresh event, with full page-error/console/HTTP/axe arrays empty. Parent inspected all four screenshots. The fresh actor was banned/inactive with zero grants, exact site/entity retired and owned4342 listener closed. Final mandatory gate `2026-09-13T06-19-21-184Z-COL-224-BILLING-HYDRATION.json` passes all11 required checks, including369 migrations/49 native probes. A metadata-only merge aligned verified main ancestry after whole-baseline tree equality was checked; no files changed and proof source hashes remain identical. Commit/main merge and production release remain pending.

The existing R shortcut defect remains COL227. This repair addresses a newly reproduced current clock mechanism; it does not manufacture the missing historical stack or establish that it was the only possible cause of the old observation.


## Recovery boundary

No schema, invoice or policy mutation was made. A bounded source revert is possible but restores the known timestamp race; retain regression and diagnostic history and prefer a reviewed forward repair if a new issue appears. Production remains on the separately held old revision until coordinated release requirements are satisfied.
