# COL-156 backend verification

The task-bound source view reuses native employee requirements, records, signatures and `assessEmployeeFile`. It presents 20 source items, 22 components and 14 Employee File fields without creating another checklist, performing administrative work, granting duty clearance, or changing employment status.

Medical inputs require both HFO medical scope and the native medical grant. Sensitive training-category codes are filtered before hashes and dates are calculated. History contains server-computed fingerprints and preserves A → B → A transitions; unchanged refreshes and exact request retries do not append. Direct inserts cannot choose transition order or forge source state. Current authority is checked again after waits.

## Executed local evidence

- `probe-final-stable-postgres.log`: migration 368 native synthetic probe passed, including first snapshot, unchanged refresh/retry, hidden medical change, sequence override rejection, A → B → A, deterministic date-driven expiry, separate medical grants, revoked medical history and immutable history/site denial. The fixture rolls back.
- `concurrency-final.log`: two independent PostgreSQL connections observed actual waits. Same-key concurrent requests converged; medical-only revocation while waiting preserved personnel access and removed medical scope.
- `backend-tests-final.log`: 12 tests across two files passed. Includes null hire date and mixed verified/missing requirement ordering regressions.
- `typecheck-supported.log` and `lint-final.log`: repository-supported typecheck and focused ESLint passed.
- `vitest-full.log`: parent-owned full suite passed, 636 files / 4,613 tests and two existing skips. The two new focused regression tests were verified separately after the full suite began.
- `strict-gate.log`: mandatory UI/PG gate retry passed: 12 checks passed, zero failed, one optional skip, all 11 required checks passed. PostgreSQL replay covered 371 migrations and 51 SQL probes. `strict-gate-final.json` is the exact result. The first gate failed only the inherited dietary probe, with an exact server-log autovacuum/late-trigger lock cycle. `inherited-probe-deadlock.log` preserves that diagnosis. The probe now acquires the required audit table lock before fixture writes; `dietary-probe-lock-fix.log` passed with all original forced-audit assertions. No production code or autovacuum settings changed.

An initial raw `tsc --noEmit` invocation included inherited test and generated gateway files excluded by the repository's supported typecheck configuration. Its diagnostic log is retained in the private run manifest. A first final native invocation omitted PGUSER and could not connect; the explicit postgres invocation above passed. Neither configuration mistake is recorded as application verification success.

## Remaining boundaries

Authenticated staging upload, attach, review, download and browser acceptance remain separate proof. No staging or production mutation was performed by this backend lane. AHCA submission state, uncertain course equivalence, LMH rules, cart training conflicts, and undefined review periods remain visible gaps. Existing production release and business acceptance obligations remain with their canonical issues.

The owned synthetic baseline `col156_native_d0bf8a90` is retained on the scratch cluster (reservation released after the gate) until the gate and hosted fixture review finish. Its exact provenance and raw logs are recorded in `/Users/brianlewis/.hermes/tmp/agent-runs/col156-native-d0bf8a90/manifest.json`.
