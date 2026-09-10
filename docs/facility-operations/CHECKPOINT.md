# Facility Operations checkpoint

Updated 2026-09-10 (evening, session ended by the owner mid-COL-148). Durable resume state for the HFO track, written for any engineer or model picking this up cold. No secrets. Local source state only; nothing merged, applied, deployed, scheduled or transmitted.

## Where the stack is

Branches, each stacked on the previous, all pushed, all draft PRs, nothing merged:

| Issue | Branch | Tip | PR (base) | Linear | Worktree |
|---|---|---|---|---|---|
| COL-132…139, 142, 144 | earlier branches | see prior checkpoint history below | #465–#471 | Done | various `Haven Facility *` |
| COL-143 verified evidence + checksum amendment | `codex/hfo-col143-evidence` | `45ea4ea9` | #472 (COL-144) | **In Progress** (hosted Storage proof open) | `Haven Facility Evidence` |
| COL-145 corrections | `codex/hfo-col145-corrections` | `c7dc9efc` (feature `a3c6eb26` + docs) | #473 (COL-143) | Done (reviewed, gated, unmerged source) | `Haven Facility Occurrences` |
| COL-146 recovery | `codex/hfo-col146-recovery` | `d9f5ffb2` | #474 (COL-145) | Done (reviewed, gated, unmerged source) | `Haven Facility Recovery` |
| COL-148 workspace | `codex/hfo-col148-workspace` | this commit (WIP) | none yet | In Progress | `Haven Facility Workspace` |

Provisional migrations 336–345; hosted ledger numbered through 335 (project manfqmasfqppukpobpld, read 2026-09-10). Finance-first renumbering at integration per `STAGING-INTEGRATION-PACKAGE.md`.

**Dependency exception (owner, 2026-09-10):** COL-145, COL-146 and COL-148 were built source-only against the reviewed COL-143 interface while COL-143's hosted Storage HTTP proof stays open. COL-143 stays In Progress; its hosted acceptance is not marked complete. Recorded on each Linear issue and in each `col14x-evidence/engineering-contracts.md`.

## COL-148 — exactly where it stopped

Contract: `col148-evidence/engineering-contracts.md` (binding). Survey: `col148-evidence/ui-survey.md`.

Done on this branch, green (vitest, typecheck, lint, `check:admin-shell`) but **NOT independently reviewed and NOT gated**, committed as labelled WIP:
- Server read: `src/lib/operations/workspace.ts` (+test, 20), `src/app/api/admin/operations/workspace/route.ts` (+test, 6). Reply shape per contract §2 with `next_cursor`/`total` inside `groups.history`, plus `occurrence.effective_receipt_id` and a `"total"` partial value. Lane-declared deviations to judge in review: history keyset on `(due_at desc nulls last, id desc)` not the coalesced deadline (PostgREST cannot order on an expression; no migration allowed); legacy window bypasses `parseOperationTaskFilters` (that helper shifts date-only values a day on a non-UTC host; the tasks route carries the same latent bug, untouched); Upcoming excludes finished rows; no row cap on Today/Upcoming; reversed occurrences found by a pre-read of reversal receipts inlined into an `id.in.(...)` filter.
- Navigation: "Site work" item (key `site-work`, href `/admin/operations/work`, Command group) in `src/components/layout/AdminShell.tsx` (+`AdminShell.nav.test.tsx`), `site-work` in the `admin_assistant` allowlist in `src/lib/auth/dashboard-routing.ts` (+test), one link button on `src/app/(admin)/admin/operations/page.tsx`. Not done: a tab in `src/components/operations/OperationsViewNav` (optional one-liner).
- An independent review of the server read and navigation was launched and may have produced findings that were never consumed; re-run a fresh adversarial review (prompt: contract §1–§2, survey, hunt for protected-subject leakage in `subject_label`/receipt/legacy fields, authority order, timezone partition, cursor tamper-safety with `id.in.(...)` interpolation, local-over-central rules, partial reporting, and judge the five deviations).

Not started: the page and components at `src/app/(admin)/admin/operations/work/` per contract §3 (one-action Complete on a routine managed task, inline inputs/evidence only when rules apply with MD5 via `md5OfBlob`, Report an issue, inline receipt from the server reply, current person, COL-146 `usePendingSave` + `SaveStateNotice`, URL-held view/filters, in-place row updates with focus retention, keyboard/touch/mobile, semantic list not a virtualised table, primitives imported directly), its tests (contract §4 list, in-test axe), the authenticated axe run (`scripts/a11y-authenticated.mjs` with `AXE_AUTH_ROUTES=/admin/operations/work`; record it or its absence), the strict gate `npm run segment:gates -- --segment COL-148-HFO-WORKSPACE --ui`, evidence records (`verification.json`, `independent-review.json`, `implementation-manifest.json`, `linear-state.json`, `concurrency` not applicable), `COL-148-HANDOFF.md`, `docs/specs/27-facility-operations-workspace.md` + README paragraph, OWNER-DECISIONS 3i, HANDOFF.md pointer, commit, push, draft PR against `codex/hfo-col146-recovery`, Linear closing comment (Done = reviewed, gated, unmerged source).

## Other open items

- **COL-143 hosted proof:** executable runbook `STAGING-INTEGRATION-PACKAGE.md` (not executed; Appendix A lists undetermined Storage facts). Step 0 confirms `storage` is not an exposed API schema; the eTag-format confirmation decides whether the MD5-vs-eTag mechanism holds or the app-tier fallback is needed. COL-143 closes only after `col143-evidence/hosted-proof/RESULT.md` exists.
- **COL-140:** unapproved; `HOMEWOOD-DECISION-SHEET.md` groups the open questions by who can answer (Q01, Q02, Q04–Q10, Q14, Q30) and does not block shared development.
- **Owner rulings:** OWNER-DECISIONS 1, 2, 3a–3h (3g corrections, 3h recovery added today); integrator items 4–6.
- Next dependency-ready after COL-148: COL-147 (HFO-09 source adapters; blockers 139/142/145 Done), COL-149 (HFO-11 corporate history; blockers 133/144/145 Done, 143 In Progress → exception needed), then COL-150/151.

## Resume commands

```
cd "/Users/brianlewis/Circle of Life/Haven Facility Workspace"     # COL-148 branch, stacked on COL-146
npx vitest run src/app/api/admin/operations src/lib/operations src/components/layout src/lib/auth src/hooks "src/app/(admin)/admin/operations"
npm run typecheck && npm run lint && npm run check:admin-shell
export PG_VERIFY_NATIVE_SOCKET=/Users/brianlewis/.hermes/tmp/agent-runs/hfo-col139-20260910-105544 PG_VERIFY_NATIVE_BIN=/opt/homebrew/opt/postgresql@17/bin PG_VERIFY_NATIVE_PORT=55443
npm run migrations:verify:pg                                        # 348 files, 29 probes expected
npm run segment:gates -- --segment COL-148-HFO-WORKSPACE --ui
# cluster: native PostgreSQL 17 on port 55443 (no Docker); baselines col143_base343 (amended), col145_base344, col146_base345; if the cluster is gone see the earlier checkpoint text below for initdb/pg_ctl
```

Linear updates go through GraphQL with `LINEAR_API_KEY` (node fetch reading a body; the shell hook blocks heredoc curl). Team COL state ids: In Progress `04843145-120c-4879-85ea-2d2370ca45a4`, In Review `f2309805-cd22-4e1b-8c0f-2c8123ae4e96`, Done `83cab057-2557-4e0b-8267-366ad7066b9e`. Issue ids: COL-143 `9dfed100-0ef5-424d-bc0d-cbf6150a6609`, COL-145 `8a85c768-7d51-450f-9f69-9adff2fcd96b`, COL-146 `fb1404be-dc81-4272-ab81-3187f37d852c`, COL-148 `c9a4fbf8-76d3-49b9-9850-f7d8b19cccb4`, COL-147 `17ccab14-f6d0-4b90-a525-d29e99e644ca`, COL-149 `84d81aba-b4c3-4434-8964-a0a949a70da2`.

## Build pattern that worked today

Settle the contract doc → parallel lanes with disjoint file ownership (SQL: migration + probe + race script; runtime: lib + routes + tests) → two fresh adversarial reviewers (SQL with rolled-back experiments on the scratch cluster; TypeScript) → remediate via the lanes → reviewer re-verification → fast-forward onto the branch below before the final gate (rebases surfaced real fixture gaps twice today) → strict gate → evidence records → commit owned files + gate artifact → push → draft PR against the previous branch → Linear (Done when every acceptance item is source-verifiable) → next branch. Contiguous migration numbering (`migrations:check`) forces the next segment's SQL to wait for the previous migration file; runtime lanes can start early against the contract.

## Earlier checkpoint history (for the cluster recipe and prior segments)

- Scratch cluster recipe: `initdb -D <dir>/pgdata -U postgres -E UTF8 --locale=C; pg_ctl -D <dir>/pgdata -o "-c listen_addresses='' -c unix_socket_directories='<dir>' -c port=55443" start`; `manifest.json` needs `created_by` "codex" and `run_id` = directory name; race scripts build their own fixtures when the baseline is absent. `timeout` does not exist on the Mac; zsh does not word-split `$VAR`.
- COL-139 `120b7f03` (PR #469), COL-142 `006a12ff` (PR #470), COL-144 `f97fb50f` (PR #471), COL-143 source `c7b5cc30` (PR #472); COL-137 `caca9592` (PR #468), COL-135 `520ccbde` (PR #467), COL-133 `476f02d1` (PR #466), COL-132 `92dea9b9` (PR #465). Closure records under each `col1xx-evidence/review-closure.json` or `verification.json`.
