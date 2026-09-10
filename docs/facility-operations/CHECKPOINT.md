# Facility Operations overnight checkpoint

Updated 2026-09-10 (early). Durable resume state for the HFO track. No secrets. Local source state only; nothing merged, applied, deployed, scheduled or transmitted.

## Current issue

- **COL-135 / HFO-02** — versioned facility applicability, evidence rules and local procedures. State: In Progress in Linear.
- Worktree `/Users/brianlewis/Circle of Life/Haven Facility Applicability`, branch `codex/hfo-col135-applicability`, base `476f02d1` (COL-133 tip). HEAD: uncommitted implementation on top of the base until the gate passes.
- Owned files: `supabase/migrations/338_hfo_requirement_versions.sql`, `supabase/tests/review_hfo_applicability.sql`, `src/lib/operations/requirements.ts` (+test), `src/lib/operations/requirement-publication.ts`, `src/app/api/admin/operations/requirements/**`, `src/app/api/admin/operations/facility-requirements/**`, `docs/specs/27-facility-operations-applicability.md`, `docs/specs/README.md` (one paragraph), `docs/facility-operations/COL-135-HANDOFF.md`, `docs/facility-operations/HANDOFF.md` (pointer), `docs/facility-operations/col135-evidence/`, this file.
- Last completed step: implementation, independent review (no blocker; 6 SQL + 3 TS should-fix items remediated: effective-window model, service identity locked out, snapshot window/agreement, schedule confirmation not publishable, subject classification required, local evidence/inputs additive, schema refinements, 400 vs 409 mapping), focused suite 166 tests / 21 files, typecheck, lint, native replay 341 files / 22 probes, strict gate PASS (2026-09-10T02-37-46-794Z). Committing and pushing next.

## Sibling state

- COL-132 `codex/hfo-col132-catalog` at `92dea9b9` (pushed): review closed, Linear Done. Owner ruling pending: two named individuals in source header labels (AL-Y02, AL-C08).
- COL-133 `codex/hfo-col133-authority` at `476f02d1` (pushed): strict gate PASS, integration-reviewed, Linear In Review awaiting integration (Finance-first ordering, integrator decision on listing completed export jobs, fresh hosted-ledger read before numbering). Test-count note: the recorded 131 focused tests became 125 after review remediation (six meeting-action success-path tests retired because COL-133 revokes that command; recoverable from `afe24111`) and 128 after the catalog remediation added three stable-identity tests. No coverage was silently dropped; see `col133-evidence/integration-review.json`.
- Hosted ledger (project manfqmasfqppukpobpld) last read 2026-09-10: 344 records, numbered through 335. Migrations 336–338 are provisional.

## Resume commands

```
cd "/Users/brianlewis/Circle of Life/Haven Facility Applicability"
npm test -- src/app/api/admin/operations src/app/api/admin/meetings src/lib/operations src/lib/admin/operations src/lib/auth/current-api-actor.test.ts
npm run typecheck
# native replay needs a run-owned cluster under ~/.hermes/tmp/agent-runs/<run>/ with manifest.json created_by "codex"
PG_VERIFY_NATIVE_SOCKET=<run dir> PG_VERIFY_NATIVE_BIN=/opt/homebrew/opt/postgresql@17/bin PG_VERIFY_NATIVE_PORT=55443 npm run migrations:verify:pg
npm run segment:gates -- --segment COL-135-HFO-APPLICABILITY --ui
```

## Next action

Commit owned files; push; open draft PRs for COL-133 and COL-135 (stacked); Linear COL-135 In Review with evidence. COL-137 depends on COL-135 (In Review is not closure) and COL-144/143/139 need COL-133, so no implementation issue is dependency-closed; continue with integration preparation: rehearse the full Finance + COL-132 + COL-133 + COL-135 merge on the scratch branch with the audit-export reconcile, and prepare the owner decision list.
