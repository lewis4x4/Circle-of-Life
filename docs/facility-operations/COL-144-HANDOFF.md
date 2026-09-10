# COL-144 — track problems, next actions, backup ownership and resolution

**Implemented, independently reviewed and verified locally on the feature branch; see the evidence for the gate artifact.** No hosted migration, deployment, real assignment, notification or operating acceptance has occurred. Nothing is merged to `main`.

Worktree: `/Users/brianlewis/Circle of Life/Haven Facility Occurrences`; branch `codex/hfo-col144-issues`, stacked on COL-142 (`0c61def2` over `006a12ff`) over COL-139 and COL-137. COL-132, COL-133, COL-135, COL-137, COL-139 and COL-142 are Done in Linear as reviewed, gated, unmerged source; COL-144 integrates after COL-142 in the recorded Finance-first order. COL-143 (HFO-07) is dependency-ready but deferred because its acceptance needs positive hosted Storage HTTP proof.

## Delivered

- Migration `342_hfo_issue_lifecycle.sql` (provisional): lifecycle columns on `operation_issues` (status `open`/`assigned`/`waiting`/`resolved`, owner and backup user/role, acceptance, waiting reason and follow-up, resolution with optional receipt, reopen count, `issue_revision`), immutable `operation_issue_events`, the `operation_issue_backlog` projection with owner/backup currentness and overdue follow-up, the issue-authority lock, and the commands `assign`, `accept`, `wait`, `resume`, `resolve`, `reopen`, `link` (each `*_operation_issue_review`), all under the owner-secret token, current authority, an expected revision and an idempotent request key; the 341 issue guard and the 341 cancel body replaced in place (an unresolved linked issue blocks cancellation); currentness helpers answer only for the caller's own organisation and granted sites.
- Library `src/lib/operations/issues.ts` and routes for the issue detail with events, the site backlog and the seven commands; `status` filtering on the list.
- Canonical contract: [issues](../specs/27-facility-operations-issues.md). Settled engineering contracts: `col144-evidence/engineering-contracts.md`.

## Acceptance

1. Recording a failed check creates or links a visible issue without reversing the fact of inspection or marking repair complete: COL-142 creation kept; `link` connects a failed receipt to an earlier open issue; resolving changes nothing on receipts or occurrences (probed by row hashes).
2. Unassigned, waiting and reassigned work remains visible; an absent or departed owner can be covered with history: backlog projection with `owner_current`, `backup_current`, `follow_up_overdue`; `covered` events; reassignment details keep the previous owner.
3. Resolve and reopen require current authority and version; problem status is independent of performance; audit survives retries: expected revision on every command, replay returns the recorded event, changed content conflicts, events immutable, task audit rows.

## Boundaries kept

No notification, reminder, urgency policy or escalation route (Q29 open; HFO-15). No coverage inferred from role names or duty splits (Q02 open). Corrections to receipts are HFO-08; verified evidence COL-143; the staff workspace HFO-10 consumes the backlog projection. Five engineering policies are listed for confirmation in `OWNER-DECISIONS.md` (3e).

## Evidence

Focused suite, typecheck, lint, native replay of 345 migration files with 26 probes including `review_hfo_issue_lifecycle.sql` (128 assertions), the three-case race script, independent SQL and TypeScript reviews with dispositions and the SQL re-verification, strict gate artifact: see [verification](col144-evidence/verification.json) and [review](col144-evidence/independent-review.json). Local PostgreSQL uses Supabase stubs and synthetic fixtures; hosted Auth, browser and staff acceptance are not established.

## Resume and rollback

Next dependency-ready issues after this closes: check live Linear (COL-143 remains deferred for hosted proof; COL-145 and COL-146 wait on COL-143; COL-148 waits on COL-143–146). Before deployment, rollback is reverting this segment. After application, drop the events table, the backlog view, the seven commands and the issue-authority lock, restore the 341 guard and status check; the lifecycle columns are additive. Mission alignment: **PASS**; hosted and operating readiness: **RISK**.
