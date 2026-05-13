# Optimize: Admin route navigation latency

**Metric:** Authenticated admin route navigation wall-clock latency in milliseconds, measured by `scripts/perf/admin-navigation-latency.mjs` from route request to visible `<main>` + network idle.
**Stop criterion:** First pass target is ≥30% p95 improvement from baseline or a concrete measured blocker/next plan if one iteration cannot safely land.
**Scope:** Admin shell route transitions and shared admin navigation/data-loading surfaces. Initial route set: `/admin/staff`, `/admin/schedules`, `/admin/training`, `/admin/billing`, `/admin/residents`.

## Runs

| # | Change | Median | p95 | Notes |
|---|---|---:|---:|---|
| baseline | — | 3054 | 9543 | Live Netlify; login 13367ms; routes /admin/staff, /admin/schedules, /admin/training, /admin/billing, /admin/residents; by route p95: /admin/staff 5759, /admin/schedules 4843, /admin/training 5406, /admin/billing 4906, /admin/residents 9543 |
| 1 | Persist AdminShell facility-options cache with 5m TTL and authenticated-user owner gate | — | — | Local verification: `npm run lint` PASS; `npm run build` PASS. Local harness attempted with `BASE_URL=http://localhost:3000 RUNS=1`, but login could not proceed because the sign-in button stayed disabled and Playwright timed out before route samples. Live Netlify/deployed-code measurement pending. |
| 1-live | Same commit measured after Netlify deploy `5c18cd9` | 1778 | 5397 | Live Netlify; login 13343ms; p95 improved 43.4% vs baseline; median improved 41.8%; by route p95: /admin/staff 5340, /admin/schedules 2658, /admin/training 2476, /admin/billing 5397, /admin/residents 2165. |
| 2-live | Server-seed billing data and prevent staff/billing redundant first hydration refetches after Netlify deploy `05f8736` | 2143 | 4676 | Live Netlify; login 12864ms; p95 improved 13.4% vs pass 1 and 51.0% vs baseline; by route p95: /admin/staff 3852, /admin/schedules 3385, /admin/training 2143, /admin/billing 4676, /admin/residents 2400. Billing remains p95 tail. |
| 3-live | Collapse billing invoice + resident lookup into one FK-aliased relational select after Netlify deploy `9feb0f9` | 1763 | 3097 | Live Netlify confirmation run; login 8250ms; p95 improved 33.8% vs pass 2 and 67.5% vs baseline; by route p95: /admin/staff 3097, /admin/schedules 2608, /admin/training 1764, /admin/billing 2638, /admin/residents 1700. First immediate post-deploy run showed cold/noisy p95 5850 while billing median still improved to 2643; confirmation run used for stop decision. |
