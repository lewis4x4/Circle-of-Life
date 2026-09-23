# Codex / engineer contract

## Mission (ship gate)

> **North star:** Build **Haven** for Circle of Life: **Expand. Perfect. Secure. Multiply. Through enhanced management by virtual staff and real time, accurate access to the complete body of information upon which we thrive.** Support assisted living operations across facilities and legal entities on **one secure, role-governed data layer**, improving resident safety and quality, regulatory readiness, staff clarity, and owner visibility. AI must remain **subordinate to human judgment, licensure rules, and auditability**.

## Execution model

1. Implement one **bounded segment** at a time.
2. Run **`npm run segment:gates -- --segment "<id>"`** (add `--ui` when UI/routes changed).
3. Do not claim “done” without a **machine-readable gate artifact** under `test-results/agent-gates/`.
4. On required gate **PASS**: stage only segment files, create an **atomic Lore-protocol commit**, push, create/update the PR, wait for required checks, and fix failures.
5. Unless Brian explicitly set `draft`, `hold`, `review-only`, `source-only`, or `do not deploy`, merge to `main` and complete the repository-defined production release path.
6. Apply required production migrations, set or rotate required hosted secrets without printing their values, and deploy changed Edge Functions, jobs, crons, configuration, and application services in the verified target and documented release order. Do not stop for a human on deploys, secret configuration, or production database changes.
7. Always verify the exact hosted revision and applicable health/live smoke checks. Verify migration-ledger parity and function/job versions when those surfaces changed. Follow the post-merge rule in `AGENTS.md`: ordinary app-only work may close without waiting only when the retained PR proof reports a safe non-sensitive classification and an exact tested-tree match; all sensitive, unsafe, missing-proof, or mismatched releases await successful post-merge CI. A merge or started deployment is not release proof.
8. Before updating Linear, follow `docs/LINEAR-WORKFLOW.md`; keep delivery, technical deployment evidence, human decisions, and release/acceptance as separate issues with real dependency links.

Use concise `gh run view --json ...` polling. Do not repeatedly stream unchanged `gh run watch` output or rerun full local gates for a tree already proven by required CI.

## Form primitives (operator-facing defaults)

Shared UI primitives—including **`QuietDatePicker`**—must **not** silently imply a chosen date or other value for the operator. **Empty state stays empty** until the caller supplies an explicit controlled **`value`** or an explicit **`initialVisibleMonthIso`** when the design only needs a calendar *viewport anchor* without selecting a date.

## Commands

| Script | Purpose |
|--------|---------|
| `npm run dev` | Local app |
| `npm run build` | Migration check + Next production build |
| `npm run build:web` | Same as root build (no `apps/web` in this repo yet) |
| `npm run lint` | ESLint (`src/`) |
| `npm run audit:ci` | `npm audit --audit-level=high` |
| `npm run check:env-example` | Block JWT-like values in `.env.example` |
| `npm run check:secrets` | Scan tracked files for secret shapes |
| `npm run secrets:gitleaks` | Gitleaks (binary or Docker) |
| `npm run migrations:check` | SQL migration naming / sequence |
| `npm run migrations:verify:pg` | Replay migrations on throwaway Postgres (Docker) |
| `npm run a11y:routes` | Playwright + axe (needs `BASE_URL`) |
| `npm run design:review` | Playwright UI snapshots + report |
| `npm run stress:test` | Logic / chaos simulation suite |
| `npm run segment:gates` | Hygiene + security + lint + migrations + build + optional UI/a11y |
| `npm run demo:pilot-readiness` | Bundled local probes — set `BASE_URL`; optional `PILOT_READINESS_AUTH_SMOKE_REAL=1` runs Playwright `demo:auth-smoke:real` (Track A PH1-A04 / PH1-P04) |
| `npm run demo:auth-smoke:real` | Playwright — four pilot roles; needs running app + seed credentials |

## References

- Autonomous loop (BOOT / FIND / RECORD): `docs/Autonomous.md`
- Implementation specs (drop zone): `docs/specs/` — see `docs/specs/README.md`
- Full agent registry: `agents/registry.yaml`
- Playbooks: `agents/playbooks/`
- Runbook: `docs/agent-gates-runbook.md`
- Production operations: `docs/specs/PHASE1-OPS-VERIFICATION-RUNBOOK.md`
- Linear workflow: `docs/LINEAR-WORKFLOW.md`
- Next.js agent notes: `AGENTS.md`
- Login roles (as of 2026-09-22, COL-615): `AGENTS.md` "Roles". `nurse`, `caregiver`, `dietary` and `dietary_aide` are retired; grant `med_tech` / `cook` in every new migration (`supabase/tests/review_role_consolidation.sql` fails the replay otherwise).
