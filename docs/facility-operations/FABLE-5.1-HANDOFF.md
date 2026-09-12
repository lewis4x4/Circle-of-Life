# Fable 5.1 — next module handoff

Resume the Haven Facility Operations build with **COL-147 / HFO-09: Link final source records to requirements with replay and invalidation handling**. Do not restart COL-148 or merge/deploy this stack. The owner requested this handoff after COL-148 closeout and explicitly reserved the next module for Fable 5.1.

Completed source: **`97ac1457`**, **draft PR #475** against COL-146, **COL-148 Done as reviewed/gated/unmerged source**. Final strict UI gate and 619 tests passed. A later documentation-only commit records this closeout; follow the current branch tip. COL-143 remains In Progress and COL-147 remains Backlog, verified by live readback.

## Verify the closeout before starting

Read `docs/facility-operations/CHECKPOINT.md`, `COL-148-HANDOFF.md`, `col148-evidence/verification.json`, `independent-review.json`, `implementation-manifest.json` and `linear-state.json` on `codex/hfo-col148-workspace`. They hold the final gate, commit/PR references and source-only acceptance. Use the live branch tip rather than the old incoming checkpoint `77ce6d2e`.

Current worktree: `/Users/brianlewis/Circle of Life/Haven Facility Workspace`. Parent branch: `codex/hfo-col146-recovery`, `d9f5ffb2`. COL-145 is `c7dc9efc`, draft PR #473; COL-146 draft PR #474. COL-143 checksum amendment is `45ea4ea9`, draft PR #472, **In Progress** with hosted Storage proof open. `STAGING-INTEGRATION-PACKAGE.md` is a runbook, not executed proof. COL-140 remains unapproved; its unresolved Homewood policy decisions do not prohibit shared source work.

Fetch remote tips and inspect worktree heads/status before editing. The COL-148 worktree was clean on arrival, but unrelated worktrees had pre-existing changes; see `col148-evidence/worktree-preflight.json`. Preserve all concurrent work. Create a separate worktree and branch for COL-147, based on the completed stack, rather than changing the completed COL-148 worktree.

## COL-147 scope and acceptance

Verified in live Linear on September 10, 2026: COL-147 is **Backlog**. Its blockers COL-139, COL-142 and COL-145 are **Done as reviewed, gated, unmerged source**. Recheck these states before starting.

Issue UUID: `17ccab14-f6d0-4b90-a525-d29e99e644ca`. Linear title: `[HFO-09] Link final source records to requirements with replay and invalidation handling`.

Build an allowlisted source adapter/outbox contract using the final source ID/version and an explicit matching predicate for activity, site, subject, period and rule. Preserve pending reconciliation, source correction/void and separate administrator review.

Acceptance:

1. A final matching source event satisfies exactly its intended occurrence once; replay and concurrent delivery do not duplicate receipts or satisfaction.
2. Wrong period/site/subject, draft or invalid source cannot satisfy a task.
3. Source correction/void retains invalidation and needs-attention history; it neither erases proof nor leaves false completion.

Do not assume that a log’s existence means it is final, or that its completion means a related repair or administrative review is done. Inspect the actual source lifecycle and settle the engineering contract before writing adapters. Domain-specific connections remain the later COL-154 through COL-159 segments; COL-147 supplies the shared mechanism. Do not invent source finality, provider behavior, policy, owner assignments or dates.

## Read first

- Repository `AGENTS.md`, `CODEX.md`, and relevant Next.js bundled docs for any client work.
- `/Users/brianlewis/Circle of Life/Haven Admin Roadmap 2026-09-09/BUILD-SCOPE.md`, `DELIVERY-ROADMAP.md`, and `LINEAR-INDEX.md`, plus live COL-147 acceptance.
- `docs/facility-operations/COL-18-BASELINE.md`, `INTEGRATION-MANIFEST.md`, and the COL-139, COL-142, COL-143, COL-145 and COL-146 contracts/handoffs.
- `supabase/migrations/220_col_v2_operational_logs.sql` (issue pointers at lines 4 and 65), catalog provenance R03/R05/R06, current occurrence identity, immutable receipt/correction rules, and current-authority helpers.
- COL-148’s `src/lib/operations/read-all.ts` and workspace/detail readers if projecting new state. No `.limit` does not mean unlimited: provider row caps previously hid work. Preserve microseconds in history keys, exact total counts, explicit partial failures and before/after consistency when composing current occurrence plus receipt history.

## Delivery discipline

One bounded issue. Settle a concrete COL-147 contract; use independent implementation lanes only where file ownership is disjoint. Get fresh adversarial SQL/runtime reviews and reverify fixes. Preserve current authority after lock waits and on replay. Test wrong scope, nonfinal source, duplicate and concurrent delivery, source version changes and void/correction invalidation, and separation of domain proof from administrator review. Follow the existing native SQL probe and observed-lock race patterns.

Recheck current main and every concurrent migration number immediately before assigning DDL. The HFO stack currently ends at provisional migration 345; overlapping finance/source branches must be reconciled at integration. Do not guess that 346 is available. No new dependency without owner instruction.

The earlier native scratch cluster is PostgreSQL 17, socket `/Users/brianlewis/.hermes/tmp/agent-runs/hfo-col139-20260910-105544`, port `55443`; verify it still exists and matches its manifest. It is retained infrastructure from the earlier run, not a new run-owned cleanup target. Scratch baselines include `col143_base343`, `col145_base344`, and `col146_base345`. Use the native replay variables from CHECKPOINT.md; do not target hosted data for local probes.

Run focused tests, `npm run typecheck`, `npm run lint`, native replay/races appropriate to new SQL, and strict `npm run segment:gates -- --segment COL-147-HFO-SOURCE-ADAPTERS` (add `--ui` only for actual UI changes). Record exact evidence and independent review, commit only owned files using Lore intent/trailers, push, create a draft PR against the immediately preceding completed branch, and add the bounded Linear closing note. Done means reviewed and gated source only. Never imply hosted, provider, staff, clinical, operating-cycle, cutover or launch acceptance.

## Boundaries

Nothing in the handoff authorizes merging, applying hosted migrations, deploying, activating rules/schedules, adding reminders, or transmitting to external providers. COL-143’s hosted acceptance stays untouched. The owner’s dependency exception was recorded for COL-145, COL-146 and COL-148; do not silently extend it to unrelated hosted acceptance. Ask only for a genuinely missing decision that prevents a concrete, safe implementation.
