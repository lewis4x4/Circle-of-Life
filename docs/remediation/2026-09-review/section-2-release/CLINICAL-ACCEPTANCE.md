# Section 2 Homewood clinical acceptance

Status: NOT RUN. Requires named Homewood tester and actual results; engineering checks do not substitute for clinical judgment.

Before starting, record tester/role, supervising clinical lead, date, verified environment URL/project, deployed commit, migration333, Homewood facility, approved data, and device/OS/browser version. Homewood facility ID: `00000000-0000-0000-0002-000000000003`. The agent requested the tester name during the release task; no tester is presumed appointed.

Use authorized read-only views or truthful observations performed by responsible staff in production. Use the isolated synthetic test target for failures, duplicate requests, fake/late/future observations, transfers, role revocations and deliberate conflicts. Never enter simulated clinical observations into live resident records.

| Case | Staff walkthrough | Required result | Status |
|---|---|---|---|
| S2-U01 | Administrator and caregiver sign in separately and open their Homewood workspace. | Correct role and facility; wrong-role denial; no foreign-facility identity. | NOT RUN |
| S2-U02 | Administrator/nurse checks current quality values against approved source records. | Latest period/correction appears once; history remains available. | NOT RUN |
| S2-U03 | Assigned caregiver records a clinically required observation; lead checks administration view. | Correct resident, original time, content, author, exception and one completion. | NOT RUN |
| S2-U04 | On synthetic target, lose response, close/reopen drawer or caregiver form, retry. | Original details/time restored, clinical fields locked, one acknowledged completion. | NOT RUN |
| S2-U05 | On supported device/synthetic target, disconnect, submit, reconnect and recover outbox. | Original payload/request/time; pending visible; acknowledgment removes one queued item; conflicts remain. | NOT RUN |
| S2-U06 | On synthetic target, let unsaved attempt cross five minutes; try blank and then meaningful reason. | Reason amendment only after explicit unsaved rejection; blank rejected; saved exact replay requires no new reason. | NOT RUN |
| S2-U07 | On synthetic target, change operator/session or revoke authority before retry. | Old observation cannot save under different authority; zero unauthorized writes. | NOT RUN |
| S2-U08 | Search a permitted resident, add spaces, edit away/back; open staff/vendor/incident links. | Stable current results; no obsolete response; resident-only search clearly explained; correct module links. | NOT RUN |

For each row record PASS/FAIL/BLOCKED, tester, timestamp, role, facility, deployed SHA, route, expected/actual outcome, redacted screenshot/recording, and issue link. Keep patient content and credentials out of committed evidence.

Drawer and caregiver pending records are per-tab memory until server acknowledgment or successful outbox persistence; page reload/tab closure is a separate recovery boundary. Use actual devices to confirm offline/outbox persistence and clock alignment. Newly queued caregiver requests remain bound to the original signed session; ending that session requires reconciliation instead of automatic submission under a new session. Legacy queue items without this binding retain their existing owner checks.

This packet closes Section2 clinical acceptance only. Unrelated TrackA billing/family/staffing acceptance is not reopened or marked complete. A5 remains historically closed.

Do not use `homewood:test-launch` or `homewood:preflight` against production: their existing broad suite writes clinical records and includes hard-delete cleanup. Existing bearer-only RBAC probes do not establish browser cookie-session authorization.
