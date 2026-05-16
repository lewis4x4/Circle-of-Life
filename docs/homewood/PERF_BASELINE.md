# Homewood Lodge ALF — Performance Baseline

_Generated: `2026-05-16T15:00:10.114Z`_

This baseline reports per-route first-load JS for the 5 routes Homewood staff hit on day one. Re-generate with `ANALYZE=true npm run build && npm run homewood:perf-baseline`.

## Target thresholds (documented, not gates)

- LCP < 2.5s on simulated 4G
- **First-load JS < 300kb gzip per route**
- No long tasks > 200ms on initial render

## Per-route first-load JS (gzip)

| Route | First-load JS (kb gzip) | Status | Notes |
|---|---:|---|---|
| /admin/command | 210 | ✅ within threshold | 7 chunks |
| /caregiver | 210 | ✅ within threshold | 7 chunks |
| /family | 210 | ✅ within threshold | 7 chunks |
| /med-tech | 210 | ✅ within threshold | 7 chunks |
| /dietary | 210 | ✅ within threshold | 7 chunks |

## Bundle analyzer report

- bundle analyzer HTML not found — re-run with `ANALYZE=true npm run build` before `npm run homewood:perf-baseline`

## Lighthouse scores (manual)

Lighthouse must be run manually against the 5 routes in production-mode local build. Capture Performance / Accessibility / Best Practices scores below after each run.

| Route | Performance | Accessibility | Best Practices |
|---|---:|---:|---:|
| /admin/command | _pending_ | _pending_ | _pending_ |
| /caregiver | _pending_ | _pending_ | _pending_ |
| /family | _pending_ | _pending_ | _pending_ |
| /med-tech | _pending_ | _pending_ | _pending_ |
| /dietary | _pending_ | _pending_ | _pending_ |

## Anomalies to surface

Any route whose first-load JS exceeds **450kb gzip** (50% over threshold) is flagged for code-splitting / dynamic import work. None today exceed that bound unless the table above shows `❌`.

