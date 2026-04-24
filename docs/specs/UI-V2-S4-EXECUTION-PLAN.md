# UI-V2 Slice S4 — Primitives B (KPI)

**Parent:** `docs/specs/UI-V2-EXECUTION-HANDOFF.md`
**Spec sections:** UI-V2-DESIGN-SYSTEM.md §4 (primitives P05, P06, P11, P12) + §4.1 (KPITile contract)
**Depends on:** S3 committed
**Est. eng-days:** 2

## Goal

Five KPI-related primitives render per spec. `require-kpi-info` lint rule from S1 now actually has a component to enforce against.

## Files to deliver

Same 4-file pattern per primitive as S3 (component + `.test.tsx` + `.preview.tsx` + `.a11y.spec.ts`). **No Storybook** — test stack established in S3 using Vitest + Testing Library + Playwright + @axe-core/playwright. See `UI-V2-S3-EXECUTION-PLAN.md` "Pre-flight" for stack details. Register new primitives in the `/admin/v2/__dev__/` dev preview route.

### P05 — `<KPITile>`

- `src/design-system/components/KPITile/...`
- Props exactly per `§4.1 KPITileProps`.
- Tone map drives text color via Tailwind semantic classes.
- Sparkline uses Recharts `AreaChart` (Recharts is already a dep).
- States: `default`, `withTrendUp`, `withTrendDown`, `withSparkline`, `withBreachMessage`, `regulatoryTone`, `dangerTone`.

### P06 — `<TrendDelta>`

- `src/design-system/components/TrendDelta/...`
- Props: `{ direction, value, unit, period, goodDirection? }`.
- Renders ↑/↓/flat + tabular-nums value + unit + period text.
- Color resolves via `goodDirection`: if movement matches goodDirection → success; otherwise → danger; flat → muted.
- States: `up`, `down`, `flat`, `goodUp`, `goodDown`, `pp`, `pts`, `%`, `days`.

### P11 — `<SeverityChip>`

- `src/design-system/components/SeverityChip/...`
- Props: `{ level: "low"|"medium"|"high", trend?: { from: "low"|"medium"|"high", ageText: string } }`.
- Renders level dot + label + optional "↑ from Medium 3d ago" trend text.
- States: `low`, `medium`, `high`, `highFromMedium`, `withoutTrend`.

### P12 — `<HealthDot>`

- `src/design-system/components/HealthDot/...`
- Props: `{ score: number, max?: number }` (default max 100).
- Renders colored dot + proportional bar + tabular numeric.
- Color band: ≥80 success, ≥65 warning, <65 danger.
- States: `healthy`, `warning`, `danger`, `custom max`.

### `<Sparkline>` (internal, used by KPITile)

- `src/design-system/components/Sparkline/...`
- Small thin line chart component wrapping Recharts, exposing `{ data: number[], tone }`.
- States: `default`, `flat`, `volatile`.

## Additional requirements

1. `require-kpi-info` ESLint rule from S1 must now catch `<KPITile>` usages missing `info` prop when `value` is computed. Wire the rule to actually run against `<KPITile>` usages. If the rule needs refinement now that the target exists, refine it — but keep the S1-shipped contract.
2. Tabular-nums CSS applied to all numeric primitives via `tabular-nums` Tailwind class.
3. Color bands (HealthDot) are a single constant exported from `src/design-system/components/HealthDot/bands.ts`; future tests read from there.

## Gate command

```bash
SKIP_PG_VERIFY=1 npm run segment:gates -- --segment "UI-V2-S4" --ui
```

## Acceptance

- Five primitives with 4-file pattern each.
- `require-kpi-info` rule lints a synthetic test file (create `src/design-system/components/KPITile/__lint_fixture__.tsx`) and correctly rejects a missing-`info` case.
- axe-core zero violations on each.
- `npm run lint && npm run build` pass.
- Gate JSON PASS.
- `UI-V2-STATUS.md` S4 box ticked.

## Review hooks

- `agents/playbooks/chief-design-officer-agent.md`
- `agents/playbooks/qa-agent.md`

## Commit message

`feat(ui-v2-s4): primitives B — KPI [UI-V2-S4]`

## Gotchas

- Recharts warns on zero-size containers (seen in existing build stderr). Wrap Sparkline in `ResponsiveContainer` with explicit min-width/min-height or `aspect` to avoid log pollution.
- HealthDot color bands come from design, not from `facility_metric_targets`. Health Score is a portfolio-wide rollup; per-facility thresholds apply to metric cells in DataTable (S6), not HealthDot.
