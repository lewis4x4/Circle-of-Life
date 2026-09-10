# Facility Operations checkpoint

Updated 2026-09-10 (morning). Durable resume state for the HFO track. No secrets. Local source state only; nothing merged, applied, deployed, scheduled or transmitted.

## Review closures (this update)

- **COL-133 / HFO-05** closed as Done on the recorded evidence: `col133-evidence/review-closure.json` maps each acceptance criterion to the independent review, the seven observed-lock concurrency cases and the PASS gates (01-22-58 remediation, 01-58-01 final branch, 02-37-46 stacked). Head stays `476f02d1` (pushed); draft PR #466 open. Done = reviewed, gated, unmerged source, exactly as COL-132.
- **COL-135 / HFO-02** closed as Done on the recorded evidence: `col135-evidence/review-closure.json` maps each criterion to the applicability probe, the independent review and the 02-37-46 strict gate at `62d19cf4`. Later commits on the branch are documentation only. Draft PR #467 open.
- No reviewer was re-run; no duplicate reviewer report was opened. Closure is not deployment: OWNER-DECISIONS.md items 1–6 stay open; Finance-first integration and a fresh correct-project hosted-ledger read precede final migration numbers.

## Current issue

- **COL-137 / HFO-03** — one recurrence and due-date evaluator. Dependency COL-135 is Done in Linear, so COL-137 is dependency-ready. Worktree `/Users/brianlewis/Circle of Life/Haven Facility Evaluator`, branch `codex/hfo-col137-evaluator`, stacked on the COL-135 tip (this closure commit). Migration number 339 is provisional (hosted ledger numbered through 335 at last read; Finance holds 336–342 on its branch).
- Handoff for this issue: `COL-137-HANDOFF.md` and `col137-evidence/` once written.

## Sibling state

- COL-132 `codex/hfo-col132-catalog` at `92dea9b9` (pushed): Done. Owner ruling pending on AL-Y02 / AL-C08 header labels.
- COL-133 `codex/hfo-col133-authority` at `476f02d1` (pushed): Done (see above). Integration constraints unchanged: Finance's export-job column change applies before COL-133's policies; integrator decision on listing completed export jobs.
- COL-135 `codex/hfo-col135-applicability`: Done (see above). Full-stack rehearsal recorded in `col135-evidence/stack-integration-rehearsal.json` (scratch branch local only).
- Hosted ledger (project manfqmasfqppukpobpld) last read 2026-09-10 early: 344 records, numbered through 335. Migrations 336–339 are provisional.

## Resume commands

```
cd "/Users/brianlewis/Circle of Life/Haven Facility Evaluator"
npm test -- src/app/api/admin/operations src/app/api/admin/meetings src/lib/operations src/lib/admin/operations src/lib/auth/current-api-actor.test.ts
npm run typecheck
# native replay needs a run-owned cluster under ~/.hermes/tmp/agent-runs/<run>/ with manifest.json created_by "codex"
PG_VERIFY_NATIVE_SOCKET=<run dir> PG_VERIFY_NATIVE_BIN=/opt/homebrew/opt/postgresql@17/bin PG_VERIFY_NATIVE_PORT=55443 npm run migrations:verify:pg
npm run segment:gates -- --segment COL-137-HFO-EVALUATOR --ui
```

## Next action

Implement COL-137 under its Linear acceptance (unknown schedule → no due/overdue judgment and no assigned-date midnight fallback; DST, month end, leap day, two six-month meanings, holiday calendar and expiry anchors deterministic or explicitly unresolved; scheduler, next-due, history and exception views on one evaluator; fire/hood/MH ambiguities unactivated). Then focused tests, independent review, strict gate, commit and push. Integration stays separate.
