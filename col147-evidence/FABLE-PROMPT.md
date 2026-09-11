MODEL LOCK: Fable 5.1 (`claude -p --model fable`). You are implementing COL-147 / HFO-09 only.

Working directory (already checked out):
/Users/brianlewis/Circle of Life/Haven Facility Source Adapters
Branch: codex/hfo-col147-source-adapters
Base tip: db451440 (COL-148 closeout on codex/hfo-col148-workspace). Source commit 97ac1457 is ancestor. Do NOT mutate the COL-148 worktree at Haven Facility Workspace.

Issue UUID: 17ccab14-f6d0-4b90-a525-d29e99e644ca (COL-147). Linear status was moved In Progress by the orchestrator.
Blockers COL-139, COL-142, COL-145 are Done (reviewed/gated/unmerged source).

## Scope
Allowlisted source adapter/outbox contract: final source ID/version + matching predicate (activity, site, subject, period, rule). Preserve pending reconciliation, source correction/void, separate administrator review.

Acceptance:
1. Final matching source satisfies intended occurrence once; replay/concurrent delivery must not duplicate receipts/satisfaction.
2. Wrong period/site/subject, draft, or invalid source cannot satisfy.
3. Correction/void keeps invalidation + needs-attention history; neither erases proof nor leaves false completion.

Do not assume log existence = final, or completion = related repair/admin review done. Settle engineering contract BEFORE adapters. Domain connections = later COL-154..159. COL-147 = shared mechanism only. Do not invent finality, provider behavior, policy, owners, or dates.

## Read first
AGENTS.md, CODEX.md.
docs/facility-operations/CHECKPOINT.md, COL-148-HANDOFF.md, FABLE-5.1-HANDOFF.md if present,
col148-evidence/verification.json, independent-review.json, implementation-manifest.json, linear-state.json,
COL-18-BASELINE, INTEGRATION-MANIFEST, COL-139/142/143/145/146 contracts/handoffs.
Roadmap if present under sibling folders or docs.
Migration 220_col_v2_operational_logs.sql (lines 4, 65), R03/R05/R06, occurrence identity, immutable receipt/correction, current-authority helpers.
COL-148 src/lib/operations/read-all.ts + workspace/detail readers if projecting state.
Respect provider row caps; preserve microseconds in history keys; exact totals; explicit partial failures; before/after consistency.

## Delivery
1. Write concrete COL-147 engineering contract under docs/facility-operations/ (and col147-evidence/).
2. Before any DDL: recheck main + every concurrent migration number. HFO stack provisional end = 345. Do NOT assume 346 free — pick next free after reconciling overlapping finance/source branches.
3. Implement shared mechanism + focused tests: wrong scope, nonfinal, duplicate/concurrent delivery, source version change, void/correction invalidation, domain proof vs admin review separation. Native SQL probe + observed-lock race patterns.
4. Native scratch PG17: socket /Users/brianlewis/.hermes/tmp/agent-runs/hfo-col139-20260910-105544 port 55443 — verify still exists. Baselines col143_base343, col145_base344, col146_base345. Use CHECKPOINT.md native replay vars. No hosted data.
5. Gates: focused tests, npm run typecheck, npm run lint, native replay/races as needed, strict `npm run segment:gates -- --segment COL-147-HFO-SOURCE-ADAPTERS` (--ui only if UI changed).
6. Evidence + independent review under col147-evidence/. Commit owned files only with Lore intent/trailers. Push branch. Draft PR against immediately preceding completed branch (`codex/hfo-col148-workspace`). Bounded Linear closing note (source-only; never imply hosted/provider/staff/clinical/operating-cycle/cutover/launch).

## Boundaries
No merge, hosted migrations, deploy, activate rules/schedules, reminders, or external transmit. COL-143 hosted acceptance untouched. Do not extend prior dependency exceptions. Ask only for a missing decision that blocks safe concrete implementation — write the question to col147-evidence/BLOCKER.md and stop that path.

## Report when GATE ready
Write col147-evidence/GATE.md with: GATE pass|miss|retry-left, commit SHAs, draft PR URL, evidence paths, Linear note summary, blockers. Also print that summary at the end of your run.

MODEL_USED must appear in GATE.md. Done = reviewed gated source only.
