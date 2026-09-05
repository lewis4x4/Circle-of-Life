# Validation follow-through — 2026-09-05

Mission alignment: **pass**.

## Dependencies and migration environment

`npm audit fix` updated compatible transitive dependencies, leaving `package.json` unchanged. Audit findings fell from five (two high, two moderate, one low) to zero. The affected direct transitive entries are `@humanfs/node` 0.16.8, `browserslist` 4.28.9, `fast-uri` 3.1.7, `postcss-selector-parser` 7.1.6, and `qs` 6.16.0.

The migration stub error came from a mislabeled local Docker image: `pgvector/pgvector:pg17` and `public.ecr.aws/supabase/postgres:17.6.1.156` both pointed to `sha256:ca7871b587ca2c401ac0f325df6249c9aa0d25647ded34631158efc51176767f`. The verifier expects vanilla Postgres with pgvector, not a pre-initialized Supabase auth schema.

Pulled the official image with `docker pull pgvector/pgvector:pg17` (registry digest `sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f`). The complete replay then passed all 319 migration files plus RPC-grant, family-message, and team-space RLS SQL checks. No production schema or permission changes were needed.

Gate: [`dependency-audit-refresh`](../../test-results/agent-gates/2026-09-05T18-08-03-777Z-dependency-audit-refresh.json), **PASS**, including production build, lint, secret scans, stress, and migration replay.

## Regression baseline repair

Fixed a real rounding date bug: date-only values retain their calendar day, timestamps display in America/New_York, invalid values show the existing gap label, and formatters are reused. Updated stale tests to follow extracted display helpers, the intentionally disabled notifications route, and sanitized executive refresh errors. The UTC-year test now reads the UTC year.

The UI schema scanner now excludes test/spec fixtures and test directories. A temporary production JSX fixture still failed the scanner; the equivalent test fixture passed.

Validation: full Vitest suite **449 files, 2,843 passed, 2 opt-in benchmarks skipped**; the 26 rounding/survey tests also passed with `TZ=UTC`. Segment UI gate [regression-baseline-repair](../../test-results/agent-gates/2026-09-05T18-18-22-943Z-regression-baseline-repair.json) **PASS**, including build, lint, audit, migrations, design review, and axe. The earlier failed artifact is retained: it identified the test-fixture scanner false positive. Local UI checks used `/login` and `/admin/rounding/plans` without authentication, so they verify the login boundary rather than authenticated rounding content.

## Executive trend scheduling

`fetchResidentAssuranceFacilityTrendSeries` now starts its five independent reads together. Query columns, organization/deleted filters, UTC window, ordering, score arithmetic, and result shape are unchanged. `allSettled` consumes every rejection, then unwrapping in input order preserves the prior rejection priority before checking response errors. Errors now wait for all started reads to settle; the caller retains its existing timeout. Peak concurrent requests increase from one to five, while total requests remain five.

Five deterministic tests cover latest-score deduplication, facility/day aggregation, empty data, scope and time predicates, error/rejection precedence, and concurrent startup. Four compatibility tests pass on the original implementation; the concurrent-start test fails there and passes after refactoring. With simulated delays of 25 ms + four 20 ms reads, the serial wait is 105 ms and the parallel test finishes in 25 ms. This is scheduling evidence, not a measured production latency claim.

The full suite after this change passed **450 files, 2,848 tests**, with two opt-in benchmarks skipped.

## Authenticated browser witness

Used the owner's existing signed-in browser session on `circleoflifealf.com`; no credentials or session tokens were extracted. Executive intelligence, portfolio health, smart-rounding trend, resident roster, and staffing roster were visibly rendered. A pre-deployment direct return to Executive took 1,352 ms through the content observation; an earlier warm click-to-content observation was 3,238 ms. These include automation overhead and use different navigation methods, so they are not a before/after comparison. Several click observations were discarded because a section menu remained open. No clinical records were changed or copied into artifacts.

Gate: [executive-trend-parallel](../../test-results/agent-gates/2026-09-05T18-23-50-266Z-executive-trend-parallel.json), **PASS** — audit, secrets, lint, all 319 migrations, production build/TypeScript, and stress.

## Integration with current main

Merged `bae56e7b` into this branch after PR 447 landed. Preserved both work logs and the identical scanner exclusion, retaining the upstream formatting/comment. The dependency lock retained the audited versions. Integration gate [performance-followthrough-integration](../../test-results/agent-gates/2026-09-05T18-28-23-712Z-performance-followthrough-integration.json) **PASS**, including all **321** current migrations, build, lint, security, design review and axe. Full suite remains **2,848 passed / two skipped**. Route bundle budget passes: `/admin` 435.9 kB gzip and `/admin/executive` 442.4 kB, both below 450 kB.
