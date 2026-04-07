# CI hardening spec (Track B3)

**Purpose:** Document the segment-gate matrix, when `--ui` applies, and what a fully hardened CI pipeline looks like. This captures the gap between today's working `.github/workflows/ci-gates.yml` and production-grade CI.

---

## 1. Current gate matrix

Every segment and every CI push/PR runs `npm run segment:gates`. The runner (`scripts/agent-gates/run-segment-gates.mjs`) executes these checks:

| ID | Check | Required | CI | Local | Notes |
|----|-------|----------|-----|-------|-------|
| `hygiene.env-example` | `.env.example` entries match `.env.local` shape | yes | yes | yes | |
| `hygiene.tracked-secrets-scan` | No real secrets in tracked files | yes | yes | yes | |
| `hygiene.npm-audit` | `npm audit` 0 vulnerabilities | yes | yes | yes | |
| `security.gitleaks` | gitleaks scan of commit history | yes | yes | yes (needs gitleaks or Docker) | `SKIP_GITLEAKS=1` allowed locally |
| `qa.eslint` | `npm run lint` | yes | yes | yes | |
| `qa.migration-sequence` | `npm run migrations:check` sequence 001–095 | yes | yes | yes | |
| `qa.migrations-apply-postgres` | Docker Postgres replay of all migrations | CI-required | yes (`REQUIRE_PG_VERIFY=1`) | best-effort | Requires Docker |
| `qa.root-build` | `npm run build` (Next.js production build) | yes | yes | yes | |
| `hygiene.nextjs-deprecation-signal` | No middleware deprecation warnings in build output | advisory (unless `FAIL_ON_NEXT_DEPRECATIONS=1`) | advisory | advisory | |
| `qa.web-build` | `npm run build` for `apps/web/` | yes (if exists) | yes | yes | Currently skipped — no `apps/web/` |
| `chaos.stress-suite` | `npm run stress:test` | yes (unless `--no-chaos`) | skipped (`--no-chaos`) | optional | |
| `cdo.design-review` | Playwright design review routes | yes with `--ui` | not yet | local + `--ui` | Requires running app |
| `cdo.a11y-axe` | axe accessibility scan on routes | yes with `--ui` | not yet | local + `--ui --no-a11y` to skip | Requires running app |

---

## 2. When to pass `--ui`

Use `--ui` when any of these changed in the segment:

- Page layout, navigation, or shell structure.
- Route files under `src/app/` (new pages, renamed routes).
- Shared UI components (design system tokens, layout primitives).
- CSS / Tailwind theme changes.
- Accessibility-related markup (aria attributes, heading levels, form labels).

Do **not** pass `--ui` for:

- Backend-only changes (migrations, Edge Functions, API route logic).
- Documentation-only changes.
- Script/tooling changes that don't affect rendered output.
- Dependency bumps unless they affect visual output.

---

## 3. CI pipeline — current vs target

| Capability | Today (ci-gates.yml) | Target |
|------------|---------------------|--------|
| Lint, build, secrets, audit, gitleaks | **yes** | same |
| Docker Postgres migration replay | **yes** (`REQUIRE_PG_VERIFY=1`) | same |
| Stress suite | skipped (`--no-chaos`) | enable on nightly schedule |
| `--ui` design review + axe | **partially yes** — conditional on `src/app/` changes; design review advisory, axe required | stabilize and expand if broader UI directories need coverage |
| `demo:web-health` route probes | **not run in CI** | add as post-build check |
| `demo:auth-smoke` (Playwright) | **not run in CI** | add as post-build check (needs Playwright in CI) |
| Supabase type generation check | **not run** | `supabase gen types` → diff, fail on drift |
| Bundle size check | **not run** | `next build` artifact size → fail if exceeds budget |

---

## 4. Recommended CI additions (ordered)

### 4a. Route-probe gate (low cost, high value)

Add to `ci-gates.yml` after the build step:

```yaml
- name: Route probe (web-health)
  run: |
    npx next start -p 4310 &
    sleep 8
    BASE_URL=http://127.0.0.1:4310 npm run demo:web-health
    kill %1
  env:
    CI: true
```

This validates that every protected route redirects to `/login` in a production build — catches middleware regressions.

### 4b. Selective `--ui` on PR (medium cost)

Add a conditional step that checks `git diff` for `src/app/` changes:

```yaml
- name: Check for UI changes
  id: ui_changes
  run: |
    if git diff --name-only origin/main...HEAD | grep -q '^src/app/'; then
      echo "ui_changed=true" >> "$GITHUB_OUTPUT"
    else
      echo "ui_changed=false" >> "$GITHUB_OUTPUT"
    fi

- name: UI gates (design review + a11y)
  if: steps.ui_changes.outputs.ui_changed == 'true'
  run: npm run segment:gates -- --segment "ci-ui-${{ github.run_id }}" --ui --no-chaos
  env:
    CI: true
    REQUIRE_PG_VERIFY: "0"
```

Requires Playwright browser install in CI. Add:

```yaml
- name: Install Playwright Chromium
  if: steps.ui_changes.outputs.ui_changed == 'true'
  run: npx playwright install --with-deps chromium
```

### 4c. Nightly stress + extended checks

Create `.github/workflows/ci-nightly.yml`:

```yaml
name: CI — nightly extended
on:
  schedule:
    - cron: '0 5 * * *'  # 05:00 UTC daily
  workflow_dispatch:

jobs:
  extended:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - name: Full gate suite with UI + stress
        run: npm run segment:gates -- --segment "nightly-${{ github.run_id }}" --ui
        env:
          CI: true
          REQUIRE_PG_VERIFY: "1"
```

### 4d. Bundle size budget (deferred)

After the build step, record `.next/` artifact sizes and compare against a committed budget file. Fail if any entry exceeds budget by >10%.

---

## 5. Implementation status

| Item | Status |
|------|--------|
| Base CI gate pipeline (ci-gates.yml) | **DONE** — runs on push/PR |
| Route-probe gate in CI (4a) | **DONE** — `ci-gates.yml` starts `next start` on `127.0.0.1:4310` and runs `demo:web-health` |
| Selective `--ui` on PR (4b) | **DONE (initial)** — conditional on `src/app/` changes; installs Playwright Chromium; runs `segment:gates --ui --design-advisory --no-chaos` |
| Nightly stress + extended (4c) | ☐ Not implemented |
| Bundle size budget (4d) | ☐ Not implemented |
| Gate matrix documented | **DONE** — this file |
| `--ui` decision criteria documented | **DONE** — this file §2 |
