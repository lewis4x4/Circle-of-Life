# COL-145 legacy writer inventory (source at 5367f6e7, branch codex/hfo-col143-evidence)

Bounded source inspection of every path that writes `public.operation_task_instances` or its completion columns, made 2026-09-10 before the correction commands were built. "Managed row" means `occurrence_kind IS NOT NULL` (340:136). The owner-secret setting is `haven.operation_occurrence_command`, minted by `haven.operation_occurrence_token()` and checked by `haven.operation_occurrence_approved()` (340:24-40); the three functions are revoked from every role, so only owner-run definer commands can hold it. Table grants: `authenticated` has SELECT only (337:142-144); `service_role` keeps INSERT and UPDATE but not DELETE, and the 341 guard refuses any `auth.uid() IS NULL` update of a managed row without the token (341:269-271). There is therefore no session-client direct DML path at all; every session write is an RPC.

## Application and Edge Function writers

| # | Path | Call | Client | Managed rows |
|---|---|---|---|---|
| 1 | `src/app/api/admin/operations/tasks/[id]/complete/route.ts:72` | `complete_operation_task_review` | session | refused (341:753 `Managed occurrences are recorded through the receipt command`); the route allow-lists the message |
| 2 | `…/tasks/[id]/defer/route.ts:88-98` | `defer_operation_task_review` (updates the row and inserts a replacement) | session | refused (340:793 `Managed occurrences cannot be deferred by the legacy command`) |
| 3 | `src/lib/operations/task-command.ts:25-28` → `haven_operation_task_command` (start, reinstate, escalate) | `haven.operation_task_command` (340:884) | session | `reinstate` refused (340:891); `escalate` refused unconditionally (340:894, short-circuited in TS); **`start` permitted** on managed rows by the deliberate 341:281 carve-out (`pending → in_progress` only) |
| 4 | `…/tasks/bulk-complete/route.ts:9` | none: returns 409 `Complete tasks individually` | — | dead; `public.bulk_complete_operation_tasks` (321:211, body 264:59) is revoked from every role (337:509) and has no caller |
| 5 | `supabase/functions/oce-task-scheduler/index.ts:653,659` | direct `.insert()` of legacy candidates | service role | inserts legacy rows only (`occurrence_kind` NULL); a managed identity needs the token (340:180); the service branch of the authority guard forbids performance columns (340:928-932) |
| 6 | `oce-task-scheduler/index.ts:563,588` | `generate_operation_occurrences_service`, `reconcile_operation_occurrences_service` | service role | sanctioned commands (token set inside) |
| 7 | `supabase/functions/oce-escalation-scanner/index.ts:19` | none: returns 409 | — | closed; no instance writes remain |
| 8 | `…/occurrences/[id]/record`, `verify`, `cancel`, `manual`, `associate` routes | receipt and occurrence commands | session | sanctioned (token set inside) |
| 9 | `…/evidence/[id]/finalize` → `haven.finalize_operation_evidence` → `haven.satisfy_operation_receipt_evidence` (343:352, update 343:369) | evidence command | session | sanctioned; the satisfier is an INVOKER helper revoked from every role that runs inside the finalize command's token window |
| 10 | `src/app/api/admin/meetings/[id]/actions/route.ts:41` | `create_meeting_action` (324:19) | session | dead: `MEETING_TASK_CREATION_AVAILABLE=false` returns 409 before the RPC; the RPC is revoked from every role (337:509); it creates legacy rows only |
| 11 | `src/app/(admin)/admin/meetings/[id]/page.tsx:209-211` | updates `meeting_action_items`; the meeting → task direction of `haven.sync_meeting_action_status` | session | refused for any linked task, managed or legacy (337:456-468 raises `Use the authorized operations command for linked task status`); the task → meeting direction writes `meeting_action_items` only |
| 12 | kanban, morning huddle, task list, occurrences, receipts, issues, staffing computer, risk scorer | selects, or writes to other tables | — | no instance write |

UI callers of the mutation routes: `operations/page.tsx` (start :187, complete :203, escalate :222, bulk :245), `operations/pager/page.tsx` (complete :85, defer :96, escalate :108), `operations/overdue/page.tsx` (start :74), `operations/missed/page.tsx` (reinstate :67). None filters on `occurrence_kind`; the legacy pages therefore offer Complete, Defer and Reinstate on a managed occurrence and surface the database refusal, and Start succeeds. COL-148 replaces these surfaces for managed work.

## SQL functions that insert or update the table

| Function | Where | Token | Status |
|---|---|---|---|
| `haven.generate_operation_occurrences`, `haven.reconcile_operation_occurrences`, `haven.create_operation_manual_occurrence`, `haven.associate_operation_occurrence` | 340 | yes | current |
| `haven.cancel_operation_occurrence` | 340 → 341 → 342:560 | yes | current; refuses recorded work and open issues |
| `haven.record_operation_work` | 341:396 | yes | current |
| `haven.verify_operation_work` | 341 → 343:581 | yes | current; replaced again by 344 (binding) |
| `haven.satisfy_operation_receipt_evidence` | 343:352 | inherits from finalize | current |
| `haven.defer_operation_task_review` | 340:765 | no | legacy; refuses managed rows |
| `haven.operation_task_command` | 340:884 | no | legacy; start permitted, reinstate refused, escalate refused |
| `haven.complete_operation_task_review` | 337 → 341:735 | no | legacy; refuses managed rows |
| `haven.sync_meeting_action_status` | 324 → 337:456 | no | meeting → task refused |
| `public.create_meeting_action`, `public.bulk_complete_operation_tasks` | 324:3, 264/321 | no | revoked from every role |
| one-time backfills | 201, 336:183, 337:75, 343:188 | — | migration time only |

## Triggers on the table, in firing order

`operation_instance_activity` (336:291, sets `activity_id`) → `operation_instance_rule_snapshot` (338:387) → `operation_occurrence_identity` (`haven.guard_operation_occurrence`, 340:225, body 341:227: the central fence) → `trg_require_dual_operation_verification` (321:207) → `zz_operation_current_authority` (337:209, body 341:333) → `sync_meeting_from_task` AFTER UPDATE OF status (324:48).

## The 341 fence on managed rows (341:276-283)

Without the token, any change to `effective_receipt_id, verification_receipt_id, performed_at, execution_state, completed_at, signed_by, signed_at, second_sign_by, second_signed_at, verified_by, verified_at, sla_met, completion_notes, completion_evidence_paths` raises 42501 `Managed occurrences are recorded through the receipt commands`; any `status` change other than `pending → in_progress` raises the same; identity columns, `due_at`, `assigned_shift_date` and `assigned_shift` are immutable; `deleted_at` moves only under the token with `status='cancelled'`.

## Consequence for COL-145

No writer needs translating into a receipt: every reachable legacy mutation of a managed occurrence is already refused, dead or revoked, except the ordinary start transition, which COL-142 kept on purpose. COL-145 therefore (a) proves each refusal in its probe, including no partial write and no erased history, (b) adds the correction, reversal and review-binding commands as the only ways recorded work changes, (c) makes the legacy routes answer managed rows with the trusted message instead of a generic retry hint, and (d) records the start carve-out and the scheduler's legacy-only insert as retained behaviour rather than bypasses.
