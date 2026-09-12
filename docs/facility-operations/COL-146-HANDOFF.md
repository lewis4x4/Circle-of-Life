# COL-146 — recover interrupted saves safely on shared devices

**Implemented, independently reviewed and verified locally on the feature branch as source only.** No hosted migration, deployment or staff acceptance has occurred. Nothing is merged to `main`.

Worktree: `/Users/brianlewis/Circle of Life/Haven Facility Recovery`; branch `codex/hfo-col146-recovery`, stacked on COL-145 (`codex/hfo-col145-corrections`). Built under the owner's **limited dependency exception** recorded on the Linear issue: COL-143 stays In Progress with its hosted Storage proof open, and this segment builds against its reviewed interface without marking that acceptance complete.

## Delivered

- Migration `345_hfo_command_drafts.sql` (provisional): `operation_command_drafts` with actor-scoped RLS under current site authority, guard (token, immutable identity, forward-only states, no delete), audit trigger and restrictive audit read, commands `save`, `reconcile`, `resume`, `discard` (`*_operation_command_draft_review`), resume dispatch to the record, verify, correct, reverse and issue commands with exceptions propagated unchanged, 24-hour expiry.
- Library `src/lib/operations/recovery.ts`, client machine `recovery-client.ts`, hook `src/hooks/use-pending-save.ts`, notice `save-state-notice.tsx`, routes under `api/admin/operations/drafts/`.
- Canonical contract: [recovery](../specs/27-facility-operations-recovery.md). Settled engineering contracts: `col146-evidence/engineering-contracts.md`.

## Acceptance

1. Lost response, reload or process restart reconciles one receipt rather than submitting a changed payload or losing work silently: probe (reconcile before and after the command; resume executes once; resume after commit replays with `replayed: true` and no second receipt; a key reused on another occurrence never reconciles the draft) and the race script (two concurrent resumes → one receipt); client tests (truncated or empty 2xx and non-JSON refusals reconcile instead of discarding; resume sends no body; never `saved` without a record).
2. User switch or logout cannot expose the prior person's draft or attachments; an expired or revoked actor cannot replay a protected response: probe (other actor, other organisation, revoked and expired grant, signed-out session: nothing visible, every command denied; same person from a new session resumes) and hook tests (state dropped on actor change and sign-out, in-flight answers ignored; no browser storage).
3. Offline, unsaved and uploading states are clear and accessible; no false saved success; a safe fallback exists for a genuine outage: notice tests (distinct wording per state, live region, keyboard actions, current person, axe) and the `offline` state that persists nothing and claims nothing; the paper downtime process stays the outage fallback (Q25 open).

## Boundaries kept

No offline submission, encrypted offline draft, emergency packet or notification. No file bytes are drafted; an interrupted upload is visible through the uploader's own in-flight evidence rows. No workspace wiring (COL-148). Four engineering policies listed for confirmation in `OWNER-DECISIONS.md` (3h).

## Evidence

Focused suite, typecheck, lint, native replay of 348 migration files with 29 probes including `review_hfo_command_drafts.sql` (173 assertions), the race script with lock waits observed from `pg_locks`, independent SQL and TypeScript reviews with dispositions and re-verification, strict gate artifact: see [verification](col146-evidence/verification.json) and [review](col146-evidence/independent-review.json).

## Resume and rollback

Next in the stack: COL-148 (`codex/hfo-col148-workspace`, no migration). Before deployment, rollback is reverting this segment. After application, drop the table, the four commands, their wrappers and helpers, and the restrictive audit policy. Mission alignment: **PASS** for the bounded foundation; hosted and operating readiness: **RISK**.
