# Facility Operations checkpoint

Updated 2026-09-10 (late afternoon). Durable resume state for the HFO track. No secrets. Local source state only; nothing merged, applied, deployed, scheduled or transmitted.

## Current issue

- **COL-143 / HFO-07** — scoped verified evidence (source-only portion). Selected after COL-144 closed: it and COL-140 are the only dependency-ready HFO issues, and both are externally blocked. COL-143's third acceptance item (real upload, finalize, completion and corporate download with positive hosted Storage HTTP proof) needs hosted transport; the schema, commands, routes and local proofs are source work and are being built, and the issue stays In Progress, not Done, until that proof exists. COL-140 needs the owner's answers to Q01, Q02, Q04–Q10, Q14 and Q30 and is not started. Branch `codex/hfo-col143-evidence` in this worktree, stacked on the COL-144 closure commit. Preparation and state: `COL-143-PREPARATION.md`, `col143-evidence/` once created.

## Just closed

- **COL-144 / HFO-14** — Done in Linear 2026-09-10T19:22Z as reviewed, gated, unmerged source; commit `f97fb50f` on `codex/hfo-col144-issues`, draft PR #471 (base COL-142). Closure `col144-evidence/review-closure.json`; handoff `COL-144-HANDOFF.md`.

## Previous issue record

- **COL-144 / HFO-14** — problems, next actions, backup ownership and resolution. Selected from live Linear after COL-142 closed (blockers COL-133, COL-142 Done). COL-143 (HFO-07) is also dependency-ready but its acceptance needs positive hosted Storage HTTP proof, outside the source-only boundary; it stays Backlog with that reason recorded in `col142-evidence/review-closure.json`. Branch `codex/hfo-col144-issues` in this worktree, stacked on `0c61def2` (COL-142 closure over `006a12ff`). Linear In Progress since 2026-09-10T17:58Z (`col144-evidence/linear-state.json`). Contracts settled in `col144-evidence/engineering-contracts.md`; preparation `COL-144-PREPARATION.md`. Both lanes delivered; independent reviews done (TypeScript: four should-fix remediated; SQL: two should-fix remediated, re-verified PASS, one re-verification note applied); focused suite 328 tests / 31 files, typecheck, lint, native replay 345 files / 26 probes (128-assertion probe), three-case race script, strict gate PASS (`test-results/agent-gates/2026-09-10T17-22-18-024Z-COL-144-HFO-ISSUES.json`). Remaining: commit/push, draft PR against `codex/hfo-col142-receipts`, Linear closing comment, closure record, next selection. Scratch cluster as below; `col142_base341` and `col144_base342` hold migrations through 341 and 342.

## Just closed

- **COL-142 / HFO-06** — Done in Linear 2026-09-10T17:52Z as reviewed, gated, unmerged source; commit `006a12ff` on `codex/hfo-col142-receipts`, draft PR #470 (base COL-139). Closure `col142-evidence/review-closure.json`; handoff `COL-142-HANDOFF.md`.
- **COL-139 / HFO-04** — Done 2026-09-10T16:18Z; commit `120b7f03` (+ closure docs `335bd6c7`), draft PR #469 (base COL-137).

## Previous issue record

- **COL-142 / HFO-06** — atomic, idempotent execution receipts. Selected from live Linear after COL-139 closed (blockers COL-133, COL-135, COL-139 all Done). Branch `codex/hfo-col142-receipts` in this same worktree, stacked on `335bd6c7` (COL-139 closure over `120b7f03`). Linear In Progress since 2026-09-10T16:24Z (`col142-evidence/linear-state.json`). Contracts settled in `col142-evidence/engineering-contracts.md`; preparation `COL-142-PREPARATION.md`. Both lanes delivered; independent reviews done (TypeScript: three should-fix remediated; SQL: three should-fix remediated, re-verification in progress); focused suite 307 tests / 29 files, typecheck, lint, native replay 344 files / 25 probes (133-assertion probe), four-case race script, strict gate PASS (`test-results/agent-gates/2026-09-10T16-37-51-790Z-COL-142-HFO-RECEIPTS.json`). Remaining: reviewer re-check, commit/push, draft PR against `codex/hfo-col139-occurrences`, Linear closing comment, closure record. Scratch cluster as below; `col139_base340` and `col142_base341` hold migrations through 340 and 341.

## Just closed

- **COL-139 / HFO-04** — Done in Linear 2026-09-10T16:18Z as reviewed, gated, unmerged source; commit `120b7f03` on `codex/hfo-col139-occurrences`, draft PR #469 (base COL-137). Closure `col139-evidence/review-closure.json`; handoff `COL-139-HANDOFF.md`.
- Owned files: `supabase/migrations/340_hfo_occurrences.sql`, `supabase/tests/review_hfo_occurrences.sql`, `scripts/facility-operations/test-occurrence-concurrency.py`, `supabase/functions/oce-task-scheduler/index.ts`, `src/lib/operations/occurrences.ts` (+ test), `scheduler-evaluator.test.ts`, `types.ts`, `server.ts`, `src/app/api/admin/operations/tasks/route.ts` (select only), `src/app/api/admin/operations/occurrences/**`, `docs/specs/27-facility-operations-occurrences.md`, `docs/specs/README.md` (one paragraph), `COL-139-HANDOFF.md`, `COL-139-PREPARATION.md` (preserved), `HANDOFF.md` (pointer), `OWNER-DECISIONS.md` (3c, 5, boundaries), `col139-evidence/`, `col137-evidence/review-closure.json` (preserved), this file.
- Last completed step: implementation in two lanes from `col139-evidence/engineering-contracts.md`; two independent reviews (SQL: two blockers, forgeable approval flag and missing on-demand facility subject, plus five should-fix, all remediated and re-verified PASS by the reviewer; TypeScript: two blockers, stored rule sent verbatim and reconciliation counts, plus three should-fix, all remediated); focused suite 278 tests / 26 files, typecheck, lint, Deno check, native replay 343 files / 24 probes (155-assertion probe), three-case race script, strict gate PASS (`test-results/agent-gates/2026-09-10T15-51-37-911Z-COL-139-HFO-OCCURRENCES.json`); committed `120b7f03`, pushed, draft PR #469 (base `codex/hfo-col137-evaluator`), Linear closing comment and Done.

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

COL-142 / HFO-06: take In Progress with a start comment, read the source pointers (`327_sys_001e_lifecycle_authorization.sql:797`, `src/app/api/admin/operations/tasks/[id]/complete/route.ts`, R03) and open questions Q10/Q12, settle the receipt contracts on top of the COL-139 identity and the COL-133 recorder rules, implement (provisional migration 341), review, gate, commit/push, draft PR against `codex/hfo-col139-occurrences`, Linear update. Integration stays separate: Finance-first, fresh correct-project hosted-ledger read before final numbering, owner decisions in `OWNER-DECISIONS.md` unanswered.
