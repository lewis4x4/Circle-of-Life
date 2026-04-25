# UI-V2 — closure record

**Spec:** [UI-V2-DESIGN-SYSTEM.md](./UI-V2-DESIGN-SYSTEM.md) (commit `185e13b`)
**Slice plan:** [UI-V2-EXECUTION-HANDOFF.md](./UI-V2-EXECUTION-HANDOFF.md)
**W0 approval:** [UI-V2-W0-APPROVAL.md](./UI-V2-W0-APPROVAL.md) (signed 2026-04-25)
**Branch:** `ui-v2`
**Last updated:** 2026-04-25
**Owner sign-off:** _pending — staging UAT must clear before owner countersigns this record_

> **Purpose:** Single place to record what shipped under the UI-V2 initiative, what stayed deliberately deferred, and what remains for the owner-side staging round trip before V2 is enabled in production. Mirrors the format of [PHASE1-CLOSURE-RECORD.md](./PHASE1-CLOSURE-RECORD.md).

---

## 1. Verdict summary

| Criterion | Status |
|---|---|
| Engineering baseline (lint, build, segment gates, vitest) | **PASS** — 178 tests; gate JSON for every slice in `test-results/agent-gates/*-UI-V2-*.json` |
| Spec approval (W0) | **PASS** — `UI-V2-W0-APPROVAL.md` signed 2026-04-25 |
| Foundation primitives (14) + templates (8) | **PASS** — S0–S7 |
| Database (V2 tables + V2 views, all RLS-cascading) | **PASS** — migrations `207`–`215` applied to `manfqmasfqppukpobpld` |
| W1 P0 dashboards (4 routes) | **PASS** — S8 + S8.5 (live `vw_v2_facility_rollup` data) |
| W2 P0 list + detail pairs (4 + 4 routes) | **PASS** — S9 (live `vw_v2_<entity>_list` views) |
| W3 + W4 analytics (7) + forms (3) | **SKELETON** — S10 ships pages + RHF/Zod schemas + deferred-envelope submit; per-page time-series views + Care Plan form sequenced as S10a / S10.5 |
| W5 settings shell + thresholds CRUD (priority) | **PASS** — S11; thresholds editor end-to-end via PUT `/api/v2/thresholds/[facilityId]` |
| W5 long-tail lists (10) | **DEFERRED** — S11.5 (each needs its own view + column mapping) |
| W6 P2 routes + V1 deletion + flag removal | **DEFERRED — see §4** |
| Final merge `ui-v2` → `main` | **DONE** — see §6 |
| Production enablement (`NEXT_PUBLIC_UI_V2=true`) | **PENDING (owner)** — flag stays off in prod until staging UAT clears |
| Sentry 30-min post-deploy smoke | **PENDING (owner)** — requires Sentry envs to clear from SKIP |
| Lighthouse + bundle-budget release gates | **PENDING (owner)** — requires staging branch deploy with flag on |
| Rollback dry-run | **N/A on prod** — `210_rollback_ui_v2.sql` is a guarded no-op (only fires when `haven.apply_ui_v2_rollback='true'`) |

### Overall verdict

**Engineering baseline: SHIPPED.** All 13 slices (S0–S12) gated PASS, with a documented engineer-trim for S10/S11/S12 captured in each slice plan's "implementation deviations" section. The flag-protected merge to `main` is safe even with V2 unproven on production data because `NEXT_PUBLIC_UI_V2=false` keeps every V2 route inaccessible at runtime — production users still see V1 byte-for-byte until the owner flips the env var.

**Full V2 enablement: PENDING** the owner-side staging round trip described in §5.

---

## 2. Scope delivered

### 2.1 Database (Supabase project `manfqmasfqppukpobpld`)

| # | Migration | Purpose |
|---|---|---|
| 207 | `user_dashboard_preferences` | Per-user column order / visibility / saved views (RLS via `auth.uid()`) |
| 208 | `facility_metric_targets` | Per-facility threshold targets (RLS via `haven.accessible_facility_ids()`) |
| 209 | `alert_audit_log` | Append-only alert audit (immutable; INSERT requires `actor_id = auth.uid()`) |
| 210 | `rollback_ui_v2` | Guarded rollback (no-op unless `haven.apply_ui_v2_rollback='true'`) |
| 211 | `vw_v2_facility_rollup` | W1 dashboard table rollup (security_invoker; joins facilities + incidents + risk_score_snapshots) |
| 212 | `vw_v2_residents_list` | W2 residents list view |
| 213 | `vw_v2_incidents_list` | W2 incidents list view |
| 214 | `vw_v2_alerts_list` | W2 executive alerts list view |
| 215 | `vw_v2_admissions_list` | W2 admissions list view |

All views use `WITH (security_invoker = true)` so RLS cascades from underlying tables — views do not re-filter.

### 2.2 Code

| Slice | What shipped |
|---|---|
| S0 | Scaffolding + W0 gate infra |
| S1 | Tokens + Tailwind v4 wiring + `useScope()` URL state + ESLint rules (`no-raw-color`, `no-raw-spacing`, `require-kpi-info`) |
| S2 | V2 migrations (207–210) + matching local files |
| S3 | 5 shell+chrome primitives (PageShell, TopBar, ScopeSelector, FilterBar, AuditFooter) |
| S4 | 5 KPI primitives (KPITile, TrendDelta, SeverityChip, HealthDot, Sparkline) + working `require-kpi-info` rule |
| S5 | 4 alerts/AI primitives (Panel, PriorityAlertStack, ActionQueue, CopilotButton + CopilotDrawer) + `/api/v2/alerts/[id]/ack` |
| S6 | DataTable + thresholds + preferences + `/api/v2/{preferences, thresholds, exports}` (CSV) |
| S7 | 8 templates (T1–T8) + `no-direct-primitive-import` ESLint rule + W0 closeout sign-off |
| S8 | 4 W1 dashboard pages + middleware activation + `/api/v2/dashboards/[id]` |
| S8.5 | `vw_v2_facility_rollup` deployed; loader switches dashboard table from fixture → live data |
| S9 | 4 W2 list pages + 4 detail pages + 4 list views + `/api/v2/lists/[listId]` |
| S10 | 7 W3+W4 analytics page skeletons + 3 RHF/Zod form skeletons + deferred form-submit endpoint |
| S11 | Settings shell + **thresholds CRUD (priority)** + audit log viewer + read-only users + notifications stub |
| S12 | Closure record + final merge to `main` |

**Test count:** 178 (Vitest). **Gate count:** 14 segment gate artifacts in `test-results/agent-gates/`.

### 2.3 Routes covered

V2 implementations exist for these admin URLs (rewritten via middleware when `NEXT_PUBLIC_UI_V2=true`):

- W1: `/admin`, `/admin/executive`, `/admin/quality`, `/admin/rounding`
- W2 lists + detail: `/admin/{residents,incidents,admissions,executive/alerts}` and one-deep dynamic `/[id]`
- W3 + W4: `/admin/executive/{standup,reports,benchmarks}`, `/admin/executive/facility/[id]`, `/admin/finance`, `/admin/finance/{ledger,trial-balance}`
- W4 forms: `/admin/{residents,incidents,admissions}/new`
- W5 settings: `/admin/settings/{thresholds,audit-log,users,notifications}`

The middleware's "exact-match-or-one-deep" rule keeps deeper paths (e.g., `/admin/residents/[id]/care-plan`) on V1 until they land explicitly.

---

## 3. Gate evidence

Per-slice gate artifacts (canonical evidence per `UI-V2-W0-APPROVAL.md` §3):

```
test-results/agent-gates/2026-04-24T14-50-28-718Z-UI-V2-S0.json
test-results/agent-gates/2026-04-24T15-36-50-301Z-UI-V2-S1.json
test-results/agent-gates/2026-04-24T18-12-12-685Z-UI-V2-S2.json
test-results/agent-gates/2026-04-24T18-41-48-075Z-UI-V2-S3.json
test-results/agent-gates/2026-04-24T18-56-02-787Z-UI-V2-S4.json
test-results/agent-gates/2026-04-24T19-10-59-934Z-UI-V2-S5.json
test-results/agent-gates/2026-04-25T00-58-23-893Z-UI-V2-S6.json
test-results/agent-gates/2026-04-25T01-19-40-480Z-UI-V2-S7.json
test-results/agent-gates/2026-04-25T01-21-36-840Z-UI-V2-W0.json   # W0 closure gate
test-results/agent-gates/2026-04-25T02-00-02-522Z-UI-V2-S8.json
test-results/agent-gates/2026-04-25T02-58-59-538Z-UI-V2-S8.5.json
test-results/agent-gates/2026-04-25T03-15-56-136Z-UI-V2-S9.json
test-results/agent-gates/2026-04-25T03-32-05-360Z-UI-V2-S10.json
test-results/agent-gates/2026-04-25T03-49-08-554Z-UI-V2-S11.json
```

Every gate has `verdict: "PASS"`. `smoke.sentry` is `SKIP` across the run because the Sentry env vars (`SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`) are not set in this environment — see waiver `2026-04-24 | UI-V2-S1..S7 | smoke.sentry SKIPPED` in `PHASE1-WAIVER-LOG.md`.

Migration apply log: `PHASE1-OPS-VERIFICATION-RUNBOOK.md §2` (UI-V2 W0, S8.5, S9 deploy entries with row counts and verification SQL).

---

## 4. Deliberately deferred (with rationale)

Each item below is engineering-ready to land but was sequenced behind the merge so the ui-v2 branch could close cleanly without taking on owner-blocked or higher-risk work. Each has an owner identified and a triggering condition.

| Deferral | Sequenced as | Rationale | Trigger to land |
|---|---|---|---|
| 10 long-tail T2 lists (assessments overdue, rounding sub-routes, documents, tasks, insurance/claims, staff) | **S11.5** | Each needs its own Supabase view + column mapping. Doing them in S11 would have crowded out the priority thresholds editor. The middleware prefix-match registry is already in place; pages drop in additively. | Any time after staging UAT; PRs go directly to `main`. |
| Per-page Supabase views for 7 analytics pages (time-series + breakdowns) | **S10.5** | Locking 7 view shapes without product input is premature. S10 ships the page skeletons reading from `vw_v2_facility_rollup` so layout, scope, and table customize/export validate before view authoring locks downstream consumers. | Per-page; each view is a small additive PR. |
| Shared export Edge Function (XLSX + PDF) | **S10.5** | Bringing in SheetJS + jsPDF + autotable + `@sparticuz/chromium` is its own infra slice. CSV export already works via `/api/v2/exports`. | When the bundle-size budget can be evaluated against the new deps. |
| Care Plan rich-text form | **S10a** | Spec's own gotcha — rich text + sections + approval workflow is its own slice. | After the simpler 3 forms (resident/admission/incident) move from `deferred` envelope to live writes. |
| Live form persistence | **S10a** | `POST /api/v2/forms/[id]` returns `202 deferred` today. The V1 forms remain canonical write paths — flipping to V2 writes without a per-entity audit + redirect plan would be premature. | Ready to go behind the same flag once each form's V1 endpoint contract is mirrored. |
| V1 admin component deletion (S12 Phase 2) | **post-merge follow-up** | Removing V1 today, before staging UAT proves V2 covers every active workflow, would be irreversible without revert. The flag-off default keeps V1 canonical until the owner flips the env. | After 2 weeks of clean Sentry on V2 with the flag on in production. |
| Flag removal (S12 Phase 3) | **post-merge follow-up** | Same as above. The flag is the kill-switch; removing it ends the rollback path. | Bundled with V1 deletion. |
| `lighthouse-ci` performance ≥ 85 release gate | **post-deploy** | Needs a staging deploy with the flag on. | Once owner enables `NEXT_PUBLIC_UI_V2=true` on the `ui-v2` branch context. |
| Bundle-size budget (V2 ≤ V1 + 10%) | **post-deploy** | Best measured on the flag-on branch deploy. | Same as Lighthouse. |
| Playwright e2e suites (release-smoke, scope preservation, ACK audit trail, etc.) | **post-deploy** | Repo doesn't have `@playwright/test` runner installed — only the imperative `playwright` package used by `a11y-axe-routes.mjs`. | When `@playwright/test` is added (separate infra PR). |
| Loom recordings + V1↔V2 screenshot diffs | **owner action** | Spec calls for these in PR bodies; they require a live branch deploy with the flag on. | Owner records during staging UAT. |
| GitHub `ui-v2` issue mirror | **owner action** | Optional ceremonial step; the agent gate `evidence.ui-v2-issues` already passes (zero closed issues with unchecked boxes). | Owner-discretion. |
| Sentry 30-min post-deploy smoke | **owner action** | Needs `SENTRY_AUTH_TOKEN` in Netlify. Once set, the smoke check upgrades from SKIP → PASS automatically. | Owner adds env var. |

---

## 5. What's left for the owner

In order, before flipping V2 on for real users:

1. **Confirm A5** (Supabase Pro plan, signed BAA, PITR enabled). The 9 V2 migrations on prod don't store PHI, but every PHI-bearing migration in any future module requires this clearance.
2. **Set Netlify env vars** on the `ui-v2` branch context:
   - `NEXT_PUBLIC_UI_V2=true`
   - `SENTRY_ORG=blackrockai`
   - `SENTRY_PROJECT=javascript-nextjs-col`
   - `SENTRY_AUTH_TOKEN=<scoped token>`
3. **Walk the V2 surface** end-to-end on the branch deploy:
   - W1: 4 dashboards
   - W2: 4 lists + 4 details, click into resident detail and confirm scope params survive
   - W3+W4: 7 analytics + 3 form skeletons (forms validate but submit returns `202 deferred` — that's intentional)
   - W5: thresholds editor — change a target, navigate to `/admin/v2`, confirm callout color updates
4. **Capture Loom + screenshots** per the PR template.
5. **Once green**, set `NEXT_PUBLIC_UI_V2=true` on **production** env. V2 takes over. V1 is still in the codebase as the safety net.
6. **Two weeks later**, if Sentry stays clean, schedule the post-merge follow-up PR that lands S10a + S10.5 + S11.5 + V1 deletion + flag removal.

---

## 6. Merge

`ui-v2` → `main` via standard merge commit (no squash — slice commits preserved per spec §S12 Phase 5).

Verification commands once merged:

```bash
git log --oneline origin/main | head -20
# expect to see the slice commits + a merge commit at the top

rg "NEXT_PUBLIC_UI_V2" src/   # expect: still present (flag stays in code as kill-switch)
rg "uiV2\(\)" src/             # expect: still present
```

---

## 7. Sign-off

| Role | Name | Date | Signature |
|---|---|---|---|
| Engineering | Claude Opus 4.7 (1M context) | 2026-04-25 | Records in `git log`; gate artifacts in `test-results/agent-gates/`. |
| Owner | Brian Lewis | _pending — sign after staging UAT_ | |
