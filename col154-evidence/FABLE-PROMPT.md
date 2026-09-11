# COL-154 / HFO-18 — Fable 5.1 implementer brief

You are Fable 5.1 implementing COL-154 only. Haven is GATE/orchestrator. No merge/deploy.

## Repo
- Worktree: `/Users/brianlewis/Circle of Life/Haven Facility Drill Generators`
- Branch: `codex/hfo-col154-drill-generators` (from COL-147 tip `a625b75a`)
- Do not mutate `/Users/brianlewis/Circle of Life/Haven Facility Source Adapters`

## Goal
Register the first allowlisted drill + generator/asset observation adapters onto the COL-147 source-link mechanism (migration 346). Source items AL-W01, AL-M05, AL-M06, AL-A07, AL-A08.

## Order of work
1. Settle engineering contracts in `docs/facility-operations/col154-evidence/engineering-contracts.md` before DDL.
2. Recheck migration slot (346 taken; provisional next on this stack — do not fight Finance renumber).
3. Implement adapters/readers/rules + probes/tests. Preserve inspection vs log review / repair / service. Reconcile contradictory drill consumers.
4. Checkpoint-commit early (Lore intent/trailers). Push often.
5. Focused tests, typecheck, lint, native concurrency/replay as appropriate, strict `npm run segment:gates -- --segment <COL-154 segment id>` (discover exact id; no `--ui` unless UI changed).
6. Evidence + `independent-review.json` (+ `.md`). Update GATE.md.
7. Draft PR vs `codex/hfo-col147-source-adapters`. Linear note only if asked — Lewi owns Done.

## Hard stops
- Do not invent Homewood day/time deadlines (Q06/Q09/Q14 open).
- No self-test/photo alone = staff observation.
- No merge, hosted apply, deploy, policy activation.
- COL-143 hosted Storage untouched.
- No PHI / resident names in evidence.

## Report back to Haven when checkpoint + gates ready
SHAs, draft PR URL, evidence paths, GATE candidate status, blockers.
