# GitHub Workflows

| Workflow file | Purpose |
| --- | --- |
| `ci-gates.yml` | Runs segment gate CI checks for pushes/PRs (security, lint, migrations, build, stress) when UI gates are enabled. |
| `ci-nightly.yml` | Runs nightly extended CI (full gate suite + server route probe). |
| `ci-ui-gates.yml` | Runs UI-specific quality gates (bundle budget, a11y, visual regression and related checks). |
| `homewood-launch-tests.yml` | Runs Homewood launch workflow Playwright tests (gated by UI-gates repo variable). |
| `style-regression.yml` | Blocks known style anti-pattern regressions in `src/` on PRs. |
| `edge-functions-deploy.yml` | Deploys changed Supabase Edge Functions on pushes to `main`; PRs post previews, while twice-daily and manual runs reconcile the full production inventory after schema-gated holds. |
