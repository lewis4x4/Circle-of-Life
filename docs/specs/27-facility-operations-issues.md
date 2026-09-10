# Facility operations issue lifecycle — COL-144

Status: PARTIAL — HFO-14 foundation. September 10, 2026. Extends the [receipts](27-facility-operations-receipts.md) contract (COL-142 owns the issue identity) under BUILD-SCOPE section 5 (principle 8: report a problem without pretending the task was performed; assign a next action and keep it visible through handover; OPS-002 minimal corrective-work loop). This is source implementation: it assigns no real issue, sends no notification and establishes no hosted or operating acceptance.

## Problem status is independent of performance

An issue (`operation_issues`) keeps the COL-142 identity: kind, summary, severity, subject scope, optional occurrence and receipt links, reporter and report time, all immutable. COL-144 adds the lifecycle as a projection on the row (`status` `open`, `assigned`, `waiting`, `resolved`; owner and backup as a named user and/or a role; acceptance; waiting reason and follow-up instant; resolution summary, resolver, time and an optional resolution receipt; reopen count; `issue_revision`) and an immutable history in `operation_issue_events` (`assigned`, `reassigned`, `accepted`, `covered`, `waiting`, `resumed`, `resolved`, `reopened`, `linked`), each with the actor, the revision the actor saw, a request key and fingerprint, and details. No lifecycle command writes to a receipt or an occurrence: a completed inspection stays a completed inspection, a failed check stays a failed check with its issue, and resolving an issue never marks work performed. The only touch on the task side is an audit row on the linked occurrence. In the other direction, an occurrence that still carries an unresolved linked issue cannot be cancelled or removed, so open work never leaves the backlog through a cancellation. Owners and backups must hold an operations role; a backup role must differ from the owner role when no person is named.

## Commands

Every command locks the issue, its linked occurrence and native subject, the site, the actor's grants and session, checks site and subject authority before any issue fact is disclosed, looks up the request key (a replay returns the recorded event, changed content conflicts), requires the expected `issue_revision` (a stale one conflicts), applies its transition rule, writes the row, the event and the task audit, and re-locks. Actor classes are derived after the lock: **manager** (the COL-133 broad operations list), **owner** and **backup** (by named user or held role), **reporter**.

- **assign** (manager): open → assigned; on an assigned or waiting issue it records a reassignment with the previous owner and backup and whether the previous owner was still current. Owner and backup users must be active organisation members with a current site grant when named; roles must be application roles.
- **accept** (owner) / **covered** (backup when the owner is no longer current, or with an explicit cover reason): the acceptance is recorded with history, so an absent or departed owner's work is covered without rewriting who was assigned.
- **wait** (manager, owner or backup): needs a reason and a future follow-up instant. **resume** returns to assigned when an owner is named, else open.
- **resolve** (manager, owner or backup): needs a resolution summary; may cite a performance receipt on the same activity and subject as resolution evidence (validated and readable, never modified).
- **reopen** (manager or reporter): resolved → assigned or open; the count increments; the row's resolution columns clear but the resolution stays verbatim in the events.
- **link** (manager, owner, backup or reporter): sets the COL-142 `receipt_id` once on an open issue from a performance receipt on the same activity and subject, so a failed check can be connected to an earlier open issue without reversing the inspection or completing anything.

## Visible through handover

`operation_issue_backlog` (security invoker) lists every unresolved issue at a site with `owner_current` and `backup_current` (user active, not deleted, site grant current at read time), `follow_up_overdue`, the linked occurrence's execution state and the last event. Unassigned, waiting and reassigned work is one authorized read; an owner who lost their site grant shows as not current so cover can be arranged. Q02 (who does, checks and covers each item) and Q29 (urgency, notification route, escalation) stay open: nothing infers coverage from a role name and nothing notifies.

## API

`GET /api/admin/operations/issues/[id]` (issue and events), `GET /api/admin/operations/issues/backlog?facility_id`, `POST /api/admin/operations/issues/[id]/assign|accept|wait|resume|resolve|reopen|link`, and `status` filtering on the existing list. Replies carry the server-authoritative outcome class (`event`, `validation`, `denied`, `missing`, `conflict`, `uncertain`).

## Verification

1. `npm test -- src/app/api/admin/operations src/app/api/admin/meetings src/lib/operations src/lib/admin/operations src/lib/auth/current-api-actor.test.ts`
2. `npm run typecheck`; `npm run lint`; `npm run segment:gates -- --segment COL-144-HFO-ISSUES --ui`
3. Native replay executes `supabase/tests/review_hfo_issue_lifecycle.sql` and `scripts/facility-operations/test-issue-concurrency.py` observes two managers assigning with the same expected revision, two identical replays and two resolutions with the same expected revision (the loser refused by the moved revision) on the run-owned PostgreSQL 17 cluster.

## Migration and rollback

`342_hfo_issue_lifecycle.sql` (provisional number) follows this branch's unapplied 336–341, widens the 341 issue status check and replaces in place the 341 issue guard and the 341 body of `cancel_operation_occurrence` (one guard: an unresolved linked issue blocks cancellation). Numbers are branch-local; integrate after COL-142 in the recorded Finance-first order and re-read the hosted ledger before assigning final numbers. Before application, rollback is reverting this segment. After application, drop the events table, the backlog view, the currentness helpers, the seven commands and the issue-authority lock, restore the 341 guard and cancel bodies and the status check (only `open` rows can exist again once resolved rows are absent); the lifecycle columns are additive.

Engineering policies recorded for confirmation in `docs/facility-operations/OWNER-DECISIONS.md` (3e). Mission alignment: PASS for the bounded foundation. Operating readiness: RISK pending reminders (HFO-15), the staff workspace (HFO-10), hosted release and Homewood configuration.
