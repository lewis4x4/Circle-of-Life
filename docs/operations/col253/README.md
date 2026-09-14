# Scheduled job outcome monitoring — COL-253

Mission alignment: pass. This detects silent failures in safety and operating jobs without authorizing AI processing or changing clinical decisions.

The monitor discovers every current cron job and reports unsupported/new/uninstrumented jobs instead of silently omitting them. Hosted installation, alert routing, and acceptance must be verified separately in private operating evidence.

## Components

The schema is defined in `supabase/migrations/381_scheduled_job_monitoring.sql`. Complete the required database checks and review migration prerequisites before applying it to another environment.

The private `job_monitor` schema stores request IDs, timestamps, status codes, and fixed outcome values. The opt-in wrapper keeps the existing `net.http_post` arguments, schedule, and headers. `pg_cron` success only proves the enqueue SQL ran; `job_monitor.collect()` joins the retained request ID to `net._http_response`. It retains no response body or secret values. Known billing per-facility errors/blocks are detected even on HTTP 200. A successful result means the observed HTTP/declared result succeeded; it does not prove downstream clinical/business acceptance.

The Node runner collects outcomes and compares Vault SHA-256 digests with Management API Edge secret digests. Neither digest nor value is printed. The sixteen known function/env mappings are source-reviewed. A newly discovered endpoint, changed Vault reference, or Vault URL targeting another project fails closed and requires a mapping review. The check does not invoke business functions and does not rotate any secret. Disabled or deleted registered jobs remain alertable. A newer pending request cannot hide an earlier failed response.

Problem-state fingerprints suppress unchanged Sentry reports after successful ingestion. A recovery resets the fingerprint so recurrence alerts again. Workflow concurrency prevents overlapping scheduled checks; manual checks with `--send-sentry` must not overlap the scheduled runner (Sentry delivery and database receipt are separate transactions, so a crash between them can duplicate an event). A failure to collect attempts a sanitized Sentry monitor-failure event and fails the workflow. It never substitutes a successful heartbeat for missing evidence.

## Activation and rollback

1. Reserve the next migration slot, review the SQL, and validate it on disposable PostgreSQL and then staging. Do not reset staging or touch unrelated fixtures.
2. Review each target's current cron owner, command, schedule, endpoint, and secret references. Require `postgres` ownership. After migration apply, opt in each reviewed ID with `select job_monitor.instrument(<jobid>);`. There is no automatic production instrumentation. Only one `net.http_post` call and named arguments are supported. Unsupported commands must be reviewed, never rewritten speculatively.
3. Run `node scripts/scheduled-jobs/check.mjs --secrets-only` with `SUPABASE_PROJECT_REF` and `SUPABASE_ACCESS_TOKEN` supplied securely in the process environment. Output must show `match` for every active job. Missing and unknown values remain failures.
4. Run `node scripts/scheduled-jobs/check.mjs`. The runner uses UTC cron semantics, a ten-minute lateness/response allowance, and retains up to 100 recent runs per job in each snapshot. Run at least every five minutes; pg_net response retention is short (default six hours). If collection stops longer than retention, `response_missing` is an evidence gap, never success. PostgreSQL run history remains available for diagnosis.
5. Configure an approved Sentry project and named recipient routing, then deliberately fail an isolated staging fixture job. With authorization for that recipient, run `check.mjs --send-sentry` with `SENTRY_DSN_JOB_MONITOR`. Record request ID, refusal/error/no-run state, event ID, Sentry issue URL, and a dated recipient receipt. Sentry HTTP 200 proves ingestion only; the script explicitly marks recipient receipt unverified.
6. Configure GitHub repository variable `JOB_MONITOR_ENABLED=true` plus secrets `JOB_MONITOR_PROJECT_REF`, `JOB_MONITOR_SUPABASE_ACCESS_TOKEN`, and `SENTRY_DSN_JOB_MONITOR` only after acceptance. The project reference is a secret so the public step environment does not display the live target. The workflow is disabled by default. It redirects detailed output to exact runner-temporary files, prints only a generic result, uploads no report artifact, and removes those files on exit. Authorized local CLI runs retain rich output; live findings travel only through the approved private monitoring destination. GitHub schedules may be delayed, so this is a ten-minute tolerance monitor, not a real-time guarantee. Record a named owner for GitHub workflow failure notifications and independently verify missed workflow runs; the monitor cannot notify while its own runner is unavailable.

Rollback a reviewed job with `select job_monitor.restore(<jobid>);`. Restoration refuses to overwrite a concurrent command edit. It preserves the original command and all outcome evidence. Remove no tables or evidence as part of rollback. A restored job is reported as unmonitored until a reviewed reactivation is implemented.

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
