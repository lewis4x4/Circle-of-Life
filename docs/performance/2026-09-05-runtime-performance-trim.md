# Runtime performance trim — 2026-09-05

Mission alignment: **pass**. This segment reduces redundant processing in existing executive and resident workflows. Public signatures, Supabase queries, tenant/facility filters, error handling, financial calculations, and operator labels are preserved.

Base: `71675f89` in `/Users/brianlewis/QEP/COL`, origin `lewis4x4/Circle-of-Life`.

## Changes

- `src/lib/executive/standup.ts`: convert each weekly date range to UTC boundaries once per load, instead of for every attendance, overtime, tour, and outreach row. The existing inclusive start, exclusive end, and string comparisons remain intact across Eastern DST transitions.
- The same loader indexes each of its ten datasets once by facility. Facility partitioning changes from O(facilities × rows) scans to O(rows + facilities) lookups. Maps retain references to fetched rows for the duration of the load; row objects are not copied or cached across requests.
- `src/lib/residents/roster-format.ts`: reuse three fixed locale/timezone formatters, removing five formatter constructions per valid timestamp. Skip month/day formatting for Today and Yesterday labels. Read the current date on every call so labels still roll over at midnight.
- Compute average posted acuity in one pass, avoiding an intermediate filtered array. Missing acuity retains the existing named gap.

## Measured evidence

Synthetic local processing, one warmup and five samples, median, Node 26.7.0:

| Workload | Before | After | Ratio |
| --- | ---: | ---: | ---: |
| Standup: five facilities, 29,400 source rows | 292.94 ms | 3.43 ms | 85.4× |
| Format 1,000 roster timestamps | 191.64 ms | 12.12 ms | 15.8× |

These are CPU-side fixture timings, not production page-load measurements. Standup includes a mock of existing read-only query filtering. No dependencies were added or changed.

Reproduce current timing after creating an output directory:

```sh
mkdir -p /tmp/haven-perf-benchmark
HAVEN_PERF_BENCH=/tmp/haven-perf-benchmark npx vitest run src/lib/executive/standup-live.test.ts src/lib/residents/roster-format-performance.test.ts
```

Baseline snapshots were captured from the original implementation before edits. A separate comparison against source saved from `71675f89` passed 8,120 exact-output comparisons: complete live results for four dates and four scopes, 8,004 timestamp labels, and 100 acuity groups.

The added regression tests cover all calculated metrics and confidence labels, empty datasets, all eleven query-error paths, facility/organization query scope, missing-bed fallback, DST transitions, invalid timestamps, and midnight rollover. Benchmark tests are opt-in, with no machine-dependent timing threshold.

## Validation and release status

- Focused run: 43 passed, including the two opt-in measurements.
- TypeScript: `npx tsc --noEmit -p tsconfig.typecheck.json` passed.
- New timestamp regression tests also pass with `TZ=UTC`.
- Full suite: 2,832 passed, eight failed, two benchmark tests skipped. All eight also fail at the original commit. The baseline additionally had one audit-export test failure not observed in this run. No new failing test names were found.

No markup or routing changes were made; the segment uses the standard gate bundle. Live Homewood UAT remains a separate Track A owner gate. This refactor does not alter that acceptance status.

- Final focused run: 42 passed, two opt-in benchmark tests skipped. Includes preservation of sparse-array handling in average acuity.
- Production build, repository lint, migration sequence, secret scans, and stress checks passed.
- Required segment verdict: **FAIL** due to existing npm audit findings (two high, two moderate, one low; package manifests and lockfile are unchanged). High findings affect `browserslist` and `fast-uri`.
- PostgreSQL replay also fails as a nonblocking advisory at the local auth stub (`permission denied for schema auth`); it does not validate production migration state.
- Owner authorization (2026-09-05): after receiving the failing gate report, the owner explicitly instructed “Merge and Commit.” This authorizes committing and merging this segment with the documented existing failures; the gate verdict remains FAIL. Dependency remediation and the pre-existing test failures remain separate work.
- Integration scope: the performance change is based on `main` at `1d5a74fa`; the original validation checkout also included the unrelated resident-detail commit `71675f89`. That commit is not part of this optimization merge. Focused tests on the integration branch passed: 42 passed, two opt-in benchmarks skipped.

Final gate artifact: [`test-results/agent-gates/2026-09-05T18-00-09-931Z-runtime-performance-trim.json`](../../test-results/agent-gates/2026-09-05T18-00-09-931Z-runtime-performance-trim.json). Measurements and baseline failure comparison: [`test-results/performance/2026-09-05-runtime-performance-trim.json`](../../test-results/performance/2026-09-05-runtime-performance-trim.json).
