# Operating evidence implementation

Requested 8 September 2026. Source: the user's “Haven and COL: operating requirements from weekly evidence”, HCOL-01–28. Proposal IDs remain proposal IDs.

## Baseline and sequence

Isolated branch `codex/haven-operating-evidence`, based on `origin/main` at `9db72d2d`. Main home/login checkout and the active Remaining Roadmap checkout are preserved. Remaining Roadmap's unmerged migrations 334–339 and active financial changes are separate work; migration numbering must be reconciled before integration.

1. HCOL-02/03/05: eliminate destructive CSV replacement; validate and preview before writes; one atomic import with expected versions, duplicate receipts, immutable prior evidence, and honest coverage.
2. HCOL-01/03: versioned approved definitions, source health and complete live aggregation. Financial and census semantics require domain decisions; do not invent them.
3. HCOL-06/07/08/12: referral identity, stage, next actions and truthful absence communication/recovery.
4. Subsequent delivery follows the supplied register, reusing active admission, reservation, financial, clinical-assignment and lifecycle repairs.

## First segment contract

The normalized aggregate CSV importer defaults to a read-only review plan. Publication explicitly supplies that plan, a definition-review reference and a correction reason where a week already exists. Unsupported workbook-style layouts reject before writes. The original historical January file is not operational seed data.

All file rows validate before publication. The database commits all affected weeks together, checks preview versions under a lock, preserves original metric/header evidence, and records fingerprint provenance. Missing expected facility/metric cells reduce coverage; uploaded blanks remain null. Calculation time does not imply source freshness. This segment does not claim approved equivalence between source labels and Haven live formulas.

Synthetic acceptance: duplicate upload; invalid final row; corrected week; stale preview; cross-organization facility; ambiguous numeric value; duplicate row; unknown layout; incomplete facility coverage; explicit zero; denied RPC; original revision retrieval. Independent review and a segment gate are required before completion.

## Boundaries

No real prospect import, production mutation, external notification, policy activation, or Front Office feed authorization is inferred. Named staff/device acceptance remains separate. No new dependencies.

## Completed bounded segment: reviewed CSV

Independent review APPROVE. Twelve CLI tests passed with no skips. Native PostgreSQL replay passed 337 migration files / 18 SQL probes. Actual CLI → local PostgREST 14.4 → PostgreSQL workflow verified dry-run, publication, duplicate receipt, correction and original retrieval. Supported typecheck and strict segment gate PASS: `test-results/agent-gates/2026-09-08T14-26-15-527Z-hcol-reviewed-csv.json`. `CSV-REVIEW.json` pins reviewed source hashes and test evidence.

The first gate failed because an isolated-worktree dependency symlink fell outside Turbopack's filesystem root. Replacing it with a local copy of the same dependencies fixed the environment; no versions or acceptance thresholds changed. Keep the failed artifact as honest evidence.

Simplification: CSV publication now uses one atomic RPC instead of per-week DELETE/PATCH/POST sequences. Missing data and uncertain definitions remain visible. Full HCOL-02/03/05 includes further workbook, UI, non-import publication, definition and source-health work.

Mission alignment: pass for this bounded engineering segment. Full HCOL implementation is not yet complete. No deployment or staff UAT claimed.

## Owner clarification: business definitions (8 September 2026)

Brian confirmed there is no single approved definitions page for Current AR, average rent, census inclusion or referral closure vocabulary. Jessica Murphy is the primary domain source of truth for vocabularies/forms/cadences. Keep independent technical repairs moving; use TBD placeholders and do not encode weekly worksheet assumptions into reporting or closure logic before Jessica's approval.

- Census reference: `docs/specs/COL-RESPONSE-LOG-2026-05-06.md` §2, Jessica-confirmed active / bed_hold_hospital / bed_hold_vacation / discharged, driving census and admissions/discharges. Billable days are separate from physical presence. Medicaid per-provider hold billability remains open. Charter measure: current census against licensed beds.
- Weekly Current AR / average rent / uncollected AR definitions: TBD. January archived worksheets are operational evidence; Module 16 AR aging does not approve COL's worksheet semantics.
- Referral closure reasons: TBD pending Jessica's vocabulary capture. Existing product pipeline enum stays separate from business loss reasons; do not invent or harden “said no / why” categories.

These inputs block only dependent definitions/calculations/import mappings and policy activation. They do not block truthful communication records, preservation of assignments/history, transactional integrity or recovery repairs.

## Completed bounded segment: presence truth and durable return follow-up

Bounded HCOL-12/22 repair. Remove the client-created notification timestamp while preserving existing legacy values. Capture a pending return-document follow-up in the same database transaction as hospital-to-active status history, retaining the existing renewal rule. Retry documentation independently under current authority; show missing/changed evidence for human review rather than overriding newer work. Add a persistent resident panel with retry and explicit documented human-review resolution.

This segment does not define new clinical criteria, hold billability, absence deadlines, external message delivery or Jessica-owned vocabulary. Explicit communication-event capture and the full absence-management model remain follow-on requirements.


Independent review APPROVE; 13 rendered tests passed. Native replay passed 338 migrations / 19 SQL probes. Actual lock-wait revocation tests denied writes after facility revocation and session deletion; duplicate retries converged on one completion. Local React → Supabase JS → PostgREST → PostgreSQL browser workflow verified actual hospital return, injected document failure, pending persistence after reload and successful retry. Authentication used signed synthetic claims and native auth/schema stubs; hosted login and staff UAT are not claimed.

Strict UI gate PASS: `test-results/agent-gates/2026-09-08T14-46-39-693Z-hcol-return-followup.json`. Its UI/a11y target is a component harness; complete Next build and native SQL replay also passed. Mobile visual verdict 95; no overflow, axe violations or page errors. Reviewed source/evidence: `RETURN-REVIEW.json`.

Simplification: removed the direct secondary Form 1823 write from the presence picker. The database persists follow-up once; current-authority retry or explicit human review closes it with evidence. No automatic communication timestamp or clinical clearance is fabricated.

Remaining HCOL-12/22 scope: explicit communication-event capture, full absence coordination and cross-facility transfer recovery. This slice intentionally fails closed when resident facility differs from captured follow-up facility; integration must provide authorized transfer handoff/reassignment before claiming recovery across transfers. Manual-review input remains mounted on uncertain results; server follow-up survives reload, but unsaved free-text notes do not persist across reload. No browser PHI cache was introduced. Mission alignment: pass for this bounded engineering repair.

## Completed bounded segment: preserve referral assignment and concurrent work

Bounded HCOL-08/15 technical correction. Tour-date edits must omit assignment changes, preserving whichever tour owner is current in the database. Lead saves must confirm a matched row and reject stale loaded versions rather than silently overwriting another operator's stage, notes or assignment. This does not approve Jessica's closure vocabulary or add new business stages.


Focused tests: 7 passed; independent tests including wall-clock helpers: 12 passed. Actual page component → Supabase JS → local PostgREST → PostgreSQL browser checks preserved assignment, kept unrelated notes, confirmed subsequent saves against the returned version and rejected a concurrent stage/assignment change without losing the edited date. All saves serialize, and a success updates only its saved draft fields. Mobile header and feedback/tab contrast were repaired after browser/axe findings; no shared component changed. Final mobile visual95, no overflow/axe/page errors.

Strict UIgate PASS `test-results/agent-gates/2026-09-08T15-05-52-440Z-hcol-referral-tour.json` (full build, lint, audit,338 migration/19 SQL replay, component-harness design/axe). Browser evidence uses a synthetic navigation/auth harness and signed local actor; no hosted login or full Next route UAT claimed. HCOL08 assignment acceptance/backup and HCOL15 tour outcomes remain open. Jessica's vocabulary untouched. Mission alignment: pass for this bounded repair.

Final independent implementation and UI source review APPROVE; zero diagnostics.

## Completed bounded segment: complete scoped reporting reads

Bounded HCOL03 correction: paginate facilities and all ten standup sources beyond server/default read caps; repeat organization/facility/soft-delete filters on every page; reject later-page failures rather than returning partial totals. No operational query runs for an empty accessible facility set. Preserve existing calculations, dates and definitions in this slice; those calculations are not newly approved COL worksheet semantics. Source freshness, operational completeness, usable-bed truth and pending/actual forecast separation remain separate follow-ups.

Read consistency limit: this segment removes silent fixed/default caps, but separate offset pages are not a transaction-consistent database snapshot under concurrent inserts/deletes. It does not certify a historical publication cutoff or operational capture coverage; source-owned snapshot/aggregation work remains open.


Independent review APPROVE.20 tests passed, one existing opt-in performance test skipped; numeric snapshots unchanged. Actual loader → local PostgREST read5001 records across41 requests with a127-row server cap, preserving scope and including the last current-week record. Supported typecheck and strictgate PASS `test-results/agent-gates/2026-09-08T15-24-17-944Z-hcol-standup-pagination.json`. Evidence `PAGINATION-REVIEW.json`. Simplification: common scoped factory replaces ten repeated capped query builders. Mission alignment: pass for bounded read completeness, not approved financial definitions or operational coverage.


## Completed: latest-main integration

Main advanced to `adb5ecb9` with the independent payroll freshness release (PR458). Merge that release into this isolated branch, keeping its migration334. Our unchanged SQL is renumbered: reviewed CSV335, resident-return follow-up336. Historical gate counts remain evidence for their original commits; the combined sequence requires a fresh integration gate. Active Remaining Roadmap worktree was not altered.


Independent integration review APPROVE: incoming files match main `adb5ecb9`; renamed SQL content is unchanged; probe comment and source-path references updated. Combined strict gate PASS `test-results/agent-gates/2026-09-08T15-31-54-744Z-hcol-main-integration.json`, including339 migrations/20 SQL probes and full build. Initial full suite had3319 passes and a5-second timeout in unchanged `AppShell.test.tsx`; targeted rerun passed10/10 with the same timeout. With the gate finished, full rerun `npm test -- --maxWorkers=4` passed3320 tests across533 files, two existing opt-in skips. No test/timeout/fixture threshold was weakened. Evidence `INTEGRATION-REVIEW.json`.

Historical segment artifacts retain their original migration counts. Current forward sequence:334 payroll (released main),335 reviewed CSV,336 resident return follow-ups. Active remaining-roadmap changes remain separate and need their own integration/review. No production changes made by this task.
