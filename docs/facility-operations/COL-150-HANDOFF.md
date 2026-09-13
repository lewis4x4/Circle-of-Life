# COL-150 Needs Attention delivery

Mission alignment: **pass**. Source branch `codex/hfo-col150-needs-attention` starts from COL-149 commit `c7859efa` and is reviewed against that stack, which already includes current main `50bc07c4`. COL-149/COL-144 dependencies were verified clear in Linear before work started.

## Delivered

`/admin/operations/attention` shows overdue work, unresolved issues, missing evidence, waiting, unassigned and configuration-needed records across currently permitted facilities. Each card states its population and definition; categories overlap and are not summed into an overall percentage. High-severity unresolved issues remain visible when a different category is selected.

Filtered detail reconciles to complete reads beyond provider caps. Rows expand to exact occurrence receipt/evidence or issue detail. Unknown configuration and later-source failures remain unknown; missing accessible facilities cannot certify health. A failed performed check keeps its unresolved issue until that issue is separately resolved.

Migration `364_hfo_attention_ownership.sql` adds only a guarded read projection of existing task primary/approved-backup eligibility. It adds no assignment, schedule, notification or policy activation. Issue role ownership retains its existing semantics. The new view/wrapper use invoker boundaries, with current task readability before/after the private eligibility read. Raw private helper permissions remain unchanged. No dependency was added.

## Verification

Final executed results: [verification.json](col150-evidence/verification.json). Separate technical review passed the initial 29 focused tests and the final eight UI tests; the retained final combined focused run passed 30 tests. Cases include 1,103 records under a 17-row provider cap, filtered-detail reconciliation, later-page failure, unknown/not-applicable/future configuration, separate issue state, actor/scope changes, UI paging/stale responses and axe. The native SQL probe tests primary/pinned/backup eligibility and negative current-authority/privilege cases.

The first full run hit one unrelated AppShell search timeout. That file passed unchanged on a focused rerun; the full verification rerun uses four workers and unchanged timeouts. The original failed run is retained. A current-evidence fixture was corrected to schema-valid `complete`; all nine classifier tests passed afterward.

## Environment, release and rollback

Source delivery only. The new migration was not applied to hosted staging or production. No main merge or deployment occurred. Native PostgreSQL uses Supabase stubs; public preview and component axe are not authenticated hosted browser or staff/clinical/operating acceptance. Q29 escalation/urgency decisions, COL-140 configuration and COL-161 core release remain separate.

Before release, apply the reviewed stack including migration364 to the authorized target and execute hosted acceptance. Before application, rollback is reverting this bounded segment or closing its draft PR; immutable preceding evidence remains untouched. No stored-data rollback is needed for this read-only segment.

Next bounded source delivery is COL-151 complete authorized activity-history export, subject to current Linear dependency recheck. Its snapshot/cutoff contract is separate from this view's change-detecting pagination.
