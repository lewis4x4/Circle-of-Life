# Homewood Launch — /goal Handoff Brief

> This file is the canonical brief for the Homewood Go-Live `/goal` execution. The original /goal body exceeded the 4000-char slash-command limit, so it lives here. To kick off, paste a short `/goal` referencing this file (e.g. "Execute the Homewood Go-Live plan in `HANDOFFS/HOMEWOOD-LAUNCH.md`. Begin Sprint 1. Halt before opening the Sprint 1 PR for user review.").

---

## Goal — Homewood Go-Live readiness (4-week timeline)

Real customer launch. The UI audit (Phases A→D) is complete and DRIFT = 0. Homewood facility data is already loaded into Supabase via the onboarding flow. User accounts with roles are provisioned. The launch deadline is 4 weeks from today.

**Out of scope:** visual design work, additional UI cleanup, importing new data, training materials.

**In scope:** everything code-side that protects the launch.

Execute the six sprints below in order. Each sprint ships as a single PR, merged via `gh pr merge <N> --merge --admin` before the next sprint begins. Each sprint ends with a `[SPRINT N COMPLETE]` block in the transcript stating: PR number, merge SHA, files changed count, what was verified, and any anomalies surfaced for the user. Do not auto-proceed between sprints — pause for the user's "go" between each.

### Halt conditions (immediate stop + report)

- A sprint's verification script surfaces data anomalies the user needs to triage
- Build, lint, or typecheck breaks and the fix is non-obvious
- An RLS policy change would affect production data
- A test reveals a real bug in a critical workflow
- File-count or LOC of any PR exceeds 2x the estimate

### Final goal acceptance

- All 6 sprints have `[SPRINT N COMPLETE]` blocks
- All 6 PRs merged to main
- `npm run typecheck` exits 0
- `npm run lint` exits 0
- `npm run build` exits 0
- `npm run homewood:preflight` (built in Sprint 6) exits 0 and produces `docs/homewood/GO_LIVE_REPORT.md`
- Output `[GOAL COMPLETE]` in the final turn

---

## Sprint 1 — Homewood data audit

Build verification tooling for what's already in Supabase. No data changes — read-only.

**Deliverables:**
- `scripts/homewood/data-audit.mjs` — queries Supabase, produces per-table gap report
- `docs/homewood/DATA_AUDIT.md` — regenerable, datestamped output
- `package.json` script: `homewood:audit`

**The audit must detect and count:**
- Residents without assigned rooms
- Residents without active care plans
- Residents without primary diagnoses
- Residents without medication schedules
- Residents without family relationships
- Residents with admission dates in the future or > 50 years past (data sanity)
- Staff without role assignments
- Staff without certifications where required (CNA, med-tech, nurse roles)
- Staff without facility assignments
- Family accounts without resident links
- Family accounts where the linked resident is discharged or deceased
- Medications without dosage or frequency
- Care plans without review dates or with review dates > 90 days stale
- Incidents without resolution status where created > 30 days ago
- Any orphaned foreign keys (resident_id pointing at nonexistent rows, etc.)

**Output format:** markdown report with a summary table at top (Anomaly | Count | Severity | Sample IDs), then per-anomaly sections with up to 5 sample row IDs each. Severity scale: CRITICAL (launch-blocker), HIGH (fix before launch), MEDIUM (fix in first 2 weeks), LOW (track).

Scope to Homewood Lodge ALF only via `facility_id` filter. Do not query other facilities.

**Acceptance:**
- `npm run homewood:audit` exits 0 and writes the markdown file
- Report renders cleanly in GitHub
- Every anomaly category has a count (zero is fine, missing is not)
- No data is mutated

Do not fix any anomalies surfaced. The user reviews findings between Sprints 1 and 2.

---

## Sprint 2 — Homewood auth verification

Adapt the existing `scripts/seed/verify-auth-fixtures.mjs` infrastructure for real Homewood accounts. Read-only verification.

**Deliverables:**
- `scripts/homewood/auth-verify.mjs`
- `docs/homewood/AUTH_VERIFICATION.md`
- `package.json` script: `homewood:verify-auth`
- `.github/workflows/ci-gates.yml` updated to run `homewood:verify-auth` in addition to the existing demo seed verify, gated on the same `vars.HAVEN_UI_GATES_ENABLED` flag

**The verification must:**
- Query `auth.users` joined with the role/facility tables for accounts where the facility is Homewood Lodge ALF
- For each account, attempt sign-in using the password stored in `HOMEWOOD_LAUNCH_PASSWORD` env (assume the user will set this secret separately — fail loudly with a clear message if missing)
- For each successful sign-in, confirm the session resolves to the expected `app_role`
- For each role, confirm the user can fetch their landing route (owner → `/admin/command`, facility_admin → `/admin/command` with facility scoped, caregiver → `/caregiver`, family → `/family`, medtech → `/med-tech`, dietary → `/dietary`, etc.)
- Report PASS/FAIL per account with reason on FAIL

**Output:** per-role pass/fail summary at top, per-account detail below, total pass count vs. expected count.

If `HOMEWOOD_LAUNCH_PASSWORD` is not set, the script fails with: `[homewood:verify-auth] FAIL: HOMEWOOD_LAUNCH_PASSWORD not set. Configure repo secret or local .env to verify Homewood accounts.`

**CI wiring:** the new step runs after the existing seed:verify step. CI gate stays dormant until launch day per the existing `vars.HAVEN_UI_GATES_ENABLED` flag.

**Acceptance:**
- `npm run homewood:verify-auth` runs locally if the secret is set; fails clearly if not
- CI workflow updated and the file passes yaml lint
- `AUTH_VERIFICATION.md` written and committed (with whatever the current local run produces, redact actual passwords)
- No production credentials committed

---

## Sprint 3 — Critical workflow integration tests

Build automated end-to-end tests for the 7 must-have launch workflows. Playwright. Run against the real Homewood data in the dev/staging Supabase project.

**Workflows to cover:**
1. Caregiver opens shift → sees their resident assignments → completes one ADL documentation entry → saves
2. Caregiver reports a minor incident → form submits → incident appears in management queue
3. Med-tech opens med pass → marks one med as given, one as refused → submission persists
4. Management views Homewood daily census → numbers match what data-audit reported
5. Management opens a specific resident → updates one care plan field → saves → version history shows update
6. Family logs in → sees their loved one's profile → sees most recent activity entry
7. Owner views Homewood facility → can drill into resident roster → can drill into a specific resident

**Deliverables:**
- `tests/homewood-launch/` directory with 7 spec files (one per workflow)
- `playwright.homewood.config.ts` — config pointing at the dev/staging environment, using one canonical test account per role
- `package.json` script: `homewood:test-launch`
- `docs/homewood/LAUNCH_WORKFLOW_TESTS.md` — describes each test, what it asserts, what failure means

**Tests must:**
- Use real Homewood accounts (canonical roster from Sprint 2)
- Operate against real Homewood data (do not seed test data)
- Be idempotent — running twice does not create stale state
- Clean up after themselves (revert any mutations made during the test)
- Output structured results readable by humans and CI

Each test that requires mutating data (ADL entry, incident submission, med pass, care plan update) must wrap mutations in a try/finally that cleans up. Use distinct test-only identifiers in mutated rows so cleanup is deterministic.

**CI wiring:** new workflow `.github/workflows/homewood-launch-tests.yml` that runs `homewood:test-launch` on PRs touching `src/`, gated on `vars.HAVEN_UI_GATES_ENABLED`. Dormant by default.

**Acceptance:**
- All 7 tests pass locally
- Tests clean up after themselves verifiably (run twice in a row, no drift)
- `LAUNCH_WORKFLOW_TESTS.md` documents what each test asserts
- CI workflow file added and yaml-lint clean

If any test fails on first run, halt and report which workflow is broken. Do not silently fix product bugs to make a test pass.

---

## Sprint 4 — RBAC matrix + observability

Two deliverables in one sprint — they're each independently small and naturally paired.

### RBAC matrix

Document and verify which roles can access what.

**Deliverables:**
- `docs/homewood/RBAC_MATRIX.md` — table: Route | Owner | Facility Admin | Caregiver | Family | Med-Tech | Dietary | Onboarding. Cells: ✓ (allowed), ✗ (blocked), △ (allowed with restrictions, footnoted)
- `scripts/homewood/rbac-verify.mjs` — for each route in the matrix, signs in as each role and asserts the documented access (✓ → 200, ✗ → 403/redirect to `/login` or `/unauthorized`)
- `package.json` script: `homewood:verify-rbac`
- Any RLS policy or middleware fix required to make the documented matrix match reality

If reality and the matrix don't match: document the discrepancy and fix middleware/RLS so reality matches the matrix. Do not silently update the matrix to match broken reality.

### Observability

Wire Sentry for error tracking. Production-ready, not best-effort.

**Deliverables:**
- `@sentry/nextjs` installed and configured for both client and server
- `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts` at repo root
- `SENTRY_DSN` env var documented in `.env.example`
- Source maps uploaded on production build (configure `withSentryConfig` in `next.config.ts`)
- Error boundary at app root that captures and reports React errors to Sentry
- Filter PII before sending — at minimum, scrub `user.email`, `user.full_name`, resident names/DOBs from breadcrumbs and event payloads
- `docs/homewood/OBSERVABILITY.md` documenting Sentry setup, where errors land, who gets notified

Do not configure performance monitoring or session replay this sprint — error tracking only. Performance/replay decisions are post-launch.

**Acceptance:**
- Triggering a deliberate error in dev (`throw new Error("homewood-launch-sentry-smoke-test")`) sends an event to Sentry
- PII scrubbing verified — the smoke-test event in Sentry does not contain any user names or emails
- RBAC verification script passes all matrix assertions
- Both docs committed

---

## Sprint 5 — Performance + accessibility baselines

Capture baselines and fix obvious failures. Not a perfectionist pass — a "no embarrassing problems on day one" pass.

### Performance

- Install `@next/bundle-analyzer`
- Run `npm run build && ANALYZE=true npm run build` and capture per-route first-load JS sizes
- Identify any route with first-load JS > 300kb gzip
- For top 3 offenders: fix with code-splitting, dynamic imports, or moving server-only deps out of client bundles
- Run Lighthouse against `/admin/command`, `/caregiver`, `/family`, `/med-tech`, `/dietary` in production-mode local build
- Capture Performance, Accessibility, Best Practices scores per route in `docs/homewood/PERF_BASELINE.md`

**Target thresholds for go-live (not gates, just documented):**
- LCP < 2.5s on simulated 4G
- First-load JS < 300kb gzip per route
- No long tasks > 200ms on initial render

If any route blows past these by more than 50%, surface as an anomaly and propose fixes.

### Accessibility

- Run `@axe-core/playwright` against the same 5 routes signed in with the appropriate role
- Capture all violations into `docs/homewood/A11Y_BASELINE.md`
- Fix every critical and serious violation in this sprint
- Document every moderate violation with proposed fix for post-launch

**Deliverables:**
- `scripts/homewood/perf-baseline.mjs`
- `scripts/homewood/a11y-baseline.mjs`
- `package.json` scripts: `homewood:perf-baseline`, `homewood:a11y-baseline`
- Both baseline docs committed
- Code fixes for critical/serious a11y violations

**Acceptance:**
- Both scripts run cleanly
- No critical or serious a11y violations remain on the 5 routes
- Both baseline docs committed
- Bundle analysis output committed under `docs/homewood/bundle-analysis-<date>.html`

---

## Sprint 6 — Pre-flight checklist + go-live runbook

Consolidate everything into a single command and a single runbook.

**Deliverables:**
- `scripts/homewood/preflight.mjs` — runs every check from Sprints 1-5 in sequence, exits 0 only if everything passes
- `docs/homewood/GO_LIVE_REPORT.md` — auto-generated by preflight, contains current state of every gate
- `docs/homewood/GO_LIVE_RUNBOOK.md` — manual launch-day procedure (not auto-generated)
- `package.json` script: `homewood:preflight`

**The preflight runs (in order, halting on first failure):**
1. `npm run typecheck`
2. `npm run lint`
3. `npm run build`
4. `npm run homewood:audit` → checks the report for any CRITICAL severity anomalies; fails if found
5. `npm run homewood:verify-auth` → all accounts must pass
6. `npm run homewood:verify-rbac` → matrix must match reality
7. `npm run homewood:test-launch` → all 7 workflow tests must pass
8. `npm run homewood:perf-baseline` → no route over 50% threshold breach
9. `npm run homewood:a11y-baseline` → zero critical or serious violations

**Output:** `GO_LIVE_REPORT.md` with a summary table (Gate | Status | Detail | Last Run), per-gate detail below, and a top-line GO / NO-GO recommendation.

**`GO_LIVE_RUNBOOK.md` must contain:**
- Pre-launch (T-1 week) checklist: every script run, all docs reviewed by user, Homewood ED dry run completed
- Launch day (T-0) checklist: user on-site at Homewood, flip `vars.HAVEN_UI_GATES_ENABLED` to `'true'`, monitor Sentry, support phone reachable
- First-week (T+1 to T+7) checklist: daily Sentry review, daily preflight run, daily Homewood ED check-in
- Rollback procedure: tag main before launch (`git tag homewood-pre-launch && git push origin homewood-pre-launch`), how to revert if something catastrophic, how to put Homewood into read-only mode if data integrity is at risk
- Support escalation: who calls whom when, expected response times
- Communication plan: how Homewood staff gets told if something is down

The runbook is a markdown doc the user reads on launch day. It must be self-contained — no "ask Claude" references.

**Acceptance:**
- `npm run homewood:preflight` runs every gate, produces `GO_LIVE_REPORT.md`
- Report shows current state — likely some NO-GOs at this point, that's fine, the user resolves them between now and launch
- `GO_LIVE_RUNBOOK.md` committed and complete
- Final commit message: `feat(homewood): pre-flight checklist + go-live runbook (sprint 6/6)`

After Sprint 6 PR merges, output:

```
[SPRINT 6 COMPLETE]
PR: <number>
Merge: <sha>
Files changed: <count>
Preflight script runs and produces GO_LIVE_REPORT.md.
GO_LIVE_RUNBOOK.md committed.

[GOAL COMPLETE]
All 6 sprints shipped. Homewood launch infrastructure ready.

Final state:
- Data audit: <CRITICAL count>, <HIGH count>, <MEDIUM count>, <LOW count> anomalies
- Auth verify: <pass>/<expected> accounts authenticate
- Workflow tests: <pass>/7 critical workflows green
- RBAC matrix: <pass>/<total> route assertions match reality
- Sentry: configured, smoke-test successful
- Perf baseline: <pass count>/5 routes under threshold
- A11y baseline: <count> critical/serious violations resolved
- Preflight: <GO | NO-GO> at goal completion

Anomalies surfaced for user triage (not auto-fixed):
<list from each sprint's halts>

User next steps:
1. Review GO_LIVE_REPORT.md
2. Resolve anomalies flagged above
3. Schedule Homewood ED dry run per GO_LIVE_RUNBOOK.md
4. Set launch-day calendar block: on-site at Homewood for T+0 through T+3
```

---

## Operating rules for the whole goal

- One PR per sprint. No combining. No splitting.
- Conventional commit format: `feat(homewood):`, `fix(homewood):`, `docs(homewood):`, `test(homewood):`, `chore(homewood):`.
- Every PR merged via `gh pr merge <N> --merge --admin` with the user notified before merge.
- `npm run typecheck` and `npm run lint` clean on every commit.
- `npm run build` clean on every PR before merge.
- Halt and report on any anomaly that requires user judgment. Do not silently work around data problems, broken workflows, or RLS gaps.
- Do not touch UI components, design tokens, or visual styling in any sprint. The audit is complete. Visual work is post-launch.
- Do not add or remove data from Homewood records. Read-only verification only.
- Do not roll back any previously merged work.
- If a sprint's actual scope exceeds the estimate by more than 2x in files or LOC, halt and re-plan with the user.

**Begin Sprint 1. Halt before opening the Sprint 1 PR for user review.**

---

## Pre-flight setup (do before /goal kickoff)

### 1. Required secrets

Without these, Sprint 2 will fail fast (which is the correct behavior, but you can pre-empt it):

```bash
cd "/Users/brianlewis/Circle of Life/Circle-of-Life"

# Password the Homewood accounts use (e.g. HavenDemo2026!):
gh secret set HOMEWOOD_LAUNCH_PASSWORD
# (paste the password)

# Sentry DSN for Sprint 4 — create a Sentry project for Haven first if you don't have one:
gh secret set SENTRY_DSN
# (paste DSN from sentry.io)
```

If no Sentry account yet: create one at sentry.io (free tier is fine), make a Next.js project called "haven-production," grab the DSN. Five-minute setup.

### 2. Pause-between-sprints policy

The goal as written says "pause for the user's 'go' between each sprint." Strict pause-between-sprints is more conservative — sprint-level pauses give a chance to read each report before the next runs.

If you want to let it run continuously and only pause on real halts, swap this line in the goal text:

> "Do not auto-proceed between sprints — pause for the user's 'go' between each."

with:

> "Auto-proceed between sprints unless a halt condition triggers."

### 3. Kickoff

- Set the two secrets above
- Start a fresh Claude Code session in this repo
- Paste a short `/goal` referencing this file (e.g. "Execute the Homewood Go-Live plan in `HANDOFFS/HOMEWOOD-LAUNCH.md`. Begin Sprint 1. Halt before opening the Sprint 1 PR for user review.")
- Watch Sprint 1 run, review the data audit findings before approving Sprint 2

If Sprint 1's data audit surfaces critical anomalies (residents with no rooms, family accounts linked to discharged residents, anything that would embarrass on launch day), it shows up immediately. That's the test of whether 4 weeks is real or whether the launch needs to slip.
