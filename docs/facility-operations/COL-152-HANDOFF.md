# COL-152 / HFO-15 delivery handoff

Implemented, reviewed and verified as source on `codex/hfo-col152-reminders`, based on the unmerged HFO stack at `94b1f90a`. Mission alignment: **pass**. No hosted migration, external message, rule activation, merge or deployment occurred.

## Delivered

- Independent task and issue reminder episodes reuse the existing escalation ledger. Approved due/follow-up times and explicit current owners govern reminders; missing configuration remains visible.
- Acknowledge and snooze preserve work and issue status. Exact retries, source changes, resolution/reopening, current-authority backup routing and protected audit history are covered.
- Expanded work rows automatically show reminders. Snooze begins empty; issue rendering is bounded with a remaining count; shared-device identity changes discard old responses.

Runtime changes: migration `350_hfo_in_app_reminders.sql`, `src/lib/operations/reminders.ts`, the occurrence reminder API, `task-reminder.tsx`, and its existing work-row entry point. Behavioral tests and a reusable concurrency runner accompany them. No dependency was added.

## Verified

**4,049 tests passed / two existing skips**, typecheck and repository lint passed. Native replay passed **353 migrations / 34 SQL probes**. All **four observed-lock concurrency cases passed**. Independent SQL review has zero unresolved findings. Strict `--ui` segment gate: **PASS**, no waived or downgraded checks. All 37 existing worktree heads/statuses and recorded dirty file hashes remained unchanged.

Evidence: [verification.json](col152-evidence/verification.json), [strict gate](col152-evidence/strict-gate.json), [concurrency](col152-evidence/concurrency.json), and [source review](col152-evidence/independent-review.json). Full behavior and engineering choices: [engineering contracts](col152-evidence/engineering-contracts.md).

The strict browser gate covers a local public route, not the authenticated reminder panel. Component tests use mocked sessions; database probes use synthetic Supabase stubs. Hosted and staff/operating acceptance are unproven.

## Release and next action

[COL-217](https://linear.app/jarvislewis/issue/COL-217) asks for the authorized staging target and integrator; it blocks COL-143 hosted upload proof. That proof gates COL-149 corporate history, then attention counts/export and COL-161 core release testing. Q05/Q29 and approved Homewood configuration under COL-140 remain open.

Migration 350 is provisional on this source stack. Reconcile the complete stack with current main before any application; do not merge or deploy this segment as an isolated migration. Review the bounded draft PR against `codex/hfo-col153-help-handover`. The pushed source revision and PR are recorded in Linear closeout and git history.

Rollback before application: revert only this segment or close its draft PR. After a future application, retain immutable response/audit history and use a reviewed forward migration.
