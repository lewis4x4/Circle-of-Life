# Homewood Go-Live Handoff

Real customer launch, 4-week timeline. UI audit complete (DRIFT = 0). Homewood facility data already loaded into Supabase via onboarding flow. User accounts provisioned. Out of scope for this launch brief: visual design, UI cleanup, data import, training materials. In scope: code-side launch protection.

## Design sequencing update (2026-05-16)

User decision: design phase can begin now. The prior requirement for 14+ days of live Homewood operations before design start is removed.

Parallel-execution constraints:

- Capture visual screenshot-regression baselines against empty-state and placeholder data as needed.
- Plan a second design pass after 30 live days for high-density surfaces (resident roster, incident queue, family portal).
- Design implementation must not modify Homewood data, RBAC policies, auth flows, or Supabase schemas.
- If a design batch conflicts with a launch sprint, launch sprint changes have merge priority.

## Operating rules

- One PR per sprint, conventional commits (`feat(homewood):` etc.), merged via `gh pr merge <N> --merge --admin`
- `npm run typecheck`, `npm run lint`, `npm run build` clean on every PR
- Halt and report (do not silently work around) on: data anomalies needing user triage, build/lint/typecheck breaks, RLS changes affecting production data, real bugs in critical workflows, PR scope exceeding 2x estimate
- Do not touch UI/design/tokens. Do not mutate Homewood data — read-only verification only. Do not roll back merged work.
- Pause between sprints for user "go." Each sprint ends with `[SPRINT N COMPLETE]` block: PR number, merge SHA, files changed, what was verified, anomalies for user.

## Sprint 1 — Data audit (read-only)

Build:
- `scripts/homewood/data-audit.mjs` — queries Supabase scoped to Homewood Lodge ALF only
- `docs/homewood/DATA_AUDIT.md` — datestamped markdown report
- `package.json` script: `homewood:audit`

Detect and count: residents without rooms / care plans / diagnoses / med schedules / family relationships / sane admit dates; staff without roles / certs (for CNA, med-tech, nurse) / facility assignments; family accounts without resident links or linked to discharged residents; meds without dosage/frequency; care plans without review dates or > 90 days stale; incidents unresolved > 30 days; orphaned foreign keys.

Report format: summary table (Anomaly | Count | Severity | Sample IDs) where Severity = CRITICAL (launch-blocker) / HIGH / MEDIUM / LOW. Per-anomaly sections with up to 5 sample row IDs.

Acceptance: script exits 0, writes markdown, every category has a count, no data mutated. Do not fix anomalies — user reviews between sprints.

## Sprint 2 — Auth verification (read-only)

Adapt `scripts/seed/verify-auth-fixtures.mjs` for real accounts.

Build:
- `scripts/homewood/auth-verify.mjs`
- `docs/homewood/AUTH_VERIFICATION.md`
- `package.json` script: `homewood:verify-auth`
- `.github/workflows/ci-gates.yml` updated to run `homewood:verify-auth` after seed:verify, gated on existing `vars.HAVEN_UI_GATES_ENABLED`

Logic: query auth.users joined with role/facility tables for Homewood accounts; sign in each using `HOMEWOOD_LAUNCH_PASSWORD` env (fail loudly with clear message if missing); confirm session resolves to expected `app_role`; confirm landing route loads per role (owner → /admin/command, facility_admin → /admin/command facility-scoped, caregiver → /caregiver, family → /family, medtech → /med-tech, dietary → /dietary).

Output: per-role pass/fail summary, per-account detail, total pass vs expected count. Redact passwords in committed doc.

Acceptance: runs locally with secret, fails clearly without, YAML-lint clean, no creds committed.

## Sprint 3 — Critical workflow tests (Playwright)

7 must-have launch workflows, tests run against dev/staging Supabase with real Homewood data:
1. Caregiver opens shift → sees resident assignments → completes one ADL entry → saves
2. Caregiver reports minor incident → form submits → appears in management queue
3. Med-tech runs med pass → marks one given, one refused → persists
4. Management views Homewood daily census → matches data-audit numbers
5. Management opens resident → updates one care plan field → saves → version history shows update
6. Family logs in → sees loved one's profile → sees most recent activity
7. Owner views Homewood → drills to roster → drills to specific resident

Build:
- `tests/homewood-launch/` — 7 spec files, one per workflow
- `playwright.homewood.config.ts` — dev/staging environment, canonical test account per role
- `package.json` script: `homewood:test-launch`
- `docs/homewood/LAUNCH_WORKFLOW_TESTS.md` — what each asserts, what failure means
- `.github/workflows/homewood-launch-tests.yml` — runs on PRs touching `src/`, gated on `vars.HAVEN_UI_GATES_ENABLED`

Rules: real Homewood accounts and data (no test seeding); idempotent (run twice = no drift); cleanup via try/finally with distinct test-only identifiers on mutated rows; structured output for humans + CI.

Acceptance: 7/7 pass locally, cleanup verified by double-run, doc + workflow committed. If any test fails first run, halt — do not silently fix product bugs to make a test pass.

## Sprint 4 — RBAC matrix + Sentry observability

### RBAC

Build:
- `docs/homewood/RBAC_MATRIX.md` — table: Route | Owner | Facility Admin | Caregiver | Family | Med-Tech | Dietary | Onboarding. Cells: ✓ / ✗ / △ (with footnote)
- `scripts/homewood/rbac-verify.mjs` — for each route × role, sign in and assert documented access (✓ → 200, ✗ → 403 or redirect)
- `package.json` script: `homewood:verify-rbac`
- Middleware/RLS fixes where reality doesn't match documented matrix

Rule: if reality and matrix disagree, fix reality to match matrix. Do not silently update matrix to match broken reality.

### Sentry

Production-ready, not best-effort:
- `@sentry/nextjs` installed; `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts` at repo root
- `SENTRY_DSN` documented in `.env.example`
- Source maps uploaded on prod build via `withSentryConfig` in `next.config.ts`
- App-root error boundary captures + reports to Sentry
- PII scrubbing: scrub `user.email`, `user.full_name`, resident names/DOBs from breadcrumbs and event payloads
- `docs/homewood/OBSERVABILITY.md` — Sentry setup, where errors land, who gets notified

Out of scope this sprint: performance monitoring, session replay.

Acceptance: smoke-test error (`throw new Error("homewood-launch-sentry-smoke-test")`) lands in Sentry with PII scrubbed; RBAC verify passes all matrix assertions; both docs committed.

## Sprint 5 — Performance + a11y baselines

### Performance

- Install `@next/bundle-analyzer`
- Run `ANALYZE=true npm run build`, capture per-route first-load JS
- Identify routes > 300kb gzip first-load JS; fix top 3 (code-split, dynamic imports, server-only deps out of client bundles)
- Lighthouse against `/admin/command`, `/caregiver`, `/family`, `/med-tech`, `/dietary` in production-mode local build
- `docs/homewood/PERF_BASELINE.md` — Performance, Accessibility, Best Practices per route

Documented (not gated) thresholds: LCP < 2.5s on simulated 4G, first-load JS < 300kb gzip, no long tasks > 200ms initial render. If any route exceeds threshold by >50%, surface as anomaly with proposed fix.

### A11y

- `@axe-core/playwright` against same 5 routes with appropriate role logged in
- `docs/homewood/A11Y_BASELINE.md` — all violations
- Fix every critical + serious violation this sprint
- Document moderate violations with proposed post-launch fix

Build: `scripts/homewood/perf-baseline.mjs`, `scripts/homewood/a11y-baseline.mjs`; `package.json` scripts `homewood:perf-baseline`, `homewood:a11y-baseline`; bundle analysis output committed under `docs/homewood/bundle-analysis-<date>.html`.

Acceptance: scripts run clean, zero critical/serious a11y violations on the 5 routes, baseline docs committed.

## Sprint 6 — Preflight + go-live runbook

Consolidate everything.

Build:
- `scripts/homewood/preflight.mjs` — runs all Sprint 1-5 checks in order, exits 0 only if all pass
- `docs/homewood/GO_LIVE_REPORT.md` — auto-generated by preflight, summary table + per-gate detail + top-line GO/NO-GO
- `docs/homewood/GO_LIVE_RUNBOOK.md` — manual launch-day procedure, self-contained (no "ask Claude")
- `package.json` script: `homewood:preflight`

Preflight order (halt on first fail): typecheck → lint → build → homewood:audit (fail if any CRITICAL) → homewood:verify-auth (all must pass) → homewood:verify-rbac (matrix matches reality) → homewood:test-launch (7/7) → homewood:perf-baseline (no route >50% threshold breach) → homewood:a11y-baseline (zero critical/serious).

GO_LIVE_RUNBOOK.md contains:
- T-1 week: every script run, all docs reviewed, Homewood ED dry run done
- T-0 day: user on-site at Homewood, flip `vars.HAVEN_UI_GATES_ENABLED` to `'true'`, monitor Sentry, support phone reachable
- T+1 to T+7: daily Sentry review, daily preflight, daily ED check-in
- Rollback: `git tag homewood-pre-launch && git push origin homewood-pre-launch` before launch; revert procedure; read-only-mode procedure for Homewood if data integrity at risk
- Support escalation: who calls whom, response time SLAs
- Communication plan: how staff gets told if something's down

Final output after Sprint 6 merge:

```
[SPRINT 6 COMPLETE]
PR: <number>
Merge: <sha>
Files changed: <count>
Preflight runs and produces GO_LIVE_REPORT.md.
GO_LIVE_RUNBOOK.md committed.

[GOAL COMPLETE]
All 6 sprints shipped. Homewood launch infrastructure ready.

Final state:
- Data audit: <CRITICAL>/<HIGH>/<MEDIUM>/<LOW> anomalies
- Auth verify: <pass>/<expected>
- Workflow tests: <pass>/7
- RBAC matrix: <pass>/<total> route assertions
- Sentry: configured, smoke-test successful
- Perf: <pass>/5 routes under threshold
- A11y: <count> critical/serious resolved
- Preflight: <GO | NO-GO>

Anomalies for user triage:
<aggregated list from all sprints>

User next steps:
1. Review GO_LIVE_REPORT.md
2. Resolve flagged anomalies
3. Schedule Homewood ED dry run per RUNBOOK
4. Block T+0 through T+3 on-site at Homewood
```