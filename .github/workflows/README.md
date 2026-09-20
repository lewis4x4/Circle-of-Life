# GitHub Workflows

| Workflow file | Purpose |
| --- | --- |
| `ci-gates.yml` | Runs required application/platform checks on every push/PR, one full PostgreSQL replay only for database-sensitive changes, and finance-specific tests only for finance-sensitive changes. Its `Required CI summary` job is the stable branch-protection check. |
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
