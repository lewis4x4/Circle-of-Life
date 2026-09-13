# COL-146 settled engineering contracts (source-only)

Settled 2026-09-10 from the live COL-146 acceptance (HFO-17), BUILD-SCOPE section 7 ("Core online-first recovery persists request identifiers and confirmed server draft IDs, not uncontrolled sensitive payloads/files in shared browser storage. Same-person reauthentication can resume under current permissions; logout/user switch hides and locks prior drafts. Without connectivity show the pending/unsaved state; do not claim a successful offline submission.") and section 4 ("Offer a current-person indicator on every recording surface and a safe user-switch path on shared devices"), on top of the COL-142 receipts (341), COL-143 evidence (343) and COL-145 corrections (344) command contracts. Migration: `supabase/migrations/345_hfo_command_drafts.sql` (provisional branch-local slot, stacked on 344). Probe: `supabase/tests/review_hfo_command_drafts.sql`. Race script: `scripts/facility-operations/test-draft-concurrency.py`.

**Dependency exception recorded.** COL-146 is blocked in Linear by COL-143, which stays In Progress until its hosted Storage proof exists. The owner authorized source-only implementation against the reviewed COL-143 interface. Nothing here closes or marks complete COL-143's hosted acceptance. Q25 (records available during an outage) stays open; approved encrypted offline drafts and downloaded emergency packets are a separate scoped feature and are not built here.

## 1. Vocabulary

- **Draft**: a row of `operation_command_drafts`: the exact arguments of one command (`record_work`, `verify_work`, `correct_work`, `reverse_work`, `report_issue`) that the actor is about to issue, stored server-side under the actor's own identity with the request key the command will use. The browser holds no payload; at most it holds the draft id in memory.
- **Uncertain save**: the client issued a command and did not receive a usable server answer (lost response, reload, process restart, network failure, timeout, or a 5xx without a parseable body). The truth lives in the database: either the command's record exists under that request key or it does not.
- **Reconciliation**: the server looks the request key up (receipts for the four receipt commands, issues for `report_issue`) for the same actor and answers `saved` with the record, or `unsaved`. An unsaved draft can be **resumed**: the server executes the stored command with the stored arguments under the actor's current authority; the underlying command is idempotent by request key, so a resume after a lost-but-committed response replays the one record instead of creating a second one, and a resume never submits edited content.

## 2. Schema (migration 345)

### 2.1 `operation_command_drafts`

| column | rule |
|---|---|
| id; organization_id; facility_id | facility from the target occurrence, or the payload's facility for a scoped issue report |
| actor_id → user_profiles | `auth.uid()` at save; immutable |
| actor_session_id uuid NULL | `auth.jwt()->>'session_id'` at save; audit only |
| command text | `record_work` / `verify_work` / `correct_work` / `reverse_work` / `report_issue` |
| target_id uuid NULL | the occurrence for the receipt commands; NULL for a scoped issue report |
| request_key text NOT NULL UNIQUE | the key the command will use (341 pattern) |
| arguments jsonb NOT NULL | the command's arguments as the route would send them: `{ payload }` for record/verify/report; `{ expected_receipt_id, expected_receipt_revision, payload }` for correct/reverse |
| arguments_hash text NOT NULL | sha256 of `{actor, command, target, arguments}` |
| state text | `pending` → `reconciled` / `discarded` / `expired`; forward only |
| created_at; updated_at; expires_at | expires_at = created_at + 24 hours |
| reconciled_at; reconciled_record jsonb NULL | `{ kind: 'receipt' \| 'issue', id, replayed }` |
| discarded_at; revision | server-owned |

RLS SELECT: `actor_id = auth.uid()` and organization matches and current site authority (`haven.operation_task_readable(target_id)` when a target is set, else the COL-133 site access check for `facility_id`). No client DML; no service_role DML; commands only, under the owner-secret token. Guard: identity columns immutable, forward-only states, no DELETE, no TRUNCATE. Audit trigger; the restrictive generic-audit read policy is extended with this table (arguments carry values and notes). Index `(actor_id, state, created_at)`.

Nothing in a draft grants anything: reading a draft back requires the same current authority as issuing the command, and resuming it runs the command's own locks and checks.

### 2.2 Expiry

A pending draft past `expires_at` reads as `expired`: the reconcile command marks it so on touch (after first looking the record up, so a committed record always reads as saved), the list presents it as expired, and resume or discard of such a draft refuse with `Draft has expired` without persisting a mark (a refusal rolls back). It cannot be resumed; the operator starts a fresh save with a new request key.

## 3. Commands (session; token; `haven.lock_operation_work_authority(target, NULL)` for a targeted draft, else `haven.lock_operation_recorder(org, facility)`, before and after DML)

- `save_operation_command_draft_review(p_request_key text, p_payload jsonb)`: payload `{ command, target_id?, facility_id?, arguments }`. Shape → the command's target rules (a managed occurrence readable by the caller for the receipt commands; a facility of the caller's organisation the caller can access for a scoped issue report; `arguments` an object, at most 64 KiB) → lock → replay by key: same actor and same hash → the existing draft (`replayed: true`); same actor, different hash → `This request was already saved with different content` (P0001); another actor's key → `Operation unavailable` (42501, nothing disclosed) → insert `pending` → reply `{ draft, replayed }`. The draft is returned with its arguments to its owner only.
- `reconcile_operation_command_draft_review(p_draft uuid)`: owner only (`Operation unavailable` otherwise, nothing disclosed); lock; expiry on touch; look the request key up (receipt with `recorder_id = auth.uid()` for the receipt commands, issue with `reported_by = auth.uid()` for `report_issue`) → found: state `reconciled`, `reconciled_record` set, reply `{ draft, outcome: 'saved', record }`; not found: reply `{ draft, outcome: 'unsaved' }` (state stays `pending`), or `{ outcome: 'expired' | 'discarded' }`. Idempotent.
- `resume_operation_command_draft_review(p_draft uuid)`: owner only; pending and not expired; dispatches by `command` to `haven.record_operation_work`, `haven.verify_operation_work`, `haven.correct_operation_work`, `haven.reverse_operation_work` or `haven.report_operation_issue` with the stored target, key and arguments; on success marks the draft `reconciled` with the record and returns `{ draft, outcome: 'saved', reply }` where `reply` is the command's own reply (its `replayed` flag tells whether the earlier attempt had committed). On failure the command's exception propagates unchanged (the transaction rolls back, the draft stays `pending`) so the route maps it exactly as the original route would. Two concurrent resumes serialise on the draft row (`FOR UPDATE`); the second finds the record and replays.
- `discard_operation_command_draft_review(p_draft uuid)`: owner only; pending → `discarded`; idempotent on a discarded draft.

## 4. Runtime and API

- `src/lib/operations/recovery.ts`: zod schemas — `saveDraftBodySchema` (`request_key`, `command`, `target_id?`, `facility_id?`, `arguments` validated per command with the existing `recordWorkPayloadSchema`, `verifyWorkBodySchema` payload, `correctWorkBodySchema`/`reverseWorkBodySchema` arguments and `reportIssueBodySchema` payload), `DRAFT_SELECT`, `mapDraftRpcError`, draft outcome classes `saved` / `unsaved` / `expired` / `discarded`, and the resumed reply mapped through the receipt or issue mapping of the original command.
- Routes (pattern as COL-142/144: `requireOperationsActor(OPERATIONS_VIEW_ROLES)` → strict body → session read of the target (404) → `actorCanAccessFacility` (404) → `revalidateOperationsActor` → RPC → mapping; replies strip `arguments_hash`): `POST /api/admin/operations/drafts` (save), `GET /api/admin/operations/drafts?state=pending` (the caller's own drafts through the session client, newest first, at most 50, arguments omitted from the list), `GET /api/admin/operations/drafts/[id]` (reconcile), `POST …/[id]/resume`, `POST …/[id]/discard`.
- Client (`src/lib/operations/recovery-client.ts`, framework-free, fully unit-tested): a save runs `saveDraft` → `execute` → on a usable answer, `saved` (only when the server returned the record) or `rejected` (the server's outcome class and message; the draft is discarded); on a lost answer, `uncertain` → `reconcile` → `saved` / `unsaved` (offer "Retry the same save", which calls `resume` and never re-sends edited content) / `expired`. When `saveDraft` itself cannot reach the server, the state is `offline` with the work explicitly `not saved`; nothing is persisted anywhere. Never a `saved` state without a server record. No `localStorage`, `sessionStorage`, `indexedDB` or cookie writes (a test greps the module for them).
- Hook and notice: `src/hooks/use-pending-save.ts` keys the in-memory machine by the current actor id and drops it when the actor changes or signs out; on mount it lists the actor's pending drafts so an earlier unsaved save is surfaced for reconcile, resume or discard. `src/app/(admin)/admin/operations/_components/save-state-notice.tsx` renders the states (saving, saved, not saved, retry offered, offline, uploading, expired) with design-system tokens, `role="status"`, `aria-live="polite"`, keyboard-reachable actions and distinct visible text; `current person` is shown from the actor on the same notice. Wiring into the staff workspace is COL-148.
- Shared device: drafts are server-owned and RLS-scoped to the actor, so another person signing in on the same device never sees, resumes or discards them; the client keeps no cross-session state; sign-out resets the in-memory machine.

## 5. Verification

- Probe (rolls back): save → pending draft for the actor; replay by key; different content conflict; another actor's key → `Operation unavailable`; the other actor sees no draft (RLS) and cannot reconcile, resume or discard it; a revoked site grant makes the owner's own draft unreadable and unresumable; reconcile before the command → `unsaved`; the command issued with the same key and arguments → reconcile `saved` with the receipt; resume of an unsaved draft executes the command once and marks the draft reconciled; resume after the command had committed → `saved` with `replayed: true` and no second receipt; resume of a `correct_work` draft whose expected revision is stale → the correction conflict, draft still pending; expired draft → `expired`, resume refused; discard → discarded, resume refused; direct DML denied for authenticated and service_role with the forged setting; drafts immutable and forward-only; every earlier probe passes unchanged.
- Race script (two cases): two resumes of one draft concurrently → one receipt, one draft reconciliation, the other replays; a resume racing a discard → either the resume lands and the discard is refused, or the discard lands and the resume is refused; never a receipt from a discarded draft.
- Vitest: schemas, mapping, routes (save, list, reconcile, resume dispatching, discard; 404 for other actors' drafts), the client machine (usable answer, lost answer then saved, lost answer then unsaved then resume, offline, never-saved-without-record, no browser storage), the hook (actor switch drops state; sign-out drops state), the notice (states, live region, keyboard actions; axe on the rendered notice).
- Gates: focused suite, typecheck, lint, native replay, strict gate `--segment COL-146-HFO-RECOVERY --ui`.

## 6. Boundaries kept

No offline submission, no encrypted offline draft, no emergency packet, no notification (Q25 open). No file bytes are drafted: an interrupted upload is visible through the uploader's own in-flight evidence rows (343) and the notice's `uploading` state; the evidence retry path stays a new preparation. No UI surface beyond the notice (COL-148). Engineering policies to list in `OWNER-DECISIONS.md` (3h): (i) drafts live server-side under the actor and expire after 24 hours; (ii) a resume replays the stored arguments and never edited content; (iii) the same person may resume from a new session, nobody else may; (iv) the browser keeps nothing beyond memory. Source only.
