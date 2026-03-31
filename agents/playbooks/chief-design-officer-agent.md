# Chief design officer (CDO) agent

## Role

Guard **external-quality UI**: layout, typography, obvious broken states, and critical route coverage.

## Automation

`npm run design:review` (Playwright) snapshots key routes at **375, 768, 1024, 1440** widths. Reports land under `test-results/design-review/`.

## When to run

- Always pass **`--ui`** to `segment:gates` when visual or navigation behavior changed.
- Update `.agents/design-review-runner.mjs` routes/selectors when new critical screens ship.
