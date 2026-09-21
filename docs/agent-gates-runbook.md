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
| `npm run migrations:verify:pg` | Replays migrations on throwaway Postgres 17 (Docker + auth stub) |
| `npm run migrations:verify:remote` | Probes linked Supabase for critical columns/tables (migrations 250–288); requires `.env.local` service role |
| `npm run lint` | ESLint on `src/` (`--max-warnings 0`). Historic `react-hooks/*` compiler-rule debt is baselined in `eslint-suppressions.json` (ESLint bulk suppressions) so the gate fails only on new violations; `npx eslint src --prune-suppressions` after paying some down. |
| `npm run a11y:routes` | Playwright + axe (`BASE_URL` / `AXE_ROUTES`; app must be up) |
| `npm run build` | Migrations check + `next build` |
| `npm run build:web` | Same as root build today; use `apps/web` later if you split packages |
| `npm run stress:test` | `.agents/stress-test/run.ts` — `PASS\|FAIL\|ADVISORY` lines |
| `npm run design:review` | Playwright snapshots → `test-results/design-review/` |
| `npm run segment:gates` | Hygiene, security, lint, migrations, Docker verify, build, stress, optional UI/a11y → `test-results/agent-gates/*.json` |

### Segment gates CLI

```bash
npm run segment:gates -- --segment "your-segment-id" [--ui] [--no-chaos] [--no-a11y] [--design-advisory] [--advisory-check "<check-id>"]
```

- **`--ui`** — runs `design:review` and **`a11y:routes`** (axe) unless `--no-a11y` (requires app at `BASE_URL`).
- **`--no-chaos`** — skips `stress:test`.
- **`--no-a11y`** — with `--ui`, skips axe (design still runs).
- **`--design-advisory`** — design failures become **advisory** (non-blocking); axe remains required when `--ui` unless `--no-a11y`.
- **`--advisory-check "<check-id>"`** — repeatable. Downgrades a failing named check to **advisory** for that run only. Default behavior remains strict; CI should not use this. (`qa.eslint` no longer needs it — the lint debt is baselined, see `npm run lint` above.)

Checks stream prefixed output live. Quiet commands emit a 30-second `still running` heartbeat so long builds and migration replays do not look hung.

### Environment (gates)

| Variable | Effect |
|----------|--------|
| `CI=true` | Gitleaks must run (install binary or use Docker) |
| `REQUIRE_PG_VERIFY=1` | Docker migration replay is **blocking** if it fails or Docker is unavailable. CI sets this for database-sensitive or unclassifiable changes. |
| `SKIP_PG_VERIFY=1` | Explicitly skip Docker migration verify. CI sets this only after the fail-closed classifier proves the diff is not database-sensitive; it conflicts with `REQUIRE_PG_VERIFY=1`. |
| `SKIP_GITLEAKS=1` | Skip gitleaks (local only; **not** for CI). The runner records `security.gitleaks` as **skipped**, not passed. |
| `FAIL_ON_NEXT_DEPRECATIONS=1` | Fail gates if `next build` reports the middleware → proxy deprecation |

GitHub Actions: `.github/workflows/ci-gates.yml` always runs the application/platform gates with `CI=true`. `scripts/ci/classify-changes.mjs` selects exactly one of `REQUIRE_PG_VERIFY=1` or `SKIP_PG_VERIFY=1`; unknown diff state requires the replay. `.github/workflows/ci-nightly.yml` always requires the full replay.

Changes confined to the explicit CI-policy allowlist (`.github/workflows/**`, `scripts/ci/**`, the gate contract test, and the release-contract/runbook mirrors) use `policy_only=true`. That lane runs only the targeted classifier/proof/workflow regressions plus package/environment checks, dependency audit, tracked-secret scan, and checksum-pinned Gitleaks. It skips application/typecheck, domain Edge suites, SQL replay, build, stress, and browser fixtures. One changed path outside the allowlist—or any unsafe classification—fails closed to the normal lane. Policy-only remains release-sensitive and therefore still awaits post-merge CI.

## Tested-tree release proof

### Netlify production failure observation

`scripts/ci/netlify-production-failure-alert.mjs` serves the production observer,
finite synthetic replay, and source-isolated Actions watcher. The site is fixed
to `be2bb95e-ba70-47f8-8d2d-70cd37b9b41a`; mutation requires
`lewis4x4/Circle-of-Life` on `refs/heads/main`. The repository owner owns the
Netlify credential and receives issue assignment. Provision `NETLIFY_AUTH_TOKEN`
as an Actions secret through a secret-safe transfer after verifying that exact
site. Never print, persist, or pass the credential in command-line arguments.

The live observer alone receives that credential. It validates site, production
context, main branch, full SHA and main ancestry, commit skip directive, deploy
identity, and RFC3339 timestamps. Preview, branch, draft, canceled, explicitly
superseded, and skip deployments (including Netlify's `skipped` flag) cannot
open incidents or establish recovery. The verified site name is
`circleoflifealf`; links use its fixed Netlify project path and production URL
`https://circleoflifealf.com`. Pending IDs remain
durable regardless of age. Raw provider errors and arbitrary provider URLs are
never copied into issues or logs; unknown stages explicitly direct the owner
to the constructed deploy-log URL. Recognized exact provider stage signatures
map to fixed categories. Commit subjects are constrained, length-bounded, and
withheld when credential-like; commit bodies are not retained.

Bootstrap enumerates the complete unresolved window through the currently
published production deploy, which is the verified recovery baseline; it does
not walk recovered lifetime history and consume the provider rate limit. Later
scans use a retained deploy anchor and ten-minute overlap, with
direct reads for every unresolved ID. The adapter checks newest-created order
through the anchor; observed disorder disables its early pagination exit.
Historical completed SHAs and acknowledged failures are not reverified on each
poll. Missing anchors, metadata conflicts, or request bounds fail closed.

One canonical assigned issue stores a version-1 owned state block with a 32 KiB
limit and 200-entry bounds. Human notes after the owned block are retained.
Canonical issues and effect comments must be authored by the repository owner
or GitHub Actions bot. Other users' matching markers are not trusted state or
deduplication proof. Nested state fields, identities, timestamps, subjects, and
effect keys are checked before rendering or mutation.
Distinct deploy IDs count attempts, even for one SHA. Desired effects are saved
before mutation, and comments have exact idempotency markers. Assignment and
occurrence readback establishes routing completion; a write response alone does
not. Measure assignment time against provider `updated_at` only with the label
"exact failure time unavailable". Publication evidence is separate from live
route availability.

Recovery requires a later-created main production deploy, a valid publication
timestamp after the failure's first observation, and matching current site
publication. Re-fetch publication and failure history before and after closing;
a detected race reopens the issue. Cross-service APIs are not atomic. Missing
proof retains the incident rather than inventing historical failure order.

The watcher is the sole writer of `haven-netlify-observer-health`; main CI uses
`haven-main-ci-alert`, and production uses `haven-netlify-production-alert`.
The observer-health source lists all statuses in the recent range, retains
unfinished IDs, fetches missed attempts, and scans three of thirty older day
shards per tick. Main CI retains the existing completed-notification route and
active-issue convention; its historical issues are not migrated into this
ledger. Main-CI catch-up is a separate future enhancement.
A full 31-day audit targets 50 healthy-platform minutes. Recovery waits for a
complete audit and later covering success from the exact head repository and
trusted event type; PR and fork runs cannot recover either route. Stale audit
coverage blocks recovery while completed partition progress still commits, so
subsequent ticks can restore a fresh audit. Durable coverage gaps update the
same fault chronology as failed workflow attempts. Each source is bounded to 50 GitHub
requests per execution and ten pages per partition; API remaining-quota headers
retain a 20% reserve. A cap or malformed/removed state is a visible coverage
blocker, never permission to discard pending work or reset counts.

Two schedules are intentional: provider observation at five-minute intervals
and independent watcher catch-up. Delayed/dropped GitHub execution can prevent
both detection and notification. Record actual full-audit timing, scheduler
starts, provider reads, and assigned issue readbacks before claiming the
under-60-minute healthy-platform target. Configuration alone is not timing proof.

Dispatch `mode=replay` on main for finite synthetic evidence. It creates only
`haven-netlify-replay:<run-id>` with `[SYNTHETIC]` and the synthetic label. The
same reducers and GitHub adapter prove counts 1/1/2 and marked recovery. The
always-run finalizer closes only that exact synthetic issue after a failure;
cleanup closure is explicitly not recovery proof and does not turn a failed
job green. Retain synthetic issues and comments for review.

Exceptional repair: identify the canonical issue from dated run evidence,
export its sanitized owned state and marked comments into the current run's
private evidence directory, reconstruct the proposed versioned state against
complete provider/Actions history, review the proposed state, and update only
the owned block. Never auto-delete/select duplicate issues or reset activation.
Dispatch observation and read back deduplication, assignment, and coverage
before closing monitoring health. Policy tests plus hygiene/audit/secrets are
the required local lane; this release-sensitive workflow change still requires
successful post-merge CI, exact merged publication, hosted smoke, actual
scheduled observations, full audit evidence, and the real-GitHub replay.

Every successful pull-request gate uploads `release-tree-proof`, containing the exact merge tree checked out by Actions and the fail-closed change classification. Strict `Required CI summary` branch protection establishes that this proof came from current-base required CI.

After merge, download the artifact into a run-owned scratch directory and compare it with the actual merged revision:

```bash
gh run download "$PR_RUN_ID" --name release-tree-proof --dir "$RUN_OWNED_SCRATCH/release-tree-proof"
node scripts/ci/release-tree-proof.mjs verify \
  --proof "$RUN_OWNED_SCRATCH/release-tree-proof/release-tree-proof.json" \
  --revision "$MERGED_SHA"
```

The verifier reports `tree_matches`, `app_only_eligible`, and `post_merge_wait_required`. It fails on a tree mismatch. Treat missing/invalid proof as a mandatory post-merge wait.

An app-only release can close without waiting for the still-running main CI only when all of the following are true:

1. Protected current-base `Required CI summary` passed.
2. `post_merge_wait_required=false` and `tree_matches=true`.
3. The verified production target serves the exact merged revision.
4. Applicable hosted smoke checks pass.
5. `gh issue list --state open --label main-ci-failure` returns no alert.

Post-merge waiting remains mandatory for release-sensitive paths, unsafe classification, missing proof, or mismatched trees. Post-merge CI always continues. `.github/workflows/main-ci-failure-alert.yml` assigns a GitHub issue to the repository owner on failure, escalates consecutive failures on the same open issue, and closes it after a successful main run. An open alert blocks later release claims and requires reopening the related Linear delivery issue when applicable.

For status, prefer compact state-change polling:

```bash
gh run view "$RUN_ID" --json status,conclusion,jobs \
  --jq '{status,conclusion,jobs:[.jobs[]|{name,status,conclusion}]}'
```

Read full logs only after failure or another meaningful transition. Do not repeatedly stream unchanged `gh run watch` output, and do not rerun a full local gate for an identical tree already covered by required CI.

## Known npm audit moderates

- `postcss <8.5.10` remains through `next@16.2.6`'s nested `postcss@8.4.31` copy.
- Do **not** run `npm audit fix --force` for this advisory; npm proposes a breaking Next downgrade path rather than a safe patch.
- Recheck this note after each Next upgrade and remove it once Next ships a nested `postcss >=8.5.10`.

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

Authenticated UI routes can use `UI_REVIEW_STORAGE_STATE=/absolute/private/path/state.json` with both existing UI runners. Create that Playwright state through a real sign-in to the intended isolated test environment; keep cookies/tokens outside Git and never copy production state into a synthetic run. Defaults remain anonymous, invalid state fails, and a redirect to login never counts as protected-route coverage. The design report records whether state was supplied without recording its contents. `UI_REVIEW_READY_SELECTOR` can require a visible route-specific control before either UI check, so a loading shell does not substitute for the requested form.

For native HTTP staging, the existing `SEGMENT_GATES_USE_DEV_SERVER=1` option uses an independently started development server at `BASE_URL`; the formal bundle still requires its production build. Point `DESIGN_REVIEW_ROUTES` and `AXE_ROUTES` at the actual protected route. The state cookie origin must match `BASE_URL`. Remove synthetic environment/state files and rebuild without staging configuration before any production artifact use.

Override routes:

```bash
DESIGN_REVIEW_ROUTES="/,/login" npm run design:review
```

## Migrations directory

Default: `supabase/migrations`. Override with `MIGRATIONS_DIR=/abs/path`.

### Remote schema drift (production)

`migrations:verify:pg` replays on a **fresh** Docker Postgres — it does **not** detect when `schema_migrations` rows exist on the linked project but DDL never ran.

After pushing migrations to the linked Supabase project, run:

```bash
npm run migrations:verify:remote
```

Requires `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`. On failure, re-apply the cited migration file:

```bash
npx supabase db query --linked -f supabase/migrations/NNN_<name>.sql
```

See `docs/Autonomous.md` RECORD **schema-drift-250-288-repair** (2026-06-28).

## Artifacts

- Gate reports: `test-results/agent-gates/<iso-timestamp>-<segment>.json`
- PR tested-tree proof: `test-results/ci-release-proof/release-tree-proof.json`
- Design report: `test-results/design-review/report.json`
- Screenshots: `test-results/design-review/screenshots/`

Schema: `agents/schemas/gate-report.schema.json`.

## Optional design spec smoke

```bash
npm run design:review
node --test .agents/design-review.spec.js
```
