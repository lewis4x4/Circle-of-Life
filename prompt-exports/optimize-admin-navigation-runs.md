# Optimize: Admin route navigation latency

**Metric:** Authenticated admin route navigation wall-clock latency in milliseconds, measured by `scripts/perf/admin-navigation-latency.mjs` from route request to visible `<main>` + network idle.
**Stop criterion:** First pass target is ≥30% p95 improvement from baseline or a concrete measured blocker/next plan if one iteration cannot safely land.
**Scope:** Admin shell route transitions and shared admin navigation/data-loading surfaces. Initial route set: `/admin/staff`, `/admin/schedules`, `/admin/training`, `/admin/billing`, `/admin/residents`.

## Runs

| # | Change | Median | p95 | Notes |
|---|---|---:|---:|---|
| baseline | — | 3054 | 9543 | Live Netlify; login 13367ms; routes /admin/staff, /admin/schedules, /admin/training, /admin/billing, /admin/residents; by route p95: /admin/staff 5759, /admin/schedules 4843, /admin/training 5406, /admin/billing 4906, /admin/residents 9543 |
| 1 | Persist AdminShell facility-options cache with 5m TTL and authenticated-user owner gate | — | — | Local verification: `npm run lint` PASS; `npm run build` PASS. Local harness attempted with `BASE_URL=http://localhost:3000 RUNS=1`, but login could not proceed because the sign-in button stayed disabled and Playwright timed out before route samples. Live Netlify/deployed-code measurement pending. |
