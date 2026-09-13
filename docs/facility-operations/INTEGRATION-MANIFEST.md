# Integration manifest — baseline fad17dcc

This is a bounded source inspection of tracked OCE, auth, scheduler, meeting and domain consumers. It is not a claim that every external/dynamic writer was discovered. Existing source is reused; new behavior belongs to the listed HFO issue. Paths below are repository-relative.

| Existing source | Reuse / required extension |
|---|---|
| `195_operation_task_templates.sql:13,76`, `196_operation_task_instances.sql:12`, `199_operation_audit_log.sql:13` | OCE templates, instances and audit. COL-132 stable activity/source identity; COL-135 immutable published requirements/applicability; COL-139 validated subject/period occurrence. Template UUID cannot remain the historical activity identity. |
| `src/lib/auth/current-api-actor.ts:101,163`, `src/lib/operations/auth.ts:31,48,74,104`, migrations 326/327 | Current profile/facility/role authorization. COL-133 must extend subject/evidence/count/search/export/replay and revocation after waits; a facility filter is insufficient. |
| `327_sys_001e_lifecycle_authorization.sql:797,863` | Completion/defer commands lock then recheck current actor and independent second signature. COL-142 needs request identity/fingerprint, immutable performance/recording attribution and atomic issue linkage; COL-145 preserves corrections/legacy writers. Completed-state return alone is not payload-aware replay. |
| `331_rounding_completion_receipts.sql:10,100,157` | Released immutable receipt/replay pattern. Reuse the approach without claiming it already covers OCE. |
| `src/app/api/admin/operations/tasks/route.ts:62`, `src/lib/operations/server.ts:236` | Current list defaults 250/caps 1,000, summary over retrieved rows, missing due time falls back to UTC midnight. COL-137 truthful schedule; COL-148–151 full reads/counts/history/export and explicit partial/error state. |
| `supabase/functions/oce-task-scheduler/index.ts:388,443,458`, migration 201:183 | Current limited recurrence; due derived from escalation/duration; unique identity uses template/site/day/shift. COL-137 shared evaluator; COL-139 stable subject occurrence; COL-152 approved reminders. |
| `196_operation_task_instances.sql:48`, completion command | Raw evidence paths accepted. COL-143 classified immutable evidence, prepare/upload/finalize and retry/correction concurrency. Installed bucket limits do not establish authorization. |
| `src/app/(admin)/admin/operations/page.tsx:205`, `pager/page.tsx:85` | Fixed completion note and Pager fetch without response.ok handling. COL-148 and COL-146 one-action work capture, saved receipt and honest recovery. |
| `197_facility_assets.sql:14`, `220_col_v2_operational_logs.sql:4,41,65,91,114` | Reuse assets and fire/generator/other logs. COL-147/154 explicit source match/replay/invalidation; COL-144 corrective owner/backup/next-action/resolution. Inspection is not repair completion. |
| `335_employee_file_lifecycle.sql:3,22,29,40,75,128,181` | Released employee records/requirements/signatures/audit/private storage. COL-156 adapter preserves personnel/medical boundaries and unresolved source policy. No second staff master. |

Migration filenames above are under `supabase/migrations/`. Other source domains are mapped by the planning package's CODE-EVIDENCE C06–C16, to be inspected only when their adapter issue begins. Finance, insurance, Operating Evidence and Remaining Roadmap work remains at the heads in `evidence/concurrent-migrations.json`; it is not implicitly delivered main.

## Legacy writers to migrate under COL-145 / HFO-08

| Writer | Current path / command | Risk to preserve |
|---|---|---|
| Complete | `src/app/api/admin/operations/tasks/[id]/complete/route.ts:61` → `complete_operation_task_review` | Current authority, evidence and signature semantics. |
| Defer | `src/app/api/admin/operations/tasks/[id]/defer/route.ts:89` → `defer_operation_task_review` | Audit and explicit reason; no erased period history. |
| Bulk | `src/app/api/admin/operations/tasks/bulk-complete/route.ts:70` → migration 321:211 wrapper | Migration 264 is superseded. First HFO release excludes bulk complete. |
| Start / reinstate / escalate | Corresponding task `[id]` API routes at lines 58 / 54 / 90 | Service-role updates with separate audits; reinstate clears missed/deferred facts today. |
| Scheduler | `supabase/functions/oce-task-scheduler/index.ts:327` | Retry-safe generation and unknown timing. |
| Escalation scanner | `supabase/functions/oce-escalation-scanner/index.ts:155,170,185` | Separate instance/delivery/audit calls; no invented provider-delivery success. |
| Meeting action creation | `src/app/api/admin/meetings/[id]/actions/route.ts:33` → `public.create_meeting_action`, migration 324:19 | Inserts an OCE instance. |
| Reciprocal meeting sync | `src/app/(admin)/admin/meetings/[id]/page.tsx:209`; migration 324:32,41,49 `haven.sync_meeting_action_status` / `sync_task_from_meeting` | Meeting state can update OCE; reopening clears completed_at. Preserve history and avoid recursive duplicate receipts. |

UI callers: Today (`operations/page.tsx:186`), Pager (`operations/pager/page.tsx:85`), overdue (`operations/overdue/page.tsx:68`), missed (`operations/missed/page.tsx:67`) and meeting detail. All these paths are beneath `src/app/(admin)/admin/`.

Other affected readers: task range/calendar, kanban, morning huddle, housekeeper dashboard, staffing-adequacy API/Edge Function and risk-nightly scorer. Regress them when occurrence/status semantics change. `auto_complete_after_hours` was located in configuration/schema/serialization but no executing completer was found in this bounded source search; do not claim it currently auto-completes work.

Focused behavioral suites run for this baseline are in `evidence/verification.json`. SQL replay includes authoritative actor, clinical integrity, office integrity, rounding receipt and RPC grant-posture probes. New HFO commands still need their own real-auth/storage/history/concurrency acceptance.
