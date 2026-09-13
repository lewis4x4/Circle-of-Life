# COL-149 corporate activity history delivery

Mission alignment: **pass**. Implemented on `codex/hfo-col149-corporate-history`, based on reconciled HFO/Finance staging integration `08fd3a43` (PR #490), which includes current main `50bc07c4`. All four Linear prerequisites were confirmed clear before execution.

## Delivered

`/admin/operations/history` provides Facility → Activity → complete managed occurrence history across requirement versions. It shows independent totals, latest performed work, next known due time, open issues, performed/recorded attribution and expandable receipt, correction and finalized-evidence history. Current profile names are explicitly distinguished from recorded performer labels; unavailable names remain unavailable.

The API uses session authority for every projection, scoped microsecond-preserving cursors and a fixed creation-time ceiling. A final revalidation and repeated composition reject changed permissions or results. Current user/facility/activity changes clear old client results. Loading, partial results, failures and confirmed empty history remain distinct.

No new dependency, migration, schedule rule, grant or external delivery channel was introduced. Runtime files are the new corporate-history composer/API, history page and name-display wrapper, plus one shared navigation link.

## Verification

See `col149-evidence/verification.json` for final executed results and `independent-review.json` for separate technical review. The focused suite includes 1,103 records under a 17-row provider cap, tied microsecond timestamps, versions, independent latest performance, access changes, name privacy, client stale responses and component axe. All earlier failed/superseded attempts are retained with their explanations.

## Boundaries and next action

This segment is source delivery. No main merge, production deployment, hosted corporate-history browser proof or human staff/clinical/operating acceptance is claimed. Strict UI preview checks and component axe are not authenticated hosted acceptance. COL-143's separate hosted Storage proof establishes the prerequisite only. COL-140 configuration, COL-161 core release and existing COL-221–224 UI findings retain their own scope.

Next dependent delivery is COL-150 trustworthy Needs Attention counts; COL-151 complete authorized export is also downstream and remains separate. Recheck Linear before selecting the next issue.

Rollback before release: close the bounded draft PR or revert this segment commit. Preserve the preceding integration and immutable receipt/evidence history. No hosted rollback is needed for this source-only delivery.
