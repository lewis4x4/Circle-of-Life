# BUS-006 payroll source freshness

Mission alignment: pass — refresh reviewed payroll hours while preserving exported financial evidence.

## Behavior

- Refresh approved punches imports new punches and updates corrected/reapproved punches in the same draft line, with the same globally unique source key. Other batches retain source ownership.
- Current exports and transitions into queued/exported validate approval, source revision, staff/scope, pay-period membership and exact stored hours while holding source locks.
- Ineligible existing punches require correction/reapproval or explicit draft exclusion. Exclusion retains prior values and identity. If an excluded punch becomes eligible again, export is blocked until refresh restores it.
- Queued/failed batches can return to draft for correction. Exported/voided batch history and non-draft line values are immutable. Historical exported downloads use stored line payloads.
- All four CSV buttons request a validated server snapshot; a failed snapshot creates no download and leaves retry available.

## Verification

- 10 focused rendered-component/CSV tests pass, including failed refresh/retry, all four stale CSV actions, explicit exclusion and historical controls.
- Typecheck passes. Complete native PostgreSQL replay passes: 344 migrations, 25 SQL probes. These probes use disposable databases and Supabase Auth stubs; they are not hosted-auth evidence.
- Concurrency runner reproduces baseline stale 7.5-hour output after correction to 8.5 hours, then proves same-line concurrent import, export waiting for correction and rejecting stale approval, refresh waiting for reapproval, and authority revocation during a wait.
- Independent source review requested two fixes (reapproved excluded omission; intermediate batch freeze). Both were corrected, regression covered and approved.
- Full strict UI segment gate: PASS, `test-results/agent-gates/2026-09-08T14-43-35-176Z-BUS-006-payroll-freshness.json` (lint, build, migration replay, hygiene/security, design and accessibility). Generic design/axe routes do not replace the separate payroll browser workflow proof.

- Authenticated isolated browser proof: imported 8 hours, corrected/reapproved to 9 hours, observed stale CSV rejection with no download, refreshed the same line UUID, and downloaded corrected CSV. After marking exported and correcting source to 10 hours, stored payload and historical CSV remained at 9 hours. See [PAYROLL-BROWSER-PROOF.md](PAYROLL-BROWSER-PROOF.md) for setup, exact evidence and local HTTP/CSP limitations. SQL drove punch correction/reapproval and batch status; browser drove payroll actions.

## Limits

No hosted deployment, payroll vendor delivery or named-staff acceptance is claimed. Legacy exports lack original file archives; staff display names are current scoped records, so historical downloads are not represented as byte-identical originals. Source updates after a validated snapshot do not retroactively change its CSV. Post-export adjustments are outside this repair. The payroll writer lock serializes payroll writes and snapshots to preserve unique source ownership and coherent reads.

The migration includes rollback SQL that restores prior behavior without deleting source revisions, exclusion records or historical values. Runtime rollback has not been exercised.
