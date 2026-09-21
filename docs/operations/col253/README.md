# Scheduled job outcome monitoring — COL-253

Mission alignment: pass. This detects silent failures in safety and operating jobs without authorizing AI processing or changing clinical decisions.

The monitor discovers every current cron job and reports unsupported/new/uninstrumented jobs instead of silently omitting them. Hosted installation, alert routing, and acceptance must be verified separately in private operating evidence.

## Components

The schema is defined in `supabase/migrations/382_scheduled_job_monitoring.sql`. Complete the required database checks and review migration prerequisites before applying it to another environment.

The private `job_monitor` schema stores request IDs, timestamps, status codes, and fixed outcome values. The opt-in wrapper keeps the existing `net.http_post` arguments, schedule, and headers. `pg_cron` success only proves the enqueue SQL ran; `job_monitor.collect()` joins the retained request ID to `net._http_response`. Direct SQL jobs are registered without rewriting and are assessed from sanitized `cron.job_run_details` fields (times and status only). It retains no response body, return message, or secret values. Known billing per-facility errors/blocks are detected even on HTTP 200. A successful result means the observed HTTP/declared result or direct SQL execution succeeded; it does not prove downstream clinical/business acceptance.

The Node runner collects outcomes and compares Vault SHA-256 digests with Management API Edge secret digests. Neither digest nor value is printed. The nineteen known function/env mappings are source-reviewed. A newly discovered endpoint, changed Vault reference, or Vault URL targeting another project fails closed and requires a mapping review. The check does not invoke business functions and does not rotate any secret. Disabled or deleted registered jobs remain alertable. A newer pending request cannot hide an earlier failed response.

Problem-state fingerprints suppress unchanged Sentry reports after successful ingestion. A recovery resets the fingerprint so recurrence alerts again. Workflow concurrency prevents overlapping scheduled checks; manual checks with `--send-sentry` must not overlap the scheduled runner (Sentry delivery and database receipt are separate transactions, so a crash between them can duplicate an event). A failure to collect attempts a sanitized Sentry monitor-failure event and fails the workflow. It never substitutes a successful heartbeat for missing evidence.

## Activation and rollback

1. Reserve the next migration slot, review the SQL, and validate it on disposable PostgreSQL and then staging. Do not reset staging or touch unrelated fixtures.
2. Review each target's current cron owner, command, schedule, endpoint, and secret references. Require `postgres` ownership. After migration apply, opt in each reviewed HTTP ID with `select job_monitor.instrument(<jobid>);` and each reviewed direct SQL ID with `select job_monitor.register_native(<jobid>);`. There is no automatic production registration. Only one `net.http_post` call with named arguments is eligible for rewriting. Native registration refuses commands that call `net.http_get`, `net.http_post`, or `net.http_delete`; asynchronous HTTP work must retain the response-aware wrapper. Unsupported commands must be reviewed, never rewritten speculatively.
3. Run `node scripts/scheduled-jobs/check.mjs --secrets-only` with `SUPABASE_PROJECT_REF` and `SUPABASE_ACCESS_TOKEN` supplied securely in the process environment. Output must show `match` for every active job. Missing and unknown values remain failures.
4. Run `node scripts/scheduled-jobs/check.mjs`. The runner uses UTC cron semantics, a ten-minute lateness/response allowance, and retains up to 100 recent runs per job in each snapshot. Run at least every five minutes; pg_net response retention is short (default six hours). If collection stops longer than retention, `response_missing` is an evidence gap, never success. PostgreSQL run history remains available for diagnosis.
5. Configure email at Admin → Settings → System Alerts. An owner/org_admin can save a primary recipient, up to nine backups, and failure/recovery/monitor alert classes. Backups receive the same alert using BCC; they are not a timed escalation chain. Recipients are stored privately by organization, never in source. Install `RESEND_API_KEY` and `SYSTEM_ALERT_EMAIL_FROM` in the app server environment and in the monitor runner (GitHub secret and variable respectively). The sender must use a verified Resend domain. Missing provider configuration stays visible; it never counts as accepted mail. Use the explicit Send test email action, then deliberately fail an isolated authorized staging fixture. Record actual dated mailbox receipt; provider acceptance alone does not prove delivery. Sentry with `SENTRY_DSN_JOB_MONITOR` is an optional secondary destination.
6. Configure GitHub repository variable `JOB_MONITOR_ENABLED=true` plus secrets `JOB_MONITOR_PROJECT_REF` and `JOB_MONITOR_SUPABASE_ACCESS_TOKEN` after hosted instrumentation and failure injection pass. Email remains independently disabled unless `JOB_MONITOR_EMAIL_ENABLED=true`, `RESEND_API_KEY`, and `SYSTEM_ALERT_EMAIL_FROM` are all configured after recipient/provider approval. `SENTRY_DSN_JOB_MONITOR` is optional. The project reference is a secret so the public step environment does not display the live target. The workflow is disabled by default. It redirects detailed output to exact runner-temporary files, prints only a generic result, uploads no report artifact, and removes those files on exit. Authorized local CLI runs retain rich output; live findings travel only through an approved private destination or the repository's workflow-failure route. GitHub schedules may be delayed, so this is a ten-minute tolerance monitor, not a real-time guarantee. Record a named owner for GitHub workflow failure notifications and independently verify missed workflow runs; the monitor cannot notify while its own runner is unavailable.

Rollback a reviewed HTTP job with `select job_monitor.restore(<jobid>);`. Restoration refuses to overwrite a concurrent command edit and uses the supported `cron.alter_job` surface because hosted Supabase denies row locks/direct updates on `cron.job`. Native jobs are not rewritten and therefore cannot be restored. The registry preserves the original command and all outcome evidence. Remove no tables or evidence as part of rollback. A restored job is reported as unmonitored until a reviewed reactivation is implemented.

## Result meanings

| State | Meaning |
| --- | --- |
| `did_not_run` | No captured request exists for the latest due occurrence after the ten-minute allowance. |
| `refused` | HTTP 401/403, or an explicit blocked result. |
| `error` | Transport timeout/error, other non-2xx response, or explicit error result including mixed facility results. |
| `response_missing` | A request was recorded but its response is unavailable after the allowance. |
| `success` | Observed 2xx response without a known explicit error/block indicator. |
| `not_monitored` | Missing registration or changed command; coverage has broken. |

The exact `resident-assurance-ai` 403 body `PHI processing not authorized for this organization` is visible as a governance refusal and does not trigger a defect alert. Other 401/403 responses still alert. No policy is altered.

## Sentry evidence boundary

The runner uses a separate explicit DSN, awaits the Sentry envelope response, and returns the event ID. Configuration presence alone proves neither SDK delivery nor recipient notification. It does not change existing Edge adapters. Inspect deployed code and configured environment names privately before making claims about existing Edge delivery. Keep deployed versions, environment findings, event links, and recipient receipts in the private operating record, outside this public repository.

## Required remaining evidence

Run the Node tests with `node --test scripts/scheduled-jobs/*.test.mjs`; provider fetches are intercepted in the runner tests. Run the SQL tests only against a new disposable database. Complete the required segment gates, including migration replay after integration. Preserve verification outputs privately; source verification is not hosted acceptance.

- Database tests with cron/net test doubles: actual returned request ID retained, response classifications, timeout forwarding, PHI-safe ledger columns, anon/authenticated/service-role denied, and concurrent-command-safe restoration. Verify real hosted pg_net/cron behavior separately.
- Staging isolated fixture proving actual pg_net response capture for 200, 401, 500, and absence of a due run; preserve and clean only fixture-owned objects.
- Current on-demand parity report covering all active jobs.
- Existing Edge Sentry event evidence (or a documented failed delivery probe).
- Named recipient, configured route, and actual dated receipt from the authorized failure-injection test.
- Required segment gate artifact and migration/integration review before commit/release.

Sources: [Supabase pg_net response semantics](https://supabase.com/docs/guides/database/extensions/pg_net), [Management API Edge secrets](https://supabase.com/docs/reference/api/v1-list-all-secrets).

## Email configuration and attempt history

Migration `383_system_alert_email_settings.sql` adds private settings, atomic change audit, episode state, and delivery history. Authenticated RPCs recheck the current owner/org_admin authority and organization in the database, and optimistic versions refuse stale saves. Test emails require an explicit authenticated POST and are rate limited to one per organization per minute. The monitor reads settings on each run; configuration changes require no deployment. Pausing alerts stops new scheduled mail; explicit tests remain available.

The platform operator must explicitly authorize the receiving organization in private `job_monitor.email_monitor_scope` before activation. Org admins cannot grant themselves project infrastructure visibility. Without this binding, `monitoringConfigured` stays false and the runner sends no scheduled alerts for that organization.

Run `check.mjs --send-email` to queue and dispatch alerts. Failure episodes, recovery, and recurrence have distinct durable keys. Provider retries reuse each attempt ID as the Resend idempotency key; pending leases prevent overlapping sends and claim tokens reject stale worker completion. Uncertain attempts older than 23 hours from the first actual provider attempt stop as `indeterminate` because Resend retains idempotency keys for 24 hours. Review provider records before issuing a new test or configuration revision. `provider_accepted` is not mailbox delivery; failures and missing configuration remain in history. Changing configuration cancels obsolete pending attempts. Infrastructure job status is a project-level operational snapshot shown only to administrators of an explicitly platform-authorized organization; no resident, facility, clinical record or response body is included.

If the database, provider, GitHub runner, or its credentials are unavailable, the email path can also fail; retain independently verified GitHub workflow failure notification routing. A monitor cannot reliably alert on its own complete outage.

Email reference: [Resend idempotency retention](https://resend.com/docs/dashboard/emails/idempotency-keys).

The workflow reuses the repository's existing deployment project/token secrets when dedicated JOB_MONITOR overrides are absent. This avoids creating another database credential solely for monitoring. The email provider key remains a separate sending-only credential.
