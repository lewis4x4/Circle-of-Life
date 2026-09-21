# GitHub Workflows

| Workflow file | Purpose |
| --- | --- |
| `ci-gates.yml` | Runs required application/platform checks on every push/PR, one full PostgreSQL replay only for database-sensitive changes, and finance-specific tests only for finance-sensitive changes. Its `Required CI summary` job is the stable branch-protection check. |
| `main-ci-failure-alert.yml` | Preserves established main-CI incident routing; an independent observer-health job performs five-minute catch-up, audits old reruns, and retains unfinished runs. |
| `netlify-production-failure-alert.yml` | Observes the exact Haven production site every five minutes and on main pushes; maintains one assigned production incident with distinct-deploy escalation and publication-backed recovery. Finite dispatch supports isolated synthetic replay. |
| `ci-nightly.yml` | Runs nightly extended CI (full gate suite + server route probe). |
| `ci-ui-gates.yml` | Runs UI-specific quality gates (bundle budget, a11y, visual regression and related checks). |
| `homewood-launch-tests.yml` | Runs Homewood launch workflow Playwright tests (gated by UI-gates repo variable). |
| `style-regression.yml` | Blocks known style anti-pattern regressions in `src/` on PRs. |
| `edge-functions-deploy.yml` | Deploys changed Supabase Edge Functions on pushes to `main`; PRs post previews, while twice-daily and manual runs reconcile the full production inventory after schema-gated holds. |

## Path-sensitive database verification

`scripts/ci/classify-changes.mjs` is the source of truth for conditional CI.
Ordinary application changes explicitly skip the Docker-backed migration replay.
Migration, SQL test, replay infrastructure, care-event parity, and CI policy
changes require it. A missing or unreadable diff fails closed and runs every
risk-sensitive gate.

The pull request and post-merge workflows each have exactly one possible full
database replay owner: the segment gate in `ci-gates.yml`. The nightly workflow
always runs the replay regardless of changed paths.

Successful PR runs also retain `release-tree-proof`, which binds the exact
tested merge tree to the fail-closed release-risk classification. The proof can
avoid blocking on duplicate post-merge CI only for safe, non-sensitive changes
whose actual merged tree matches byte-for-byte; main CI still runs and failures
surface through `main-ci-failure-alert.yml`.

CI-policy-only changes use a narrow lane: targeted workflow/proof regressions,
package/environment hygiene, audit, tracked-secret scanning, and checksum-pinned
Gitleaks. Application, domain, database, build, stress, and browser suites do
not run unless any changed path falls outside the explicit policy allowlist.

## Production observation

The provider observer runs at `2-57/5`; the independent watcher catches up at
`4-59/5`. Main pushes have immediate observation and at most ten minute-spaced
follow-ups, with a twelve-minute job limit. Other runs have a five-minute limit.
GitHub can delay or drop scheduled jobs: these are healthy-platform detection
budgets, not an absolute delivery SLA. See the agent gates runbook for recovery
proof, durable state, credential ownership, and audit limits.

Only the live observer receives `NETLIFY_AUTH_TOKEN`. Replay and watcher jobs use
GitHub permissions only. The issue writers use trusted main code, separate
concurrency groups, and assignment/effect readback. A successful CI run cannot
resolve a provider incident or observer-health issue. Synthetic replay uses a
run-specific issue marker and retains the closed issue as evidence.
