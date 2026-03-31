<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Circle of Life — agent operating guide

## Mission (ship gate)

> **North star:** Build **Haven**—a unified operations platform for **assisted living facilities**, **home health**, and **home- and community-based care**—so multi-site and multi-entity operators can run clinical workflows, compliance, workforce, family engagement, and business operations on **one secure, role-governed data layer**. Improve **resident safety and quality**, **regulatory readiness**, **staff clarity**, and **owner visibility**. Use **AI** to reduce administrative burden and surface risk early; it must remain **subordinate to human judgment, licensure rules, and auditability**.

Record **mission alignment** (`pass` | `risk` | `fail`) in segment handoffs and gate summaries. Misalignment can block release even when tests pass.

## Autonomous segment discipline

- One segment at a time; one atomic commit per completed segment.
- No architecture reset without explicit approval.
- After implementation, run **`npm run segment:gates -- --segment "<segment-id>"`** (`--ui` when visual or routing work changed — also runs axe on the same routes unless `--no-a11y`). CI runs the same gate bundle via `.github/workflows/ci-gates.yml` (includes gitleaks, audit, ESLint, Docker migration replay).
- Security, RLS, and workspace boundaries are part of the gate model—not a post-release afterthought.

## Where things live

| Area | Path |
|------|------|
| **Implementation specs (you drop files here)** | **`docs/specs/`** |
| Agent registry & gate order | `agents/registry.yaml` |
| Role playbooks | `agents/playbooks/` |
| Gate report schema | `agents/schemas/gate-report.schema.json` |
| Segment gate runner | `scripts/agent-gates/run-segment-gates.mjs` |
| Design automation | `.agents/design-review-runner.mjs` |
| Stress / simulation | `.agents/stress-test/run.ts` |
| Gate JSON artifacts | `test-results/agent-gates/` |

## Product roadmap (context only)

Broad **COL / Haven** ALF multi-entity SaaS roadmap (modules, phases, tech direction) is summarized in **`docs/roadmap-overview.md`**. The full narrative lives in **`/Users/brianlewis/Downloads/COL_SaaS_Moonshot_Roadmap.md`**. Use those for orientation only.

**Authoritative build scope:** Markdown (and related) specs you place in **`docs/specs/`** (see **`docs/specs/README.md`**). Implement from those files + your messages—not from the full roadmap alone.

## Engineer / Codex entrypoint

See **`CODEX.md`** for the command contract and commit discipline.
