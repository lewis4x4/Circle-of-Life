# Agent gates runbook

**Circle of Life / Haven — portable copy.** Canonical source: `docs/agent-gates-runbook.md`.

Every approved segment must pass **deterministic gates** before you treat work as shippable: implement one bounded segment, run `segment:gates`, keep the JSON artifact, fix blockers, then **one atomic commit** (and push when policy requires).

## Mission (ship gate)

Mission text lives in `docs/mission-statement.md`, `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, and `agents/registry.yaml`. Each segment should record **mission alignment**: `pass` | `risk` | `fail`. Waivers need owner, reason, expiry, and a remediation issue.

## Standard flow

1. Implement **one** bounded segment (no scope creep).
2. Run **`npm run segment:gates -- --segment "<segment-id>"`**  
   - Add **`--ui`** when routes, layouts, or visual behavior changed (also runs axe on the same routes unless `--no-a11y`).
   - Use **`--no-chaos`** only when the segment contract allows skipping stress simulation.
3. Fix failures; re-run until the gate report shows **PASS** and `test-results/agent-gates/*.json` exists.
4. Stage **only** segment files; **conventional commit**; push per team policy.
5. Start the next segment or hand off with a segment note that cites the segment id and mission alignment.

## Commands (**npm**, not Bun)

This repo uses **npm** for the script contract (`package.json`).

```bash
npm run migrations:check
npm run lint
npm run build
npm run build:web
npm run stress:test
npm run design:review
npm run segment:gates -- --segment "<segment-id>" [--ui] [--no-chaos] [--no-a11y] [--design-advisory]
```

### `segment:gates` flags (summary)

- **`--ui`** — design review + accessibility routes (needs dev server / `BASE_URL` as in full runbook).
- **`--no-chaos`** — skip `stress:test`.
- **`--no-a11y`** — with `--ui`, skip axe (design may still run).
- **`--design-advisory`** — design failures non-blocking; axe still applies when `--ui` unless `--no-a11y`.

Full tables (env vars, Playwright install, artifacts, CI) are in **`docs/agent-gates-runbook.md`**.

## Artifacts (proof)

- Gate JSON: **`test-results/agent-gates/<timestamp>-<segment-id>.json`**
- Do **not** call a gated segment “done” without that **PASS** artifact when gates apply.

## References

- `agents/registry.yaml` — gate order and mission
- `agents/playbooks/` — role playbooks
- `CODEX.md` — engineer command contract
