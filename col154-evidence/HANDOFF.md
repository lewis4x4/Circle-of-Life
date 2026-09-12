# Fable 5.1 — COL-154 / HFO-18 handoff

**[HFO-18] Connect drill and generator records to the checklist first**
Issue UUID: `1d27f038-74ed-42f3-92a6-72d69dfcd657` · COL-154
Owner: Brian reserved **Fable 5.1** (not Sol). Haven orchestrates + GATE. Lewi reviews + Linear closeout.

## Prior stack (do not mutate)
- COL-147 Done as reviewed/gated/unmerged source
- Tip: `a625b75a` on `codex/hfo-col147-source-adapters`
- Draft PR #476 vs `codex/hfo-col148-workspace` — do not merge
- Shared source-link mechanism (migration 346 provisional) is the platform COL-154 registers onto

## Worktree / branch
- Worktree: `/Users/brianlewis/Circle of Life/Haven Facility Drill Generators`
- Branch: `codex/hfo-col154-drill-generators` @ `a625b75a`
- Do **not** edit the finished COL-147 Source Adapters worktree for feature work

## Launch discipline
- Prefer streamed Shell `claude -p --model fable`; heartbeat = session jsonl + commits
- Checkpoint-commit early
- Auth probe already: FABLE_OK / `claude-fable-5-1`

## Scope
First allowlisted **drill** and **generator/asset observation** adapters on the COL-147 source-link mechanism.
Typed readings/outcome only where already approved.
Preserve actual inspection vs log review, repair and service; reconcile contradictory drill consumers.
Source items: AL-W01, AL-M05, AL-M06, AL-A07, AL-A08

## Acceptance
1. A final approved drill/source log satisfies the correct site/activity/period once; separate review stays outstanding where required.
2. Two generators and source correction/void/replay behave correctly; a failed observation leaves the issue open.
3. No automatic self-test or photo alone claims staff observation; **unconfirmed Homewood day/time does not invent deadline**.

## Hard opens — do not invent
Q06, Q09, Q14. Leave unresolved Homewood day/time explicit.

## Delivery
Contract first. Recheck migration numbers (346 taken — next free on this stack is likely 347; reconcile before DDL). Segment gates + IR. Draft PR vs `codex/hfo-col147-source-adapters`. Done = reviewed gated source only. No merge/deploy. COL-143 hosted untouched.
