# PHASE_D_PLAN.md

Planning document for Phase D of the UI audit. Phase D closes the 97 DRIFT routes that survived Phases A–C and resolves three accumulated infrastructure items (seed drift, gitleaks fingerprint churn, screenshot harness lessons-learned).

**Status: PLANNING ONLY.** No code refactors land in the PR that introduces this document. Execution starts after explicit owner approval of the batches + codemods specified here.

## Background — why a planning PR

The original audit produced a **171-DRIFT undercount** because mid-execution scope expansion ("I'll clean up while I'm here") happened silently. Phase C avoided this by treating each portal as a discrete unit with a one-PR cadence. Phase D's 97 routes are too many for one-PR-each (PR-review noise floor) and too risky for one-PR-total (97-route diff is unreviewable). The planning PR is the artifact that lets the owner approve the batches + codemods _before_ they run, so "done" can't be silently redefined.

A check the owner can run on this document: every one of the 97 DRIFT routes must appear in the table at §3. If the count is anything other than 97, scope drift has already started.

## 1 · Three categories of work

| # | Category | Output | Status |
|---|----------|--------|--------|
| 1 | **D0 — Infrastructure** (seed repair, gitleaks migration, screenshot-harness consolidation) | 3 small dedicated PRs | Specified below in §5 |
| 2 | **D1 — Codemod sweep** (mechanical pattern stripping across all 97 routes in one PR) | 1 PR, large file count, near-zero per-file judgment | Specified in [PHASE_D_CODEMODS.md](./PHASE_D_CODEMODS.md) |
| 3 | **D2..Dn — Residue PRs** (per-group manual polishing of whatever the codemods couldn't clear) | ~6 PRs, batched per §4 | Estimated below in §6 |

The codemod sweep (D1) is the headline. Roughly 70 of the 97 routes are the same `moonshot/*` stub residue — one codemod clears them all. The residue PRs are where actual visual judgment happens.

## 2 · Pattern-frequency analysis

The Explore agent's hit-counts across the 97 routes:

| Pattern | Hits | Codemod candidate? | Notes |
|---------|-----:|--------------------|-------|
| `moonshot/*` import + `AmbientMatrix` + `MOONSHOT` comment | ~70 | Yes — strip-moonshot codemod (§D1.1) | These are dead imports referencing the already-defanged stub family in `src/components/ui/moonshot/*`. Removing the imports + their inline JSX usage is mechanical. |
| `bg-gradient-to-*` on chrome | ~20 | Yes — strip-gradient codemod (§D1.2) | Match `bg-gradient-to-{br,r,…}` in className and remove with a guard against legitimate uses (decorative blob backgrounds need their own audit). |
| `tracking-widest` | ~8 | Yes — rewrite codemod (§D1.3) | `tracking-widest text-[10px]` → `tracking-wider text-[11px]` per §11. |
| `font-display` | ~3 | Yes — strip codemod (§D1.4) | The alias resolves to Inter today; strip the className. |
| `rounded-3xl` / `rounded-[…]` on pages | ~6 | Yes — downsize codemod (§D1.5) | `rounded-3xl/[2rem]/[2.5rem]` on JSX outside `src/components/ui/` → `rounded-xl`. |
| `glass-*` utilities (route-page level) | ~5 | Yes — strip codemod (§D1.6) | Same logic as the shell-level removals from Phase C, just applied to page files. |
| `text-5xl/6xl/7xl` on KPI tiles | 2 | Manual — too few + judgment-heavy | Each instance is part of a hero-tile pattern with bespoke layout. |
| `bg-clip-text` + gradient text | 1 | Manual — single offender | `src/app/(admin)/reports/page.tsx`. |

Total mechanical clearance estimate: ~92 of 97 routes get their hit-list reduced or zeroed by D1's codemod sweep. The remaining 5 (text-5xl, gradient-text, plus any routes the codemods don't fully clear) become D2..Dn residue work.

## 3 · The 97 DRIFT routes

Sorted by group. Complexity rubric:

- **L (low)** — only `moonshot/*` import / `MOONSHOT` comment residue; D1 codemod sweep clears it entirely.
- **M (medium)** — codemod-clearable patterns plus one or two hand-rolled offenders that need per-page judgment (oversized text, gradient backgrounds, hand-rolled hero cards).
- **H (high)** — bespoke layout requiring manual refactor (resident detail pages, exec scenarios, the caregiver landing page with 4+ distinct card patterns).

Role coverage column reflects the new `Roles allowed:` lines from Phase C step 3. Owner-only routes are higher review priority since owner-role coverage was historically thin and the seed drift ledger still has an active entry against `milton.smith`.

### Admin (legacy shortcut) — 45 routes (roles: owner, org_admin, facility_admin, manager, admin_assistant, coordinator, nurse, maintenance_role, broker)

| Route | File | Complexity | D1 codemods | Residue batch |
|---|---|---|---|---|
| `/assessments/overdue` | `src/app/(admin)/assessments/overdue/page.tsx` | L | strip-moonshot | — |
| `/billing/ar-aging` | `src/app/(admin)/billing/ar-aging/page.tsx` | M | strip-moonshot, rewrite-tracking | D-finance |
| `/billing/collections` | `src/app/(admin)/billing/collections/page.tsx` | L | strip-moonshot | — |
| `/billing/invoices/[id]` | `src/app/(admin)/billing/invoices/[id]/page.tsx` | L | strip-moonshot | — |
| `/billing/org-ar-aging` | `src/app/(admin)/billing/org-ar-aging/page.tsx` | L | strip-moonshot | — |
| `/billing/rates` | `src/app/(admin)/billing/rates/page.tsx` | L | strip-moonshot | — |
| `/billing/revenue` | `src/app/(admin)/billing/revenue/page.tsx` | L | strip-moonshot | — |
| `/certifications` | `src/app/(admin)/certifications/page.tsx` | M | strip-moonshot, rewrite-tracking | D-workforce |
| `/executive/alerts` | `src/app/(admin)/executive/alerts/page.tsx` | L | strip-moonshot | — |
| `/executive/cfo` | `src/app/(admin)/executive/cfo/page.tsx` | M | strip-moonshot, strip-gradient | D-command |
| `/executive/coo` | `src/app/(admin)/executive/coo/page.tsx` | M | strip-moonshot, strip-gradient | D-command |
| `/executive/nlq` | `src/app/(admin)/executive/nlq/page.tsx` | M | strip-moonshot, strip-gradient | D-command |
| `/executive/scenarios` | `src/app/(admin)/executive/scenarios/page.tsx` | H | strip-moonshot, strip-gradient | D-command |
| `/executive/standup/[week]/board` | `src/app/(admin)/executive/standup/[week]/board/page.tsx` | M | strip-gradient | D-command |
| `/executive/standup/history` | `src/app/(admin)/executive/standup/history/page.tsx` | L | rewrite-tracking | — |
| `/finance/journal-entries` | `src/app/(admin)/finance/journal-entries/page.tsx` | L | strip-moonshot | — |
| `/finance/ledger` | `src/app/(admin)/finance/ledger/page.tsx` | L | strip-moonshot | — |
| `/incidents/new` | `src/app/(admin)/incidents/new/page.tsx` | M | strip-gradient | D-quality-risk |
| `/incidents/trends` | `src/app/(admin)/incidents/trends/page.tsx` | M | strip-moonshot, strip-gradient | D-quality-risk |
| `/insurance` | `src/app/(admin)/insurance/page.tsx` | L | strip-moonshot | — |
| `/insurance/claims` | `src/app/(admin)/insurance/claims/page.tsx` | L | strip-moonshot | — |
| `/insurance/policies` | `src/app/(admin)/insurance/policies/page.tsx` | L | strip-moonshot | — |
| `/insurance/renewals` | `src/app/(admin)/insurance/renewals/page.tsx` | L | strip-moonshot | — |
| `/payroll` | `src/app/(admin)/payroll/page.tsx` | L | strip-moonshot | — |
| `/reports` | `src/app/(admin)/reports/page.tsx` | H | strip-moonshot, strip-gradient, manual-gradient-text | D-command |
| `/reports/admin` | `src/app/(admin)/reports/admin/page.tsx` | L | strip-moonshot | — |
| `/reports/benchmarks` | `src/app/(admin)/reports/benchmarks/page.tsx` | L | strip-moonshot | — |
| `/reports/history` | `src/app/(admin)/reports/history/page.tsx` | L | strip-moonshot | — |
| `/reports/packs` | `src/app/(admin)/reports/packs/page.tsx` | L | strip-moonshot | — |
| `/reports/saved` | `src/app/(admin)/reports/saved/page.tsx` | L | strip-moonshot | — |
| `/reports/scheduled` | `src/app/(admin)/reports/scheduled/page.tsx` | L | strip-moonshot | — |
| `/reports/templates` | `src/app/(admin)/reports/templates/page.tsx` | L | strip-moonshot | — |
| `/reputation` | `src/app/(admin)/reputation/page.tsx` | L | strip-moonshot | — |
| `/residents/[id]` | `src/app/(admin)/residents/[id]/page.tsx` | M | strip-gradient | D-clinical |
| `/residents/[id]/billing` | `src/app/(admin)/residents/[id]/billing/page.tsx` | L | strip-moonshot | — |
| `/residents/[id]/care-plan` | `src/app/(admin)/residents/[id]/care-plan/page.tsx` | L | strip-moonshot | — |
| `/schedules/[id]` | `src/app/(admin)/schedules/[id]/page.tsx` | L | strip-moonshot | — |
| `/staff/[id]` | `src/app/(admin)/staff/[id]/page.tsx` | M | strip-moonshot, strip-gradient | D-workforce |
| `/time-records` | `src/app/(admin)/time-records/page.tsx` | L | strip-moonshot | — |
| `/training` | `src/app/(admin)/training/page.tsx` | L | strip-moonshot | — |
| `/transportation` | `src/app/(admin)/transportation/page.tsx` | L | strip-moonshot | — |
| `/transportation/calendar` | `src/app/(admin)/transportation/calendar/page.tsx` | L | strip-moonshot | — |
| `/transportation/mileage-approvals` | `src/app/(admin)/transportation/mileage-approvals/page.tsx` | L | strip-moonshot | — |
| `/transportation/settings` | `src/app/(admin)/transportation/settings/page.tsx` | M | strip-gradient | D-command |
| `/vendors` | `src/app/(admin)/vendors/page.tsx` | M | strip-moonshot, strip-gradient | D-finance |

### Caregiver — 12 routes (roles: caregiver, housekeeper)

| Route | File | Complexity | D1 codemods | Residue batch |
|---|---|---|---|---|
| `/caregiver` | `src/app/(caregiver)/caregiver/page.tsx` | H | strip-gradient, strip-font-display, strip-text-5xl | D-caregiver |
| `/caregiver/rounds` | `src/app/(caregiver)/caregiver/rounds/page.tsx` | M | strip-font-display | D-caregiver |
| `/caregiver/schedules` | `src/app/(caregiver)/caregiver/schedules/page.tsx` | M | strip-gradient | D-caregiver |
| `/clock` | `src/app/(caregiver)/clock/page.tsx` | M | strip-gradient | D-caregiver |
| `/followups` | `src/app/(caregiver)/followups/page.tsx` | M | strip-gradient, rewrite-tracking | D-caregiver |
| `/handoff` | `src/app/(caregiver)/handoff/page.tsx` | M | strip-gradient | D-caregiver |
| `/incident-draft` | `src/app/(caregiver)/incident-draft/page.tsx` | M | strip-gradient | D-caregiver |
| `/me` | `src/app/(caregiver)/me/page.tsx` | M | strip-gradient | D-caregiver |
| `/meds` | `src/app/(caregiver)/meds/page.tsx` | M | downsize-rounded, rewrite-tracking, strip-glass | D-caregiver |
| `/prn-followup` | `src/app/(caregiver)/prn-followup/page.tsx` | M | strip-gradient, rewrite-tracking | D-caregiver |
| `/resident/[id]` | `src/app/(caregiver)/resident/[id]/page.tsx` | H | strip-gradient | D-caregiver |
| `/tasks` | `src/app/(caregiver)/tasks/page.tsx` | M | strip-gradient, rewrite-tracking, strip-glass | D-caregiver |

Caregiver routes are all in one batch (12 routes, ~one PR) because they share the hover/active migration plus the dark/zinc cleanup. Hover/active is the carry-over from the Phase C step 4 CI guardrail (still scoped narrowly to the shell — D-caregiver expands the scope to the route group as the spec promised).

### Clinical Ops — 15 routes (roles: same as admin)

| Route | File | Complexity | D1 codemods | Residue batch |
|---|---|---|---|---|
| `/admin/dietary` | `src/app/(admin)/admin/dietary/page.tsx` | L | strip-moonshot | — |
| `/admin/dietary/clinical-review` | `src/app/(admin)/admin/dietary/clinical-review/page.tsx` | L | strip-moonshot | — |
| `/admin/medications/verbal-orders/new` | `src/app/(admin)/admin/medications/verbal-orders/new/page.tsx` | M | strip-gradient | D-clinical |
| `/admin/residents/[id]/assessments` | `src/app/(admin)/admin/residents/[id]/assessments/page.tsx` | L | strip-moonshot | — |
| `/admin/residents/[id]/medications` | `src/app/(admin)/admin/residents/[id]/medications/page.tsx` | L | strip-moonshot | — |
| `/admin/residents/[id]/vitals` | `src/app/(admin)/admin/residents/[id]/vitals/page.tsx` | L | strip-moonshot | — |
| `/admin/rounding` | `src/app/(admin)/admin/rounding/page.tsx` | M | strip-moonshot, strip-gradient | D-clinical |
| `/admin/rounding/escalations` | `src/app/(admin)/admin/rounding/escalations/page.tsx` | L | strip-moonshot | — |
| `/admin/rounding/insights` | `src/app/(admin)/admin/rounding/insights/page.tsx` | M | strip-moonshot, strip-gradient | D-clinical |
| `/admin/rounding/integrity` | `src/app/(admin)/admin/rounding/integrity/page.tsx` | L | strip-moonshot | — |
| `/admin/rounding/live` | `src/app/(admin)/admin/rounding/live/page.tsx` | M | strip-moonshot, strip-gradient | D-clinical |
| `/admin/rounding/plans` | `src/app/(admin)/admin/rounding/plans/page.tsx` | L | strip-moonshot | — |
| `/admin/rounding/reports` | `src/app/(admin)/admin/rounding/reports/page.tsx` | L | strip-moonshot | — |
| `/admin/rounding/safety` | `src/app/(admin)/admin/rounding/safety/page.tsx` | M | strip-moonshot, strip-gradient | D-clinical |
| `/admin/rounding/watches` | `src/app/(admin)/admin/rounding/watches/page.tsx` | L | strip-moonshot | — |

### Quality & Risk — 6 routes (roles: same as admin)

| Route | File | Complexity | D1 codemods | Residue batch |
|---|---|---|---|---|
| `/admin/compliance/deficiencies/analysis` | `src/app/(admin)/admin/compliance/deficiencies/analysis/page.tsx` | L | strip-moonshot | — |
| `/admin/compliance/policies` | `src/app/(admin)/admin/compliance/policies/page.tsx` | L | strip-moonshot | — |
| `/admin/compliance/scan` | `src/app/(admin)/admin/compliance/scan/page.tsx` | M | strip-text-5xl | D-quality-risk |
| `/admin/infection-control` | `src/app/(admin)/admin/infection-control/page.tsx` | L | strip-moonshot | — |
| `/admin/infection-control/staff-illness` | `src/app/(admin)/admin/infection-control/staff-illness/page.tsx` | L | strip-moonshot | — |
| `/admin/quality` | `src/app/(admin)/admin/quality/page.tsx` | L | strip-moonshot | — |

### Pipeline — 8 routes (roles: same as admin)

| Route | File | Complexity | D1 codemods | Residue batch |
|---|---|---|---|---|
| `/admin/admissions` | `src/app/(admin)/admin/admissions/page.tsx` | L | strip-moonshot | — |
| `/admin/admissions/[id]` | `src/app/(admin)/admin/admissions/[id]/page.tsx` | L | strip-moonshot | — |
| `/admin/discharge` | `src/app/(admin)/admin/discharge/page.tsx` | L | strip-moonshot | — |
| `/admin/family-messages` | `src/app/(admin)/admin/family-messages/page.tsx` | L | strip-moonshot | — |
| `/admin/family-portal` | `src/app/(admin)/admin/family-portal/page.tsx` | L | strip-moonshot | — |
| `/admin/referrals` | `src/app/(admin)/admin/referrals/page.tsx` | L | strip-moonshot | — |
| `/admin/referrals/hl7-inbound` | `src/app/(admin)/admin/referrals/hl7-inbound/page.tsx` | L | strip-moonshot | — |
| `/admin/referrals/sources` | `src/app/(admin)/admin/referrals/sources/page.tsx` | L | strip-moonshot | — |

### Workforce — 1 route (roles: same as admin)

| Route | File | Complexity | D1 codemods | Residue batch |
|---|---|---|---|---|
| `/admin/shift-swaps` | `src/app/(admin)/admin/shift-swaps/page.tsx` | M | strip-moonshot, rewrite-tracking | D-workforce |

### Command — Settings — 2 routes (roles: same as admin)

| Route | File | Complexity | D1 codemods | Residue batch |
|---|---|---|---|---|
| `/admin/facilities` | `src/app/(admin)/admin/facilities/page.tsx` | L | strip-moonshot | — |
| `/admin/facilities/[facilityId]` | `src/app/(admin)/admin/facilities/[facilityId]/page.tsx` | L | strip-moonshot | — |

### Family — 5 routes (role: family)

| Route | File | Complexity | D1 codemods | Residue batch |
|---|---|---|---|---|
| `/family` | `src/app/(family)/family/page.tsx` | M | strip-gradient | D-family |
| `/family/billing` | `src/app/(family)/family/billing/page.tsx` | M | downsize-rounded, strip-glass | D-family |
| `/family/calendar` | `src/app/(family)/family/calendar/page.tsx` | M | downsize-rounded, rewrite-tracking, strip-glass | D-family |
| `/family/care-plan` | `src/app/(family)/family/care-plan/page.tsx` | M | downsize-rounded, rewrite-tracking | D-family |
| `/family/messages` | `src/app/(family)/family/messages/page.tsx` | L | (MOONSHOT comment only — codemod still strips) | — |

Family routes also pick up the hover-without-active migration carried over from Phase C step 5.

### Marketing / Auth — 1 route (role: public)

| Route | File | Complexity | D1 codemods | Residue batch |
|---|---|---|---|---|
| `/login` | `src/app/login/page.tsx` | M | strip-gradient | D-marketing |

### Other — 2 routes

| Route | File | Complexity | D1 codemods | Residue batch |
|---|---|---|---|---|
| `/admin/feedback` | `src/app/(admin)/admin/feedback/page.tsx` | L | rewrite-tracking | — |
| `/search` | `src/app/(admin)/search/page.tsx` | M | strip-gradient | D-command |

### Count check

- Admin (legacy shortcut): 45
- Caregiver: 12
- Clinical Ops: 15
- Quality & Risk: 6
- Pipeline: 8
- Workforce: 1
- Command — Settings: 2
- Family: 5
- Marketing / Auth: 1
- Other: 2

**Total: 97.** Matches ROUTE_COVERAGE.md.

## 4 · Residue PR batches

After the D1 codemod sweep, the routes marked with a residue-batch column above need manual polish. Batches are sized at ≤15 routes / ≤400 LOC each so any one PR is review-able in a single sitting.

| Batch | Routes | Group | Why this boundary |
|-------|-------:|-------|--------------------|
| D-clinical | ~7 | Clinical Ops + 1 admin resident page | Shared concern: removing dashboard gradients from clinical hero cards, consolidating rounding-page chrome. |
| D-quality-risk | ~3 | Quality & Risk | Small batch; couples the `/admin/compliance/scan` `text-5xl` migration with the incident gradient cleanup. |
| D-workforce | ~3 | Workforce + admin staff + certifications | Coupled because all three lift the same legacy bg-gradient + tracking-widest pattern from per-page hero cards. |
| D-finance | ~3 | Finance + vendors + AR aging | Coupled because all three lift the same AR-aging-bucket header chrome. |
| D-command | ~8 | Command Executive + standup + reports + transportation/settings + search | The most heterogeneous batch; couples the exec-dashboard gradient cleanup, the reports hero (with `bg-clip-text`), and the standup-board gradient. Borderline on the 15-route ceiling; may split if individual reviews are heavy. |
| D-caregiver | 12 | Caregiver route group | All 12 caregiver routes carry hover/active migration + zinc/slate cleanup; one coherent batch. |
| D-family | 4 | Family route group | All `glass-card-light` + `rounded-[2rem]` residue inherited from the original moonshot dock. |
| D-marketing | 1 | `/login` | The only public-facing route; isolated for safety. |

**Estimated residue PR count: 8 PRs.** Each is reviewable in 15–30 minutes; the entire batched cycle is a working week of focused review time. If any batch hits the 15-route / 400-LOC ceiling, it splits — labeling stays consistent (`D-clinical-1`, `D-clinical-2`).

## 5 · D0 — Infrastructure PRs

The codemod sweep depends on solid screenshot infrastructure (so the visual gates work), reliable seed accounts (so role-based baselines are meaningful), and a stable secret-scanner (so per-batch fingerprint churn doesn't drown out real findings). Three small dedicated PRs land first.

### D0a — `chore(seed): repair caregiver and owner test fixtures`

**Problem.** `docs/ui-audit/SEED_DRIFT.md` carries two active entries:

- `milton.smith@circleoflifealf.com` — owner. Repaired ad-hoc during Phase A via service-role admin reset, not codified in a migration. Could drift again.
- `james.thompson@circleoflifealf.com` — caregiver. Still drifted; Phase C step 4 captured baselines as `maria.garcia` instead.

Phase D's per-batch role-based screenshots require both accounts to authenticate reliably. Without this fix, the role column in ROUTE_COVERAGE.md becomes meaningless again.

**Plan.**

1. Investigate why each seed drifted. Likely candidates: migration replay order, post-seed admin reset that didn't persist, password-hash mismatch between `auth.users` and `auth.identities`.
2. Add a deterministic repair: either a new migration that resets both passwords idempotently at apply time, or a `scripts/seed/repair-demo-auth.mjs` that runs against the live project via service-role API. Prefer the migration if it can be made idempotent; otherwise the script + a one-line `npm run` target.
3. Add `scripts/seed/verify-auth-fixtures.mjs` — authenticates every seeded role against `HavenDemo2026!` (or the env-overridden equivalent) and asserts each lands on the correct shell route after sign-in. Exit non-zero on any failure.
4. Wire `seed:verify` into `.github/workflows/ci-ui-gates.yml` as a non-blocking informational check first (give it one or two CI cycles to stabilize), then promote to blocking.
5. Update `SEED_DRIFT.md`: move both entries from "Active drift" to "Resolved drift" with the repair commit SHA and date.

**Acceptance.** `npm run seed:verify` reports OK for all seeded roles (owner, org_admin, facility_admin, manager, nurse, caregiver, housekeeper, dietary, med_tech, family, onboarding). `SEED_DRIFT.md` "Active drift" section is empty.

### D0b — `chore(ci): migrate gitleaks to path-scoped .gitleaks.toml allowlist`

**Problem.** `.gitleaksignore` is at **46 lines** of accumulated commit-SHA fingerprints across 5 separate merge SHAs — all for the same `{ metricKey: "…", value: … }` false-positive in `src/lib/reports/executors/index.ts`. Every Phase D codemod PR will touch some file and re-trigger the same noise. Continuing the per-fingerprint pattern will push the ignorefile past 100 lines and bury any real leak in the noise floor — exactly the failure mode the TODO header at the top of `.gitleaksignore` calls out.

**Plan.**

1. Create `.gitleaks.toml` (the repo already references it via `scripts/run-gitleaks.mjs` `--config`). Add a path-scoped allowlist:

```toml
[[allowlists]]
description = "AR aging / shift coverage / compliance survey metric-key constants — generic-api-key matches on entropy alone (audit issue, not a leak)."
paths = [
  '''src/lib/reports/executors/index\.ts'''
]
```

2. Delete all 46 lines from `.gitleaksignore` and replace with a header explaining the migration (one line: "False positives are now path-scoped in `.gitleaks.toml`. See that file for the current allowlist.").
3. Remove the inline `// Metric keys — scanner false positive, see .gitleaksignore` breadcrumb comments from `executors/index.ts` since they referenced the old file (or update them to point at `.gitleaks.toml`).
4. Validate: run `npm run secrets:gitleaks` locally; CI's docker-image run on the next PR confirms.

**Out of scope for D0b.** The `HavenDemo2026!` GitGuardian false-positive — owner already chose to mark it False Positive in the GitGuardian dashboard. If Phase D rotates the demo password, the script fallbacks need to be removed at the same time; this is a separate concern.

**Acceptance.** `.gitleaksignore` ≤ 5 lines (the migration header only). `.gitleaks.toml` has path-scoped allowlists for the known false positives. `npm run secrets:gitleaks` clean. The next PR after this one doesn't add any new `.gitleaksignore` fingerprints.

### D0c — `chore(audit): consolidate screenshot harness + document safe-area technique`

**Problem.** Phase C produced three screenshot scripts:

- `scripts/screenshot-dashboard.mjs` — the general harness with `ROUTES_JSON` / `VIEWPORTS_JSON` / `SETTLE_MS` env overrides
- `scripts/screenshot-caregiver-iphone-safe-area.mjs` — one-off for the iPhone home-indicator simulation
- (Plus the role-fallback workaround pattern in the medtech README that didn't get codified.)

The iPhone safe-area CSS-injection technique is engineering worth preserving. It currently lives only in a one-off script with explanatory comments — the next person who needs to baseline a safe-area interaction will rediscover the technique from scratch. Owner specifically flagged this for documentation.

**Plan.**

1. Add an `INJECT_STYLE_BEFORE_SCREENSHOT` env override to `scripts/screenshot-dashboard.mjs` that takes a raw CSS string and runs `page.addStyleTag({ content })` after `goto` + `networkidle`. The iPhone safe-area capture becomes a one-line wrapper invocation.
2. Delete `scripts/screenshot-caregiver-iphone-safe-area.mjs` (the technique now lives in the shared harness).
3. Update the existing Caregiver baseline README to point at the new shared invocation.
4. Add a `## Safe-area inset simulation` section to a new doc — recommendation: a short `docs/ui-audit/SCREENSHOT_HARNESS.md` covering all four env knobs (`ROUTES_JSON`, `VIEWPORTS_JSON`, `SETTLE_MS`, `INJECT_STYLE_BEFORE_SCREENSHOT`), the auth-cookie injection technique, and the safe-area workaround. Cross-reference from the §14 forced-theme verification note in `DESIGN_PRINCIPLES.md`.

**Acceptance.** Single screenshot script with all four env overrides. Caregiver iPhone safe-area capture reproducible from the shared harness. `SCREENSHOT_HARNESS.md` documents the technique.

## 6 · PR sequence summary

| # | PR | Type | Estimated diff | Owner review effort |
|---|----|------|----------------|---------------------|
| 0 | (this) Phase D planning PR | docs only | ~600 LOC across 2 new docs + 1 line in DESIGN_PRINCIPLES.md | 20-30 min |
| 1 | D0a — seed repair | infra | ~150 LOC (1 migration / script + 1 verify script + CI wiring) | 15 min |
| 2 | D0b — gitleaks .gitleaks.toml migration | infra | ~50 LOC (1 new toml + ignorefile delete + breadcrumb cleanup) | 10 min |
| 3 | D0c — screenshot harness consolidation | infra | ~100 LOC (env override + script merge + new doc) | 10 min |
| 4 | D1 — codemod sweep across 97 routes | mechanical | LARGE (potentially 1000+ LOC across 90+ files) but mechanical | 45-60 min |
| 5 | D2 — D-clinical residue | manual | ~300 LOC across 8 routes | 30 min |
| 6 | D3 — D-quality-risk residue | manual | ~100 LOC across 3 routes | 15 min |
| 7 | D4 — D-workforce residue | manual | ~100 LOC across 3 routes | 15 min |
| 8 | D5 — D-finance residue | manual | ~100 LOC across 3 routes | 15 min |
| 9 | D6 — D-command residue | manual | ~250 LOC across 8 routes (may split) | 30 min |
| 10 | D7 — D-caregiver residue | manual | ~400 LOC across 12 routes | 45 min |
| 11 | D8 — D-family residue | manual | ~150 LOC across 4 routes | 20 min |
| 12 | D9 — D-marketing (`/login`) residue | manual | ~50 LOC | 10 min |

**Total estimated review effort across Phase D: ~5 hours of focused review time** spread across ~12 PRs.

After D1 (codemod sweep) lands, ROUTE_COVERAGE.md regenerates. The expectation is the DRIFT count drops from 97 to roughly 20–30 — what remains is the bespoke manual work in D2..D9.

## 7 · Stop conditions

Conditions under which Phase D execution pauses for owner review before the next PR ships:

- D1 codemod sweep mutates a file count materially higher than the ~90 routes targeted by the codemods. (Indicates a codemod over-matched and is touching files outside scope — same failure as the original regex SYS-strip sweep that broke 57 builds.)
- D1 codemod sweep fails to clear a route the plan said it would. (Indicates the codemod under-matched; fix the codemod, do not patch around it manually in the residue PR.)
- Any residue PR exceeds 15 routes or 400 LOC. (Split it; the cadence depends on bite-sized review.)
- ROUTE_COVERAGE.md classifier reports a new DRIFT category not anticipated in §3 above. (Indicates an existing route regressed; investigate, do not silently re-classify.)
- The seed-verify CI check fails in a way that suggests broader auth-infra drift than the two known accounts. (Pause; broader auth drift is its own investigation.)

Each stop condition surfaces as an explicit "STOP" comment in the PR description with the trigger and the proposed next step.

## 8 · What Phase D explicitly does not address

To prevent scope creep, this plan lists the things Phase D leaves for Phase E or later:

- **Moonshot family deletion.** Phase D strips `moonshot/*` _imports_ from the 97 DRIFT routes; the stub files themselves (`src/components/ui/moonshot/{v2-card,sparkline,ambient-matrix,kinetic-grid,pulse-dot}.tsx`) remain. Deletion ships in Phase E once import counts hit zero. The audit-defanged stubs do no harm.
- **`HavenDemo2026!` rotation.** Demo password remains. If/when Phase E rotates it, the script fallbacks need to be removed at the same time.
- **Authenticated axe / visual regression CI gates currently in `skipping` state.** These are wired but not running. Phase E (or a separate infra ticket) decides what unblocks them.
- **Marketing site / landing-home.tsx.** Has its own moonshot residue (`rounded-[2rem]`, `bg-gradient`). The `/login` page is in this plan because it's an auth-flow route; the marketing site routes (`/`, `/facility-launch*`) are explicitly out of scope.
- **Route-page hover/active migration outside caregiver + family.** The hover/active touch-pairing CI guardrails are scoped narrowly per Phase C — broadening them to admin route pages is a separate concern. Phase D does not touch the admin scope of that rule.

## 9 · Acceptance for this planning PR

This PR introduces only documentation. The change list is:

- `docs/ui-audit/PHASE_D_PLAN.md` (this file)
- `docs/ui-audit/PHASE_D_CODEMODS.md` (sibling)
- `docs/ui-audit/DESIGN_PRINCIPLES.md` — one-line addition to §14 capturing the "visual identity IS the regression gate" framing from the Phase C closeout report

No code refactors. No CI rule changes. No source-file mutations.

Owner reviews + approves; Phase D execution begins with D0a (seed repair) as a separate PR.
