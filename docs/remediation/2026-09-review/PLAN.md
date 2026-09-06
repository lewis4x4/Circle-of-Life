# September review remediation plan

Scope: all 119 indexed findings in the September 5 review (duplicates retain cross references). Mission alignment: risk until access and complete workflows are verified. No clinical or launch acceptance is implied by source fixes.

## Behavior lock and cleanup sequence

1. Add targeted behavioral regressions before corrections. Preserve working clinical, accounting, and reporting tasks; preserve drafts and explicit error outcomes.
2. Access boundaries: constrain profile and facility access writes, admission patch fields and witness signatures; isolate witness authentication; repair authorization existence checks.
3. Data integrity and truthful completion: clinical drafts/vitals/notes, medication and dietary persistence, atomic finance operations, identity-owned offline replay and explicit conflicts.
4. Capability parity and scope: restore working task routes selectively, remove inactive controls/false claims, consistent currency/calendar dates and role/facility context.
5. Follow-through: reporting, office coordination, onboarding and readiness states must represent durable results.
6. Independent review, focused tests, full tests, typecheck, lint/static checks, migration replay and segment gates. Record actual results and deployment/UAT gaps. Do not weaken gates or passing criteria.

## Execution boundaries

One integrated review-remediation segment, with independent file-owned clinical, access, business and navigation/reporting lanes. Each lane records tests and exact finding dispositions. Preserve pre-existing marketing work. No new dependencies, architecture reset, bulk production data changes or synthetic hosted clinical records. New database behavior is implemented and tested locally before any hosted rollout. Existing source review remains immutable. Commit only verified segment-owned files using Lore trailers when required gates pass.

## Smells

Boundary violations: client-side authorization, non-atomic writes, cross-operator replay. Duplication: competing mutation and date/money/scope contracts. Dead behavior: simulated completion and replacement placeholders. Missing tests: behavioral persistence, failed-save recovery, denied access and capability parity.

## Tracking

`findings.json` is the exhaustive disposition ledger. Pending means not yet corrected; mitigated means hazardous behavior is contained but the full workflow is unfinished; implemented requires specific source and test evidence; verified adds integration evidence. Never equate a disabled misleading button with a complete workflow.

## Final quality pass

Resolve pre-existing lint errors/warnings without changing rendered marketing content or functionality. Remove unused bindings/imports and correct escaping; preserve hook dependencies and image behavior. Full unit suite is the behavior lock, with focused reruns for any nontrivial correction. No lint suppression or gate weakening.

The first integrated gate exposed a runner failure: preview startup after a failed build aborted before writing its JSON artifact. Repair the runner to record failed preview prerequisites, and replace unowned-port process termination with selecting a free port. Retain gate failures and the full required checks.

Accessibility verification now scans intact product content; broad text-based DOM removal is removed. UI scripts reject HTTP failures and login redirects as substitutes for requested routes. Final anonymous visual/a11y coverage is explicitly limited to public homepage and sign-in; authenticated operational UAT is a separate open deployment gate.
