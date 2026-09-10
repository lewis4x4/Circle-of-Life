# Facility operations interrupted-save recovery — COL-146

Status: PARTIAL — HFO-17 foundation. September 10, 2026. Extends the [receipts](27-facility-operations-receipts.md), [evidence](27-facility-operations-evidence.md) and [corrections](27-facility-operations-corrections.md) contracts under BUILD-SCOPE section 7 ("Core online-first recovery persists request identifiers and confirmed server draft IDs, not uncontrolled sensitive payloads/files in shared browser storage. Same-person reauthentication can resume under current permissions; logout/user switch hides and locks prior drafts. Without connectivity show the pending/unsaved state; do not claim a successful offline submission."). Source implementation only; built under the owner's limited dependency exception against the reviewed COL-143 interface while COL-143's hosted Storage proof stays open. Q25 (records available during an outage) stays open; offline drafts and emergency packets are not built here.

## The truth lives in the database

Before a recording, verification, correction, reversal or issue report is issued, its exact arguments and the request key it will use are saved as a **draft** in `operation_command_drafts` under the actor's own identity (`save_operation_command_draft_review`). The browser holds no payload; at most it holds the draft id in memory. When the answer to the command is lost (network failure, timeout, reload, process restart, or a response whose body cannot be read), the client asks the server to **reconcile** the draft: the server looks the request key up among the actor's own receipts or issues on the drafted target and answers `saved` with `{ kind, id, replayed }` or `unsaved`. An unsaved draft can be **resumed**: the server executes the stored command with the stored arguments under the actor's current authority; the command is idempotent by request key, so a resume after a lost-but-committed answer replays the one record and never creates a second, and a resume never sends edited content. Drafts expire after twenty-four hours (reconcile marks expiry on touch; resume and discard of an expired draft refuse) and can be discarded.

## A shared device never shows another person's work

Drafts are readable only by their actor under current site authority (the COL-133 helpers, not the actor id alone): another person signing in on the same device, another organisation, an actor whose grant was revoked or expired, or a signed-out session sees nothing and every command answers `Operation unavailable`. The same person from a new session can reconcile and resume. The arguments (values, notes, subject identifiers) are returned only to the owner inside the command replies, never appear in an error, are omitted from the list, and are hidden from the generic audit read. No client DML exists; every write goes through the commands under the owner-secret token, identity is immutable, states move forward only, and rows are never deleted.

## The client never says saved without a record

A framework-free save machine (`recovery-client.ts`) runs save-draft → execute → saved only when the server returned the record; a usable refusal (a JSON body with the server's outcome class) rejects and discards the draft; a lost answer of any kind (including a truncated or empty 2xx and a non-JSON 4xx) reconciles first and offers "Retry the same save" only when the database answers unsaved; a refusal on retry reconciles again before rejecting, so two tabs resuming the same draft both end saved. Without connectivity the state is `offline` with the work explicitly not saved. A 401 keeps the draft and asks the person to sign in again. The hook keys its state by actor and drops it on sign-out or user switch, ignoring in-flight answers; the notice renders each state with distinct wording, a polite live region, keyboard-reachable actions and the current person. No `localStorage`, `sessionStorage`, `indexedDB` or cookie writes exist in the runtime (a test proves it).

## API

`POST /api/admin/operations/drafts` (save; `request_key`, `command`, `target_id?`, `facility_id?`, `arguments`), `GET /api/admin/operations/drafts?state=pending` (the caller's own drafts, arguments omitted), `GET …/drafts/[id]` (reconcile), `POST …/drafts/[id]/resume`, `POST …/drafts/[id]/discard`. A draft of another actor answers 404. Resumed replies are mapped exactly as the original route would map them, conflicts included.

## Verification

1. `npm test -- src/app/api/admin/operations src/lib/operations src/hooks "src/app/(admin)/admin/operations"`
2. `npm run typecheck`; `npm run lint`; `npm run segment:gates -- --segment COL-146-HFO-RECOVERY --ui`
3. Native replay executes `supabase/tests/review_hfo_command_drafts.sql` (173 assertions) and `scripts/facility-operations/test-draft-concurrency.py` observes two concurrent resumes and a resume racing a discard in both orders on the run-owned PostgreSQL 17 cluster.

## Migration and rollback

`345_hfo_command_drafts.sql` (provisional number) follows this branch's unapplied 336–344 and replaces nothing in place. Numbers are branch-local; integrate after COL-145 in the recorded Finance-first order and re-read the hosted ledger before assigning final numbers. Before application, rollback is reverting this segment. After application, drop the table, the four commands, their wrappers and helpers, and the restrictive audit policy.

Engineering policies recorded for confirmation in `docs/facility-operations/OWNER-DECISIONS.md` (3h). Mission alignment: PASS for the bounded foundation. Operating readiness: RISK.
