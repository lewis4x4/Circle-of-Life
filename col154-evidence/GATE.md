# COL-154 / HFO-18 GATE

MODEL_USED: Fable 5.1 / claude-fable-5-1
DATE: 2026-09-10 (America/New_York)
ISSUE: COL-154 (`1d27f038-74ed-42f3-92a6-72d69dfcd657`) — HFO-18 connect drill and generator records to the checklist first
BRANCH: `codex/hfo-col154-drill-generators`
BASE: `codex/hfo-col147-source-adapters` @ `a625b75a`
SOURCE_COMMIT (gated): `7cff7100`
CHECKPOINTS: `c80d1bdb` (contract + 347), `71741ffe` (probe), `840b6272` (routes/schemas/race), `c5bab9b9` (docs)
DRAFT_PR: https://github.com/lewis4x4/Circle-of-Life/pull/477 (base `codex/hfo-col147-source-adapters`; do not merge)

## GATE candidate: pass (source-only segment)

Strict segment gate **PASS** for `COL-154-HFO-DRILL-GENERATORS`, re-run after the independent-review fixes:
- artifact: `test-results/agent-gates/2026-09-11T02-11-47-121Z-COL-154-HFO-DRILL-GENERATORS.json`
- verdict: `PASS`; summary: passed=10 failed=0 skipped=3 (optional web-build, design-review, a11y-axe) blocking_failures=[]
- native replay inside the gate: 350 migration files, 31 SQL probes (includes `review_hfo_drill_generator_sources.sql` and the adjusted `review_hfo_source_links.sql`)
- earlier run before the fixes also PASS: `2026-09-11T01-52-44-137Z-…json` (retained as history)

Other checks: full vitest 582 files / 3983 tests PASS; 43 files / 533 tests PASS after the fixes; typecheck PASS; lint PASS; race script 6/6 PASS with observed lock waits.

Independent adversarial SQL/runtime review: **APPROVE WITH FIXES → APPROVED AFTER FIXES**. F1 (blocking: fire drill corrected to tornado stranded its receipt) fixed; F2 (void after asset retired left a false completion) fixed as a named refusal under the COL-133 retired-subject boundary; F4, F5, F10 fixed; F3, F7, F8 documented as OWNER-DECISIONS 3k(ix)–(xii); F9, F11 accepted. Every fix re-verified by probe, race script, vitest and the final gate.

### Evidence paths
- `docs/facility-operations/col154-evidence/engineering-contracts.md`
- `docs/facility-operations/col154-evidence/verification.json`
- `docs/facility-operations/col154-evidence/independent-review.json` / `.md`
- `docs/facility-operations/col154-evidence/concurrency.txt`
- `docs/facility-operations/col154-evidence/linear-state.json`
- `docs/facility-operations/COL-154-HANDOFF.md`
- `docs/specs/27-facility-operations-drill-generator-sources.md`; `docs/specs/README.md`; `docs/facility-operations/OWNER-DECISIONS.md` (3k)
- `supabase/migrations/347_hfo_drill_generator_sources.sql`
- `supabase/tests/review_hfo_drill_generator_sources.sql`
- `scripts/facility-operations/test-drill-generator-concurrency.py`
- `src/lib/operations/source-records.ts` (+ test); `src/lib/operations/receipts.ts`
- `src/app/api/admin/operations/asset-observations/`, `src/app/api/admin/operations/drill-logs/[id]/`
- `col154-evidence/gate-run-1.log`, `gate-run-2.log`, `vitest-full.log`, `npm-ci.log`, `worktree-preflight.json`

### Linear note summary (for Lewi; not written by the implementer)
Registered the first two domain adapters on the COL-147 mechanism: `drill_log` gains an explicit finality lifecycle (every existing and legacy-written row is a draft until finalized), new `asset_observations` records staff-observed generator/CO/extinguisher checks against a named asset and refuses self-tests and photos by name; finalize/correct/void commands deliver through 346 in the same transaction; review activities are never allowlisted; no Homewood rule, day, time, count or deadline (Q06/Q09/Q14 open). Migration 347 provisional on this stack. Source-only; no merge/deploy/hosted apply.

### Blockers
- None blocking the source checkpoint or the draft PR.
- Untracked in this worktree at GATE write: `col154-evidence/fable-run.log`, `col154-evidence/AUTHORITATIVE_SESSION.txt` (orchestrator files, left alone).
- COL-143 hosted Storage acceptance remains open (untouched). Not staff/provider/clinical/operating-cycle/cutover/launch acceptance.
- Integration: 347 must renumber with the rest of 336–346 after Finance; the 220 unique constraint on `drill_log` is an integrator decision if voided-slot re-entry is wanted (OWNER-DECISIONS 3k(x)).
