# Facility Operations checkpoint

Updated 2026-09-10 (midday). Durable resume state for the HFO track. No secrets. Local source state only; nothing merged, applied, deployed, scheduled or transmitted.

## Current issue

- **COL-137 / HFO-03** — one recurrence and due-date evaluator. Worktree `/Users/brianlewis/Circle of Life/Haven Facility Evaluator`, branch `codex/hfo-col137-evaluator`, stacked on COL-135 `520ccbde`. Linear: In Progress at start; see `col137-evidence/linear-state.json` and the closing comment for the state after commit/push.
- Owned files: `src/lib/operations/schedule-evaluator.ts` (+ test, fixtures, `due-judgment.test.ts`, `scheduler-evaluator.test.ts`), `src/lib/operations/server.ts`, `types.ts`, `miss-prediction.ts`, `requirements.ts` (+ test), `requirement-publication.ts`, `automation-authority.test.ts` (harness), `src/app/api/admin/operations/tasks/route.ts`, `facility-requirements/route.ts` (+ test), operator pages (`operations/page.tsx`, `overdue`, `pager`, `kanban`), `src/components/operations/OperationsCalendarPage.tsx`, `OperationsTaskRangePage.tsx`, `supabase/functions/oce-task-scheduler/index.ts`, `risk-nightly-scorer/index.ts` (one filter), `supabase/migrations/339_hfo_schedule_evaluator.sql`, `supabase/tests/review_hfo_schedule_evaluator.sql`, `review_hfo_applicability.sql` (schedule section), `docs/specs/27-facility-operations-evaluator.md`, `docs/specs/README.md` (one paragraph), `docs/facility-operations/COL-137-HANDOFF.md`, `HANDOFF.md` (pointer), `OWNER-DECISIONS.md` (3a, 3b, 5), `col137-evidence/`, this file.
- Last completed step: implementation; two independent reviews (SQL blocker: missing `day` accepted by SQL, fixed; four SQL and two TypeScript should-fix items fixed; actionable notes fixed); focused suite 241 tests / 24 files, typecheck, lint, Deno checks, native replay 342 files / 23 probes PASS; first strict gate PASS (2026-09-10T12-24-46-085Z, pre-remediation); post-remediation gate re-run recorded in `col137-evidence/verification.json`. Then commit, push, draft PR (base codex/hfo-col135-applicability), Linear closing comment.

## Review closures (earlier today)

- COL-133 and COL-135 closed as Done on recorded evidence (`col133-evidence/review-closure.json`, `col135-evidence/review-closure.json`, commit `520ccbde` on the COL-135 branch). No reviewer re-run. Done = reviewed, gated, unmerged source.

## Sibling state

- COL-132 `codex/hfo-col132-catalog` `92dea9b9`: Done; owner ruling pending on AL-Y02 / AL-C08 header labels.
- COL-133 `codex/hfo-col133-authority` `476f02d1`: Done; Finance-first ordering and the completed-export-list decision stay open.
- COL-135 `codex/hfo-col135-applicability` `520ccbde`: Done; draft PR #467.
- Hosted ledger (project manfqmasfqppukpobpld) read twice on 2026-09-10: 344 records, numbered through 335 (`col137-evidence/hosted-ledger.json`). Migrations 336–339 are provisional; rehearsed Finance-first placement is 343–346 with the evaluator after applicability.

## Resume commands

```
cd "/Users/brianlewis/Circle of Life/Haven Facility Evaluator"
npm test -- src/app/api/admin/operations src/app/api/admin/meetings src/lib/operations src/lib/admin/operations src/lib/auth/current-api-actor.test.ts
npm run typecheck
deno check --no-lock supabase/functions/oce-task-scheduler/index.ts supabase/functions/risk-nightly-scorer/index.ts
# native replay needs a run-owned cluster under ~/.hermes/tmp/agent-runs/<run>/ with manifest.json created_by "codex"; never Docker on this Mac
PG_VERIFY_NATIVE_SOCKET=<run dir> PG_VERIFY_NATIVE_BIN=/opt/homebrew/opt/postgresql@17/bin PG_VERIFY_NATIVE_PORT=55443 npm run migrations:verify:pg
# pass the same three variables to the gate so qa.migrations-apply-postgres replays natively
PG_VERIFY_NATIVE_SOCKET=<run dir> PG_VERIFY_NATIVE_BIN=/opt/homebrew/opt/postgresql@17/bin PG_VERIFY_NATIVE_PORT=55443 npm run segment:gates -- --segment COL-137-HFO-EVALUATOR --ui
```

## Next action

After COL-137 is committed and pushed: close its review the same way (Done = reviewed, gated, unmerged source) or leave In Review for the owner; then check live Linear for the next dependency-ready issue (COL-139 / HFO-04 occurrence generation needs COL-137 and COL-133). Integration stays separate: Finance-first, fresh correct-project hosted-ledger read before final numbering, owner decisions in `OWNER-DECISIONS.md` unanswered.
