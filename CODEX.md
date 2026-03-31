# Codex / engineer contract

## Mission (ship gate)

> **North star:** Build **Haven**—a unified operations platform for **assisted living facilities**, **home health**, and **home- and community-based care**—so multi-site and multi-entity operators can run clinical workflows, compliance, workforce, family engagement, and business operations on **one secure, role-governed data layer**. Improve **resident safety and quality**, **regulatory readiness**, **staff clarity**, and **owner visibility**. Use **AI** to reduce administrative burden and surface risk early; it must remain **subordinate to human judgment, licensure rules, and auditability**.

## Execution model

1. Implement one **bounded segment** at a time.
2. Run **`npm run segment:gates -- --segment "<id>"`** (add `--ui` when UI/routes changed).
3. Do not claim “done” without a **machine-readable gate artifact** under `test-results/agent-gates/`.
4. On required gate **PASS**: stage only segment files, **atomic commit**, push, then start the next segment.

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

## References

- Implementation specs (drop zone): `docs/specs/` — see `docs/specs/README.md`
- Full agent registry: `agents/registry.yaml`
- Playbooks: `agents/playbooks/`
- Runbook: `docs/agent-gates-runbook.md`
- Next.js agent notes: `AGENTS.md`
