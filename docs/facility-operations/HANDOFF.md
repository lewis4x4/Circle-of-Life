# Current handoff

Read [COL-135-HANDOFF.md](COL-135-HANDOFF.md). Versioned applicability is implemented on `codex/hfo-col135-applicability`, stacked on COL-133. COL-132, COL-133 and COL-135 are Done in Linear as reviewed, gated, unmerged source (closure records: `col133-evidence/review-closure.json`, `col135-evidence/review-closure.json`); nothing is merged, applied or deployed, and [CHECKPOINT.md](CHECKPOINT.md) holds the resume state. Next dependency-ready issue: COL-137 (evaluator). [COL-133 history](COL-133-HANDOFF.md) and [COL-132 history](COL-132-HANDOFF.md) are retained.

# Earlier COL-18 handoff

Complete this COL-18 baseline closeout before selecting the next issue. **COL-132 / HFO-01 is next**, with COL-133 / HFO-05 also dependent only on COL-18. Recheck live Linear blockers and source/main before claiming either is ready at a later time. Neither implementation began in this segment.

Use `/Users/brianlewis/Circle of Life/Haven Facility Operations`, branch `codex/hfo-col18-baseline`, based on `fad17dcc`. Retained evidence and integration manifest are in this directory. Documentation-only changes from COL-18 do not change the deployed application. Preserve other worktrees; do not reset, stash, bulk-stage, merge or renumber their work.

For COL-132 read:

1. `BUILD-SCOPE.md`, `DELIVERY-ROADMAP.md`, `LINEAR-INDEX.md` in the September 9 Admin Roadmap package; live COL-132 acceptance.
2. `COL-18-BASELINE.md`, `INTEGRATION-MANIFEST.md`, source/hosted/concurrent-migration manifests.
3. Only current-issue supporting material: `ADMIN-LOG-COVERAGE.md`, `SOURCE-INVENTORY.json`, HFO-01/R01 in the backlog, and Q01/Q11 in `TOMORROW-QUESTIONS.md`. Reuse migrations 195/196/199/201; inspect current identities before final schema decisions.

Deliver stable activity/source provenance and exactly one disposition mapping for each of 91 AL IDs, potentially linking multiple supported activities; preserve split/composite/data-field kinds. Version changes retain activity identity. Subjects validate against existing facility/resident/staff/asset records. Never import historical Y/N cells as performed work; never invent a missing-header duty. Do not activate unknown rules or schedules. Provide the canonical repository spec entry for this new capability.

**Migration warning:** main ends at 335, but parallel branches already use 335–342 with incompatible files. Fetch and reconcile/reserve the next number immediately before writing DDL. Branch existence or a larger number does not establish deployed truth.

Keep release gates separate: full baseline segment gate FAIL (current npm advisories; shared all-ref scan), latest nightly FAIL; Security Advisor 1 error/45 warnings/6 info; positive Storage transport, HFO complete-loop proof, current PHI controls and named Homewood/device/staff/first-month evidence remain open. None requires guessing Q01/Q11 or prevents bounded foundation design/implementation. No deployment is authorized by a baseline-complete badge alone.

After the next issue: focused behavior tests, applicable segment gates, independent security/data review, exact source/migration/rollback evidence, live Linear update and one next dependency-ready handoff. Mission alignment for COL-18: PASS; overall operating readiness: RISK / NOT READY.
