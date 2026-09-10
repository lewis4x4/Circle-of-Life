# Facility Operations checkpoint

Updated September 10, 2026 after COL-148 source completion. This stack remains unmerged and unapplied to hosted systems; nothing is deployed, scheduled or activated.

## Resume here — Fable 5.1

The owner requested completing COL-148, then stopping for a Fable 5.1 handoff before the next module. Read **[FABLE-5.1-HANDOFF.md](FABLE-5.1-HANDOFF.md)**. Next is **COL-147 / HFO-09 source adapters**, verified Backlog with COL-139, COL-142 and COL-145 Done as reviewed, gated, unmerged source. COL-147 implementation was not started here.

Worktree: `/Users/brianlewis/Circle of Life/Haven Facility Workspace`, branch `codex/hfo-col148-workspace`, base `codex/hfo-col146-recovery` (`d9f5ffb2`). Final source commit, draft PR and Linear readback are in `col148-evidence/linear-state.json`. Incoming checkpoint was `77ce6d2e`; do not resume its unreviewed-WIP instructions.

## Stack

| Issue | Source result | PR | Acceptance boundary |
|---|---|---|---|
| COL-143 | Checksum amendment `45ea4ea9` | #472 | In Progress; hosted Storage proof open |
| COL-145 | Reviewed/gated source `c7dc9efc` | #473 | Done as unmerged source |
| COL-146 | Reviewed/gated source `d9f5ffb2` | #474 | Done as unmerged source |
| COL-148 | Full workspace implemented, independently reviewed and strict UI gate PASS | See linear-state.json | Source only; authenticated browser/staff acceptance unestablished |

The owner’s limited dependency exception covers COL-145, COL-146 and COL-148 building against reviewed COL-143 interfaces. It does not mark COL-143 hosted acceptance complete. COL-140 remains unapproved; [HOMEWOOD-DECISION-SHEET.md](HOMEWOOD-DECISION-SHEET.md) holds the questions and does not block shared source development.

## COL-148 completed

Read [COL-148-HANDOFF.md](COL-148-HANDOFF.md), [verification](col148-evidence/verification.json), [independent review](col148-evidence/independent-review.json) and [source manifest](col148-evidence/implementation-manifest.json).

All four original review fixes applied. Additional review repaired provider row-cap truncation, microsecond History merging/counts, stable receipt/occurrence snapshots, correction performer/note/time preservation, hidden canceled options, pending-draft navigation/adoption, evidence replay and mutation guards, and focus. The staff page, receipt history, evidence and native download controls are complete. Shared date-picker touch mode and a nonempty-date render-loop fix are included.

Final evidence: **63 files / 619 tests PASS**, independent server/client/evidence approvals, production typecheck and lint PASS, native replay **348 migration files / 29 probes PASS**, strict `--ui` gate **PASS** at `test-results/agent-gates/2026-09-10T21-53-29-562Z-COL-148-HFO-WORKSPACE.json`. The earlier21-46 gate is retained as superseded evidence from before the last attachment guard.

Authenticated axe was invoked with `AXE_AUTH_ROUTES=/admin/operations/work` but this worktree has no `.env.local`, Supabase URL/key or test credentials. Its exit2/missing-configuration result is recorded. In-test page/calendar axe and public-route gate axe are separate coverage, not authenticated browser or staff acceptance.

## Commands and scratch runtime

```sh
cd "/Users/brianlewis/Circle of Life/Haven Facility Workspace"
npx vitest run src/app/api/admin/operations src/lib/operations src/components/layout src/lib/auth src/hooks "src/app/(admin)/admin/operations" src/components/ui/quiet-date-picker.touch.test.tsx
npm run typecheck
npm run lint
export PG_VERIFY_NATIVE_SOCKET=/Users/brianlewis/.hermes/tmp/agent-runs/hfo-col139-20260910-105544
export PG_VERIFY_NATIVE_BIN=/opt/homebrew/opt/postgresql@17/bin
export PG_VERIFY_NATIVE_PORT=55443
CI=true REQUIRE_PG_VERIFY=1 npm run segment:gates -- --segment COL-148-HFO-WORKSPACE --ui
```

Retained PostgreSQL17 socket-only scratch cluster port55443, with baselines `col143_base343`, `col145_base344`, `col146_base345`. Verify manifest and liveness before reuse. This run did not create the cluster and does not delete it. Native replay creates/drops only its isolated test database. Provisional HFO migrations336–345 require finance-first reconciliation before any hosted integration; do not assume346 is free.

All pre-existing/concurrent work outside this worktree was retained. See `col148-evidence/worktree-preflight.json` and `worktree-postflight.json`; the earlier handoff’s globally-clean claim did not match live preflight. Never reset, stash, blanket-stage or delete another worktree.

## Open work and Linear references

- COL-143 hosted proof: `STAGING-INTEGRATION-PACKAGE.md` is not executed proof; closes only with `col143-evidence/hosted-proof/RESULT.md`. Exposed-schema and Storage eTag facts still require confirmation.
- COL-147: `17ccab14-f6d0-4b90-a525-d29e99e644ca` — next module for Fable5.1.
- COL-148: `c9a4fbf8-76d3-49b9-9850-f7d8b19cccb4`.
- COL-143: `9dfed100-0ef5-424d-bc0d-cbf6150a6609`; COL-145: `8a85c768-7d51-450f-9f69-9adff2fcd96b`; COL-146: `fb1404be-dc81-4272-ab81-3187f37d852c`.
- COL-149: `84d81aba-b4c3-4434-8964-a0a949a70da2`; its COL-143 dependency is not silently waived.

Linear GraphQL uses `LINEAR_API_KEY` without logging it. COL states: In Progress `04843145-120c-4879-85ea-2d2370ca45a4`, In Review `f2309805-cd22-4e1b-8c0f-2c8123ae4e96`, Done `83cab057-2557-4e0b-8267-366ad7066b9e`. Recheck IDs/states live before mutation.

## Earlier checkpoint history (for the cluster recipe and prior segments)

- Scratch cluster recipe: `initdb -D <dir>/pgdata -U postgres -E UTF8 --locale=C; pg_ctl -D <dir>/pgdata -o "-c listen_addresses='' -c unix_socket_directories='<dir>' -c port=55443" start`; `manifest.json` needs `created_by` "codex" and `run_id` = directory name; race scripts build their own fixtures when the baseline is absent. `timeout` does not exist on the Mac; zsh does not word-split `$VAR`.
- COL-139 `120b7f03` (PR #469), COL-142 `006a12ff` (PR #470), COL-144 `f97fb50f` (PR #471), COL-143 source `c7b5cc30` (PR #472); COL-137 `caca9592` (PR #468), COL-135 `520ccbde` (PR #467), COL-133 `476f02d1` (PR #466), COL-132 `92dea9b9` (PR #465). Closure records under each `col1xx-evidence/review-closure.json` or `verification.json`.
