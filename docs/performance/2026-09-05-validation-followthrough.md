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
