# Facility Operations overnight checkpoint

Updated 2026-09-10 (early). Durable resume state for the HFO track. No secrets. Local source state only; nothing merged, applied, deployed, scheduled or transmitted.

## Current issue

- **COL-135 / HFO-02** — versioned facility applicability, evidence rules and local procedures. State: In Review in Linear (local source complete; not dependency closure).
- Worktree `/Users/brianlewis/Circle of Life/Haven Facility Applicability`, branch `codex/hfo-col135-applicability`, base `476f02d1` (COL-133 tip). HEAD `62d19cf4` pushed; draft PR #467 (base codex/hfo-col133-authority). Linear: In Review.
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

Done overnight: COL-135 committed/pushed (62d19cf4), draft PRs #466 (COL-133) and #467 (COL-135), full-stack integration rehearsal recorded in `col135-evidence/stack-integration-rehearsal.json` (scratch branch `scratch/hfo-stack-integration` 3b45e4f1, local only), owner/integrator decisions in `OWNER-DECISIONS.md`. No implementation issue is dependency-closed (COL-137 needs COL-135; COL-139/142/143/144 need COL-133). Single best next step: close the COL-133 and COL-135 reviews (Done as reviewed, unmerged source, as COL-132 was) or integrate the stack per the rehearsal; then COL-137 becomes ready.
