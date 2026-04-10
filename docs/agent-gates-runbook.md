# Agent gates runbook

Deterministic segment gates mirror the **Autonomous Codex** model: implement a bounded segment, run gates, keep JSON proof, then commit.

**Loop continuity:** Session discipline (BOOT → FIND → RECORD) lives in **`docs/Autonomous.md`**.

## Mission (ship gate)

Duplicated in `docs/mission-statement.md`, `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, and `agents/registry.yaml`. Every segment should record **mission alignment**: `pass` | `risk` | `fail`.

## Commands (npm)

| Script | What it does |
|--------|----------------|
| `npm run check:env-example` | Rejects JWT-shaped / risky placeholders in `.env.example` |
| `npm run check:secrets` | Scans git-tracked files for common secret patterns |
| `npm run audit:ci` | `npm audit --audit-level=high` |
| `npm run secrets:gitleaks` | Gitleaks (local binary or Docker) |
| `npm run migrations:check` | Validates `supabase/migrations/*.sql` naming and `001..N` sequence |
| `npm run migrations:verify:pg` | Replays migrations on throwaway Postgres 16 (Docker + auth stub) |
| `npm run lint` | ESLint on `src/` |
| `npm run a11y:routes` | Playwright + axe (`BASE_URL` / `AXE_ROUTES`; app must be up) |
| `npm run build` | Migrations check + `next build` |
| `npm run build:web` | Same as root build today; use `apps/web` later if you split packages |
| `npm run stress:test` | `.agents/stress-test/run.ts` — `PASS\|FAIL\|ADVISORY` lines |
| `npm run design:review` | Playwright snapshots → `test-results/design-review/` |
| `npm run segment:gates` | Hygiene, security, lint, migrations, Docker verify, build, stress, optional UI/a11y → `test-results/agent-gates/*.json` |

### Segment gates CLI

```bash
npm run segment:gates -- --segment "your-segment-id" [--ui] [--no-chaos] [--no-a11y] [--design-advisory]
```

- **`--ui`** — runs `design:review` and **`a11y:routes`** (axe) unless `--no-a11y` (requires app at `BASE_URL`).
- **`--no-chaos`** — skips `stress:test`.
- **`--no-a11y`** — with `--ui`, skips axe (design still runs).
- **`--design-advisory`** — design failures become **advisory** (non-blocking); axe remains required when `--ui` unless `--no-a11y`.

### Environment (gates)

| Variable | Effect |
|----------|--------|
| `CI=true` | Gitleaks must run (install binary or use Docker) |
| `REQUIRE_PG_VERIFY=1` | Docker migration replay is **blocking** if it fails or Docker is unavailable (set in CI workflow) |
| `SKIP_PG_VERIFY=1` | Skip Docker migration verify (local only; conflicts with `REQUIRE_PG_VERIFY=1`) |
| `SKIP_GITLEAKS=1` | Skip gitleaks (local only; **not** for CI) |
| `FAIL_ON_NEXT_DEPRECATIONS=1` | Fail gates if `next build` reports the middleware → proxy deprecation |

GitHub Actions: `.github/workflows/ci-gates.yml` runs gates with `CI=true` and `REQUIRE_PG_VERIFY=1`.

## Playwright setup

After `npm install`, install browsers once:

```bash
npx playwright install chromium
```

For UI gates, start the app in another terminal (example):

```bash
npm run dev
BASE_URL=http://127.0.0.1:3000 npm run design:review
```

Override routes:

```bash
DESIGN_REVIEW_ROUTES="/,/login" npm run design:review
```

## Migrations directory

Default: `supabase/migrations`. Override with `MIGRATIONS_DIR=/abs/path`.

## Artifacts

- Gate reports: `test-results/agent-gates/<iso-timestamp>-<segment>.json`
- Design report: `test-results/design-review/report.json`
- Screenshots: `test-results/design-review/screenshots/`

Schema: `agents/schemas/gate-report.schema.json`.

## Optional design spec smoke

```bash
npm run design:review
node --test .agents/design-review.spec.js
```
