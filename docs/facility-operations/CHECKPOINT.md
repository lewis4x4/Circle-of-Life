# Facility Operations checkpoint

Updated 2026-09-10 (late afternoon). Durable resume state for the HFO track. No secrets. Local source state only; nothing merged, applied, deployed, scheduled or transmitted.

## Current issue

- **COL-139 / HFO-04** — subject-scoped occurrence generation. Worktree `/Users/brianlewis/Circle of Life/Haven Facility Occurrences`, branch `codex/hfo-col139-occurrences`, stacked on COL-137 `caca9592`. Linear: In Progress since 2026-09-10T17:58Z (`col139-evidence/linear-state.json`); closing comment and state change recorded there after commit/push.
- Owned files: `supabase/migrations/340_hfo_occurrences.sql`, `supabase/tests/review_hfo_occurrences.sql`, `scripts/facility-operations/test-occurrence-concurrency.py`, `supabase/functions/oce-task-scheduler/index.ts`, `src/lib/operations/occurrences.ts` (+ test), `scheduler-evaluator.test.ts`, `types.ts`, `server.ts`, `src/app/api/admin/operations/tasks/route.ts` (select only), `src/app/api/admin/operations/occurrences/**`, `docs/specs/27-facility-operations-occurrences.md`, `docs/specs/README.md` (one paragraph), `COL-139-HANDOFF.md`, `COL-139-PREPARATION.md` (preserved), `HANDOFF.md` (pointer), `OWNER-DECISIONS.md` (3c, 5, boundaries), `col139-evidence/`, `col137-evidence/review-closure.json` (preserved), this file.
- Last completed step: implementation in two lanes from `col139-evidence/engineering-contracts.md`; two independent reviews (SQL: two blockers, forgeable approval flag and missing on-demand facility subject, plus five should-fix, all remediated and re-verified PASS by the reviewer; TypeScript: two blockers, stored rule sent verbatim and reconciliation counts, plus three should-fix, all remediated); focused suite 278 tests / 26 files, typecheck, lint, Deno check, native replay 343 files / 24 probes (155-assertion probe), three-case race script, strict gate PASS (`test-results/agent-gates/2026-09-10T15-51-37-911Z-COL-139-HFO-OCCURRENCES.json`). Then commit, push, draft PR (base `codex/hfo-col137-evaluator`), Linear closing comment.

## Resume commands

```
cd "/Users/brianlewis/Circle of Life/Haven Facility Occurrences"
npx vitest run src/app/api/admin/operations src/app/api/admin/meetings src/lib/operations src/lib/admin/operations src/lib/auth/current-api-actor.test.ts
npm run typecheck && npm run lint
deno check --no-lock supabase/functions/oce-task-scheduler/index.ts
# run-owned native cluster (no Docker): socket dir below, port 55443, PostgreSQL 17 at /opt/homebrew/opt/postgresql@17/bin
export PG_VERIFY_NATIVE_SOCKET=/Users/brianlewis/.hermes/tmp/agent-runs/hfo-col139-20260910-105544 PG_VERIFY_NATIVE_BIN=/opt/homebrew/opt/postgresql@17/bin PG_VERIFY_NATIVE_PORT=55443
npm run migrations:verify:pg
HFO_OCCURRENCE_BASELINE_DB=col139_base340 python3 scripts/facility-operations/test-occurrence-concurrency.py
npm run segment:gates -- --segment COL-139-HFO-OCCURRENCES --ui
# if the cluster is gone: initdb -D <dir>/pgdata -U postgres -E UTF8 --locale=C; pg_ctl -D <dir>/pgdata -o "-c listen_addresses='' -c unix_socket_directories='<dir>' -c port=55443" start; manifest.json needs created_by "codex" and run_id = directory name; the race script builds its own fixtures when the baseline database is absent
```

Linear updates go through the GraphQL API with the `LINEAR_API_KEY` environment variable (a small node fetch helper reading a JSON body file; the shell hook blocks heredoc curl posts). Team COL state ids: In Progress `04843145-120c-4879-85ea-2d2370ca45a4`, In Review `f2309805-cd22-4e1b-8c0f-2c8123ae4e96`, Done `83cab057-2557-4e0b-8267-366ad7066b9e`.

## Prior issues (Done = reviewed, gated, unmerged source)

- COL-137 `codex/hfo-col137-evaluator` `caca9592`: Done; draft PR #468 (base COL-135). Closure `col137-evidence/review-closure.json`.
- COL-135 `codex/hfo-col135-applicability` `520ccbde`: Done; draft PR #467.
- COL-133 `codex/hfo-col133-authority` `476f02d1`: Done; Finance-first ordering and the completed-export-list decision stay open.
- COL-132 `codex/hfo-col132-catalog` `92dea9b9`: Done; owner ruling pending on AL-Y02 / AL-C08 header labels.
- Hosted ledger (project manfqmasfqppukpobpld) read twice on 2026-09-10: 344 records, numbered through 335 (`col137-evidence/hosted-ledger.json`). Migrations 336–340 are provisional; rehearsed Finance-first placement is 343–347 with the evaluator after applicability and occurrences after the evaluator.

## Next action

After COL-139 is committed and pushed: close its review the same way as the earlier issues (Done = reviewed, gated, unmerged source) or leave In Review for the owner; then check live Linear for the next dependency-ready HFO issue (candidates name COL-139 as a blocker: completion receipts COL-142, evidence transport COL-143; verify live). Integration stays separate: Finance-first, fresh correct-project hosted-ledger read before final numbering, owner decisions in `OWNER-DECISIONS.md` unanswered.
