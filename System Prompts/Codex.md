# Codex / engineer contract

**Circle of Life / Haven — portable copy.** Canonical source: repo root `CODEX.md`.

## Mission (ship gate)

> **North star:** Build **Haven**—a unified operations platform for **assisted living facilities**, **home health**, and **home- and community-based care**—so multi-site and multi-entity operators can run clinical workflows, compliance, workforce, family engagement, and business operations on **one secure, role-governed data layer**. Improve **resident safety and quality**, **regulatory readiness**, **staff clarity**, and **owner visibility**. Use **AI** to reduce administrative burden and surface risk early; it must remain **subordinate to human judgment, licensure rules, and auditability**.

## Execution model

1. Implement one **bounded segment** at a time.
2. Run **`npm run segment:gates -- --segment "<id>"`** (add **`--ui`** when UI, routing, or layout behavior changed).
3. Do not claim “done” without a **machine-readable gate artifact** under `test-results/agent-gates/`.
4. On required gate **PASS**: stage only segment files, **atomic conventional commit**, push per policy, then start the next segment.

## Commands (**npm**)

| Script | Purpose |
|--------|---------|
| `npm run dev` | Local app |
| `npm run build` | Migration check + Next production build |
| `npm run build:web` | Same as root build |
| `npm run lint` | ESLint (`src/`) |
| `npm run audit:ci` | `npm audit --audit-level=high` |
| `npm run check:env-example` | Block JWT-like values in `.env.example` |
| `npm run check:secrets` | Scan tracked files for secret shapes |
| `npm run secrets:gitleaks` | Gitleaks (binary or Docker) |
| `npm run migrations:check` | SQL migration naming / sequence |
| `npm run migrations:verify:pg` | Replay migrations on throwaway Postgres (Docker) |
| `npm run a11y:routes` | Playwright + axe (needs `BASE_URL`) |
| `npm run design:review` | Playwright UI snapshots + report |
| `npm run stress:test` | Logic / simulation suite |
| `npm run segment:gates` | Hygiene + security + lint + migrations + build + optional UI/a11y |

## References

- Implementation specs: `docs/specs/` — see `docs/specs/README.md`
- Agent registry: `agents/registry.yaml`
- Playbooks: `agents/playbooks/`
- Runbook: `docs/agent-gates-runbook.md`
- Next.js agent notes: `AGENTS.md`

## Git policy

- Stage only files for the **current segment**
- **Conventional commits** (`feat:`, `fix:`, `chore:`, …)
- No mixed-purpose commits across unrelated segments
