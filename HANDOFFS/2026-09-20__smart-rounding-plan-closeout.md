# Smart Rounding full-plan closeout, 2026-09-20

Mission alignment: pass for clinical evidence, current authority and historical policy preservation. Technical release and staff/device acceptance are separate.

## Authority and scope

Brian explicitly requested plan, build, review, fix, commit, push, merge and deploy after the full-plan review. This implements the nine findings against spec 25A and completes section 6 settings. Delivery: [COL-489](https://linear.app/jarvislewis/issue/COL-489). Staff/device acceptance: [COL-490](https://linear.app/jarvislewis/issue/COL-490). PR: [#603](https://github.com/lewis4x4/Circle-of-Life/pull/603).

The isolated branch starts at main at `3ef3359b` and incorporates pushed correction e9563fb8, already applied as 435 on both hosted projects. The original checkout's unrelated untracked 433–438 patches were preserved and never replayed. New forward migrations are 436–438. The spec's outdated migration allocation is corrected to actual filenames.

## Plan, implementation and independent review

1. Lock failing capture, settings conversion, scope and SQL-validation cases with regression tests.
2. Repair shared capture and Watchlist; implement full settings workflow and audited versioned database contracts in independent file-owned lanes.
3. Review authority, history and completeness independently, correct findings, and rerun focused/full gates.
4. Rehearse schema and actual authenticated workflows in staging, then release schema before frontend with backup and rollback records.

| Review finding | Correction |
|---|---|
| Live board bypassed chips | Shared ObservationCapture; required vocabulary/chips at the locked command boundary, after immutable receipt replay. |
| Rung edits erased terminal policy and overrides | Full protocol, ordering, targeting and shift-override roundtrip and editor controls. |
| Per-shift ladder bypassed validation | Effective ladder validated for every configured shift, including cadence-only edits against current escalation. |
| Saved proposals could not reach the approver | Persistent paired proposals, second-user reopen and complete current/proposed policy diff, including escalation-only proposals. |
| Missing section 6 settings | Versioned shift/preset/divisor/Watchlist/threshold configuration; template creation/revisions, per-facility preview/timing/application and drift. |
| Wrong-shift windows never generated | Due-time membership and wrapping shifts validated before activation. |
| Watchlist failures implied zero | Loading/error/success-empty distinguished, cached successful rows retained. |
| Change history hid policy fields | Structural complete-field differences and full configuration snapshots. |
| Resident history ignored selected facility | Scoped historical/evidence reads, stale-response isolation, human labels and underlying observations. |

Monitoring Order tasks now receive the existing roster assignment/recovery. Unassigned or colleague checks use an explicit, audited rescue claim; primary ownership and the direct-unclaimed-completion refusal remain intact. This chooses the least-privilege claim path under the current full-plan implementation authorization rather than automatically assigning every staff member.

Independent review caught and corrected missing child-table INSERT revocations, scheduled activation of historical versions, cadence-only orphaned shift overrides, hidden escalation-only proposal policy, historical rule visibility, stale template selection and malformed new shift keys. A separate read-only final reviewer approved after these fixes.

## Verification evidence

- Full application:816 files, 6,391 tests passed, 2 skipped.
- Smart Rounding Edge tests: 40 passed.
- SQL before-controls reproduced wrong-shift acceptance and terminal-before-warning override acceptance. New regression proves refusal, current-auth role boundaries, immutable snapshots, durable proposals, stale template refusal, direct INSERT denial, rescue claims and receipt replay.
- All seven existing acceptance suites passed on native PostgreSQL after adjusting successful chip fixtures and two clock-sensitive test setups. Their authorization/history assertions were retained.
- Browser component fixtures:4 passed, with real production components and synthetic transport. Phone drawer and settings/template application have zero WCAG A/AA axe violations. This is component proof, not hosted authentication.
- Policy scans cover TypeScript/Edge plus SQL function bodies separately from seed DML; 8 scanner regressions cover quoted bodies, overloads and dropped signatures. The scanner is a bounded source heuristic, backed by SQL behavior tests and review, not a complete SQL parser.
- Staging 436–438 applied atomically with ledger records and verified. The new rollback-only SQL probe passed on staging using actual Auth functions and existing grants, with zero synthetic fixture profiles remaining afterward.
- Combined gate and final-head CI results are recorded in the release evidence below after completion.

## Full specification acceptance map

| Items | Evidence / boundary |
|---|---|
| 1–2 | Existing generation/idempotency and boundary SQL suites; counts derive from actual active roster, never a fabricated fixed33-person fixture. |
| 3–4 | Readable Watchlist history and shared capture tests; actual drawer browser chips/optional note and authoritative SQL rejection. |
| 5–6 | Monitoring Order suite, roster recovery, caregiver claim/completion and active-order role tests. |
| 7–9 | Clock-advanced ladder suite and rule/disposition/volume fixtures; actual staff receipt and steady-state facility volume remain operational acceptance. |
| 10–12 | Five-tab/Watchlist scope and no resident composite on this surface; HTTP/RLS and facility-switch regressions. Other spec 25 consumers retain their separate contracts. |
| 13 | Full application/Edge, typecheck/lint/build/security/replay gates and final-head CI. |
| 14 | Synthetic fixtures only; no resident values or credentials in new artifacts. The prior private-name source absence is not represented as a completed private-name scan. |
| 15–18 | Full immutable configuration snapshots, historical replay, all validation blocks and simulation plus cross-user proposal approval. |
| 19 | Both executable source scans plus behavioral configuration tests; transport lease explicitly exempt from clinical policy scanning. |
| 20 | Existing real-routing command and delivery adapter tests; no claim of staff device receipt or SMS provider setup. |
| 21 | Immutable template revisions, pinned previews, mixed per-facility outcome UI test and SQL apply/drift suite. |

## Release and recovery

Targets are explicit: staging iwcnajanvjvynolltflw; production manfqmasfqppukpobpld; Netlify site be2bb95e-ba70-47f8-8d2d-70cd37b9b41a (circleoflifealf.com). Prior published deploy 6aaf08765b7bbcc5cc221b8b was recorded. Branch-specific preview credentials target staging; production contexts were preserved. Context setup follows Netlify's [branch environment rules](https://docs.netlify.com/build/environment-variables/overview/).

Pre-change function definitions, configuration tables and recovery markers are stored privately outside git. Production PITR is enabled with a current recovery window; staging has a completed physical backup. Migration 436–438 comments contain narrow rollback/containment DDL to suspend affected new commands while preserving clinical history. Forward correction is the data recovery path; never drop assignments/logs or rewrite applied migrations. Staging SQL probes leave no committed clinical fixtures.

Before production: final-head CI, verified staging application and backup/ledger parity. Publish schema before the matched frontend. Existing four workers and cron jobs are verified separately; HTTP enqueue success is not worker success or recipient receipt.

## Honest historical and operational limits

Before 436, shift history preserved enabled state but not every historical clock-bound change. New snapshots preserve all forward configuration. The baseline records known current settings; rollback to an older cadence does not invent unknown pre436 settings.

Spec section 11 clinical/operating decisions remain explicit in COL-490. No staff roster, numeric regulatory floor, alert-device subscription, provider receipt or human acceptance is invented. Source, SQL, browser and deployment evidence cannot close that acceptance issue.

## Local release gate

[Combined gate PASS](../test-results/agent-gates/2026-09-20T04-52-41-136Z-SMART-ROUNDING-CLOSEOUT-20260920.json): security, lint, 441-migration replay, 83 SQL probes, 7 acceptance suites, 105 parity cases, build, 18,000-row stress scenario, 8 synthetic component screenshots and 2 axe routes. Fresh lockfile-install application suite again passed 6,391 tests with2 skips; typecheck passed. The earlier failed gate is retained: Turbopack rejected the worktree dependency symlink, corrected by npm ci inside the isolated worktree. No product workaround was introduced.
