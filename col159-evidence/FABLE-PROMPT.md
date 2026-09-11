# COL-159 / HFO-22 — Fable 5.1 implementer brief

You are Fable 5.1 implementing COL-159 only. Haven is GATE/orchestrator. No merge/deploy.

## Repo
- Worktree: `/Users/brianlewis/Circle of Life/Haven Facility Dietary Admin`
- Branch: `codex/hfo-col159-dietary-admin` (from COL-154 tip `47455a13`)
- Do not mutate COL-147 / COL-154 / COL-143 worktrees

## Goal
Connect dietary, facility services and general admin evidence — complete AL coverage pass. Reuse existing domain logs/assets; define narrowly required inputs and source links onto the COL-147 mechanism (+ COL-154 adapters where relevant).

## Order
1. Settle engineering contracts before DDL.
2. Recheck migration slot (347 taken; provisional next on this stack).
3. Implement + probes/tests. Checkpoint-commit early. Push often.
4. Focused tests, typecheck, lint, concurrency/replay as appropriate, strict segment gate (discover exact COL-159 segment id; no `--ui` unless UI changed).
5. Evidence + independent-review.json. GATE.md. Draft PR vs `codex/hfo-col154-drill-generators`.
6. **Immediately notify Haven when draft PR + segment PASS exist** so Lewi/Brian hear it.

## Hard stops
- Do not invent Q09/Q11/Q14/Q28 Homewood day/time/thresholds.
- No merge/deploy/hosted apply. COL-143 hosted parked.
- No PHI / resident names in evidence.
