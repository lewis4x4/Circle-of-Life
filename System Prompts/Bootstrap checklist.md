# Bootstrap checklist — Circle of Life / Haven

Use this when **spinning up a new repo** or verifying this project’s agent-gates spine. In **this** repository, the items below are already present unless noted.

## Core docs and mission

- [x] `AGENTS.md` — Next.js notes + Haven operating guide
- [x] `CLAUDE.md` — pointer + mission ship gate
- [x] `CODEX.md` — npm commands + segment gates contract
- [x] `docs/mission-statement.md` — canonical mission text
- [x] `docs/agent-gates-runbook.md` — full gate commands, env, artifacts

## Agent system

- [x] `agents/registry.yaml` — mission, gate order, agent definitions
- [x] `agents/templates/segment-handoff.md`
- [x] `agents/templates/gate-report.md`
- [x] `agents/schemas/gate-report.schema.json`

## Automation scripts

- [x] `scripts/check-migration-order.mjs` (invoked by `migrations:check` in `package.json`)
- [x] `scripts/agent-gates/run-segment-gates.mjs`
- [x] `.agents/design-review-runner.mjs` (not `.js`)
- [x] `.agents/stress-test/run.ts`

## Artifacts and CI

- [x] `test-results/agent-gates/` (git-tracked gate JSON outputs)
- [x] `package.json` scripts: `segment:gates`, `build`, `lint`, `design:review`, `stress:test`, etc.
- [x] `.github/workflows/ci-gates.yml` (or equivalent) for CI parity with local gates

## First-time verification

- [ ] `npm install` and `npx playwright install chromium` (for UI/a11y gates)
- [ ] Copy `.env.example` → `.env.local` with real `NEXT_PUBLIC_SUPABASE_*` for local auth/data gates
- [ ] Run one dry-run segment end-to-end: implement a tiny change → `npm run segment:gates -- --segment "bootstrap-smoke" [--ui]` → confirm **PASS** JSON under `test-results/agent-gates/`

## Policy reminders

- **npm** is the package manager for scripts (not Bun).
- Replace or sync the **mission statement** in every duplicated location when it changes (`docs/mission-statement.md`, `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `agents/registry.yaml`).
