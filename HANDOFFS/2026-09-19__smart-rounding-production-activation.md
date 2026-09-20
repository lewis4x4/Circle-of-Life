# Smart Rounding production activation — 2026-09-19

Mission alignment: **pass** for deployment correctness; staffing and device/provider readiness remain explicit operational limits. Brian explicitly authorized production activation, migrations, and Edge Functions in this task after PR #595 merged.

## Scope and sequence

Release frontend source: `3ef3359b8ecd586b4eef56bd801918dcf21aeef6`. Production is `manfqmasfqppukpobpld`; staging is `iwcnajanvjvynolltflw`. Targets were specified explicitly, independently of the checkout's Supabase link. Production PITR was confirmed enabled with a current recovery window; staging had a completed September 19 physical backup.

Staging received 433–434 first. Hosted rollback probes verified historical compliance, assignment recovery with real Auth/RLS, and reliable delivery. Local-only test adaptations removed replacement of hosted `auth.uid` and provided isolated synthetic delivery fixtures; all fixtures rolled back and absence was verified. Four worker auth refusals returned 401 and authorized zero-scope ticks returned 200.

Production's two existing legacy rounding jobs were paused for the rollout. Migrations 417–434 were applied in order, each with its ledger insert inside the same transaction; all were independently verified afterward. The four reviewed Edge Functions were explicitly deployed with application-secret authentication and gateway JWT verification disabled, as their cron contract requires. Existing generator/escalation secrets were preserved; new activator/Watchlist secrets were created privately in Vault and Edge configuration. Immediate activation-to-generator calls now have the generator URL configured.

## Live-only defect and correction

The real production Watchlist worker returned HTTP 207 for all five facilities. Its actual PostgREST error was SQLSTATE `21000`, `DELETE requires a WHERE clause`. Direct management SQL and local replay did not reproduce it because the hosted API session enables the `safeupdate` extension.

Migration **435** changes only the evaluator's scratch reset from unconditional `DELETE FROM watchlist_eval_match` to `TRUNCATE TABLE pg_temp.watchlist_eval_match`. This is a session-local temporary working table; no resident, clinical, or persistent signal data is truncated. Existing evaluator grants and all other function behavior are unchanged. A regression verifies repeated evaluation clears prior-call working rows and preserves service-only execution. The actual staging worker returned HTTP 200, `ok:true`, and five of five successful facilities after 435, proving the formerly failing API path.

## Scheduling

Existing job IDs/names were reused, avoiding duplicate workers. Production keeps its legacy job names even though their schedules are updated:

| Job | ID | Schedule (GMT scheduler) |
| --- | --- | --- |
| `observation-task-generator-4h` | 32 | `3-59/15 * * * *` |
| `observation-escalation-15m` | 31 | `4-59/5 * * * *` |
| `smart-rounding-cadence-activator` | 41 | `2-59/5 * * * *` |
| `smart-rounding-watchlist` | 42 | `7 * * * *` |
| `monitoring-order-expiry-daily` | 43 | `20 7,8 * * *` with America/New_York 03:20 guard |

The expiry guard runs once at 03:20 local time across daylight-saving changes, without changing unrelated jobs' global timezone. HTTP jobs retrieve secrets from Vault at execution time and use an explicit 120-second request timeout. A cron success alone means request queuing; HTTP response and worker result must also be checked.

## Operational limits

The first live generator processed all five facilities, with no missing cadence or facility execution error. It honestly returned HTTP 207 for a real staffing gap: Homewood Lodge's September 19 night shift left 25 residents unassigned. No staff assignments were invented. Publishing that actual roster lets the verified late-roster recovery assign the existing open tasks.

Neither environment had Twilio SMS configuration or active push subscriptions. Production already had an active `dispatch-push` function and VAPID configuration; those were preserved. SMS/device delivery is not claimed. In-app delivery remains restricted to actual available recipient surfaces, with unavailable channels recorded truthfully.

Local browser/Auth rehearsals and deployed service-role verification do not replace staff/device UAT. The available native browser surface exposed no usable authenticated page state, so an authenticated production five-tab browser witness is not claimed.

## Rollback boundary

For an operational failure, pause the affected job IDs first. Preserve new clinical/history evidence; do not reverse migrations or hard-delete generated records. Use the recorded prior Netlify deployment for a frontend-only rollback if compatible, and the existing PITR/forward-correction procedure for a database incident. Private pre-change cron definitions were retained outside the repository with restrictive permissions; no secrets are committed.

## Backend activation verified

Production435 is applied and recorded. The actual Watchlist worker returns200/ok:true for all five facilities. All five schedules are active. Executing the installed HTTP commands through pg_net produced200 for activation, Watchlist, and escalation, and207 only for the known Homewood staffing gap; no request timed out. Monitoring Order expiry executed successfully with0 expired orders. All26 new public tables have RLS enabled and policies present.

[Required gate PASS](../test-results/agent-gates/2026-09-19T21-51-39-728Z-SMART-ROUNDING-HOSTED-WATCHLIST-20260919.json):438 migrations,82 probes,seven SQL acceptance suites,105 care-event parity cases,security/typecheck/lint/build/stress. [Machine evidence](../test-results/production-activation/2026-09-19-smart-rounding.json) retains both the initial live failure and the verified correction.
